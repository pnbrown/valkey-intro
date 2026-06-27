# FAQ: Multi-Key Strategies and Cache Stampedes

## Why warm the cache at startup instead of lazily on first request?

Lazy caching (cache-aside) works, but the first N requests after a cold start all hit the database simultaneously. For high-traffic applications, those first requests arrive within milliseconds of each other, creating a stampede on a cold cache. Warming guarantees that known high-traffic keys are populated before any request arrives, eliminating the cold-start penalty entirely.

## Why use a pipeline for warming instead of individual SET calls?

Each SET command is a network round-trip to Valkey (send request, wait for response). For 10 keys, that is 10 round-trips. A pipeline batches all 10 SETs into a single round-trip: the client sends all commands at once, Valkey processes them sequentially, and the client reads all responses together. For cache warming with a known set of keys, this reduces total warming time roughly proportional to the number of keys.

## What happens if warming fails?

The `warm_cache()` function wraps everything in try/except. If Valkey is down or the database is unreachable at startup, it logs a warning and lets the app start anyway. The app functions normally through cache-aside (misses on the first requests, then populates as usual). A failed warm is a performance penalty, not a fatal error.

## Why SET NX EX for the lock instead of a regular SET?

`NX` means "set only if the key does not exist." This makes the operation atomic: if two requests race to acquire the lock simultaneously, exactly one wins. `EX 5` gives the lock a 5-second expiration as a safety net. If the winning request crashes mid-rebuild (or takes longer than expected), the lock automatically expires and another request can take over. Without `EX`, a crashed rebuilder would leave the lock permanently, blocking all future rebuilds until manual intervention.

## Why sleep and retry instead of blocking on the lock?

Valkey does not provide a native "wait for this key to be deleted" operation. The alternatives are polling (sleep + retry) or pub/sub notification. Polling is simpler, predictable, and appropriate for the short wait times involved (100-300ms total). The retry loop has a hard cap (3 retries by default), so it never blocks indefinitely. If retries exhaust, the request falls through to the database directly.

## Could the stampede lock cause a deadlock?

No. The lock has a TTL (`EX 5`). Even in the worst case (the rebuilder process crashes, the app restarts, the lock is orphaned), it expires in 5 seconds. There is no scenario where a lock persists indefinitely. The "wait and retry" loop also has a max retry count, so waiting requests never block forever.

## Why a circuit breaker instead of just try/except with fallback?

try/except with fallback (the 200-level approach) works functionally: every failed cache operation logs a warning and falls through to the database. The problem is latency. Each failed operation waits for the connection timeout (typically 1-3 seconds) before giving up. During a sustained outage, every request pays that timeout cost for no benefit. The circuit breaker eliminates this by detecting the pattern (N consecutive failures) and short-circuiting all cache operations immediately until the cooldown expires. The cost drops from seconds per request to near zero.

## What does "half-open" mean in practice?

After the circuit opens (Valkey is down) and the cooldown period elapses, the next request that attempts a cache operation is allowed through as a "probe." If it succeeds, the circuit closes and normal operation resumes. If it fails, the circuit reopens and the cooldown timer resets. This prevents the circuit from staying open indefinitely while also preventing a flood of requests from hitting a still-dead Valkey.

## Why does get_with_lock() talk to self._client directly instead of calling self.get()?

Performance and correctness. `self.get()` checks the circuit breaker, attempts a GET, records success/failure, and deserializes JSON. `get_with_lock()` needs to check the cache, attempt a lock acquisition, and retry in a tight loop. Calling `self.get()` on each retry would re-check the circuit, re-record success on each poll, and add unnecessary overhead. The method does its own circuit check once at the top, then operates directly on the client for the remainder.

## Are the INFO stats per-key or server-wide?

Server-wide. `keyspace_hits` counts every successful GET (where the key existed), including internal operations and other clients. `keyspace_misses` counts every GET where the key did not exist. The hit rate you calculate from these numbers reflects all traffic to that Valkey instance, not just your application. In a production deployment with multiple applications sharing Valkey, use client-side metrics for per-application hit rates.

## Why is the default circuit breaker threshold 3 instead of 1?

A single failure could be a transient network blip (packet loss, brief DNS hiccup). Opening the circuit on the first failure would cause unnecessary fallback to the database for what was a momentary issue. Three consecutive failures is strong evidence of a sustained problem rather than a transient one. The threshold is configurable via the `CIRCUIT_BREAKER_THRESHOLD` environment variable if your deployment has different reliability characteristics.
