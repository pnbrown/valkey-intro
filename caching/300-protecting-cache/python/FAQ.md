# FAQ: Protecting the Cache Layer

## Why warm the cache at startup instead of lazily on first request?

Lazy caching (cache-aside) works, but the first N requests after a cold start all hit the database simultaneously. For high-traffic applications, those first requests arrive within milliseconds of each other, creating a stampede on a cold cache. Warming populates the known high-traffic keys before the app accepts its first request, so those keys never start cold. Keys you do not warm (the book pages, in this workshop) still miss once each.

## Why use a pipeline for warming instead of individual SET calls?

Each SET command is a network round-trip to Valkey (send request, wait for response). For 10 keys, that is 10 round-trips. A pipeline batches all 10 SETs into a single round-trip: the client sends all commands at once, Valkey processes them sequentially, and the client reads all responses together. For cache warming with a known set of keys, the number of round-trips drops from one per key to one in total.

## What happens if warming fails?

The `warm_cache()` function wraps everything in try/except. If Valkey is down or the database is unreachable at startup, it logs a warning and lets the app start anyway. The app functions normally through cache-aside (misses on the first requests, then populates as usual). A failed warm is a performance penalty, not a fatal error.

## Why SET NX EX for the lock instead of a regular SET?

`NX` means "set only if the key does not exist." This makes the operation atomic: if two requests race to acquire the lock simultaneously, exactly one wins. `EX 5` gives the lock a 5-second expiration as a safety net. If the winning request crashes mid-rebuild (or takes longer than expected), the lock automatically expires and another request can take over. Without `EX`, a crashed rebuilder would leave the lock permanently, blocking all future rebuilds until manual intervention.

## Why sleep and retry instead of blocking on the lock?

Valkey does not provide a native "wait for this key to be deleted" operation. The alternatives are polling (sleep + retry) or pub/sub notification. Polling is simpler, predictable, and appropriate for the short wait times involved (100-300ms total). The retry loop has a hard cap (3 retries by default), so it never blocks indefinitely. If retries exhaust, the request falls through to the database directly.

## Could the stampede lock cause a deadlock?

No. The route releases the lock in a `finally` block, so a failed query does not leave it behind, and the lock also has a TTL (`EX 5`). Even in the worst case (the rebuilder process is killed, so `finally` never runs), it expires in 5 seconds. There is no scenario where a lock persists indefinitely. The "wait and retry" loop also has a max retry count, so waiting requests never block forever.

One limitation is worth knowing. `release_lock()` deletes the lock key unconditionally. If a rebuild ever took longer than 5 seconds, the lock would expire, a second request could take it, and the first request's `release_lock()` would then delete the second request's lock. Production locks avoid this by storing a unique token as the lock's value and deleting the key only if it still holds that token, checked atomically in a Lua script. The workshop's rebuilds take milliseconds, so the simple version is safe here.

## Why a circuit breaker instead of just try/except with fallback?

try/except with fallback (the 200-level approach) works functionally: every failed cache operation logs a warning and falls through to the database. The problem is wasted work, and sometimes latency. When Valkey's container is stopped, as in this workshop, each attempt is refused immediately, so the cost per request is small but every request still makes a doomed call and logs a warning. When the host stops answering altogether (a network partition or a crashed machine), each attempt waits for a timeout instead; this `CacheLayer` sets no `socket_timeout`, so that wait is the operating system's TCP connect timeout. The circuit breaker handles both by detecting the pattern (N consecutive failures) and skipping all cache operations until the cooldown expires. In production you would also set `socket_timeout` and `socket_connect_timeout` on the client so a single attempt can never stall a request for long.

## What does "half-open" mean in practice?

After the circuit opens (Valkey is down) and the cooldown period elapses, cache operations are allowed to reach Valkey again. The first success closes the circuit and normal operation resumes. The first failure reopens it immediately, because the failure count is still at the threshold, and the cooldown timer restarts. This keeps the circuit from staying open forever once Valkey recovers.

The workshop's version is simplified: every request that arrives after the cooldown goes through, not just one. A production circuit breaker usually admits a single trial request and keeps the circuit open for everyone else until that request returns, so a backlog of requests cannot all hit a service that is still down. Implementing that correctly takes a thread-safe "trial in progress" flag and a way to clear it if the trial never reports back, which is more machinery than this workshop needs with one reader and a local container.

## Why does get_with_lock() talk to self._client directly instead of calling self.get()?

Performance and correctness. `self.get()` checks the circuit breaker, attempts a GET, records success/failure, and deserializes JSON. `get_with_lock()` needs to check the cache, attempt a lock acquisition, and retry in a tight loop. Calling `self.get()` on each retry would re-check the circuit, re-record success on each poll, and add unnecessary overhead. The method does its own circuit check once at the top, then operates directly on the client for the remainder.

## Are the INFO stats per-key or server-wide?

Server-wide. `keyspace_hits` counts every key lookup that found its key, from any read command and any client, not only this app's GETs. `keyspace_misses` counts every lookup that did not. The hit rate you calculate from these numbers reflects all traffic to that Valkey instance, not just your application. In a production deployment with multiple applications sharing Valkey, use client-side metrics for per-application hit rates.

## Why is the default circuit breaker threshold 3 instead of 1?

A single failure could be a transient network blip (packet loss, brief DNS hiccup). Opening the circuit on the first failure would cause unnecessary fallback to the database for what was a momentary issue. Three consecutive failures is strong evidence of a sustained problem rather than a transient one. The threshold is configurable via the `CIRCUIT_BREAKER_THRESHOLD` environment variable if your deployment has different reliability characteristics.
