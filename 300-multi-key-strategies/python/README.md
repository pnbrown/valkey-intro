# Multi-Key Strategies and Cache Stampedes

In the 200-level workshop you cached database queries and invalidated them on write. The pattern worked because your traffic was you, alone, clicking links in a browser. Production traffic is not one person clicking links. Production traffic is hundreds of concurrent requests hitting the same endpoint at the same moment a cache key expires. When that happens, every request simultaneously discovers the cache is empty and races to rebuild it from the database. The database gets slammed with duplicate work. That's a cache stampede.

This workshop teaches you to handle the failure modes that emerge under concurrency: stampedes, cold starts, and the operational blind spots that come from not measuring your cache's effectiveness. By the end you'll have:

1. Warmed the cache on startup so the first real user never hits a cold cache
2. Used Valkey pipelines to batch multiple cache writes into a single network round-trip
3. Implemented a mutex lock to prevent cache stampedes (only one request rebuilds, others wait)
4. Built a circuit breaker into the cache layer so repeated Valkey failures stop adding latency
5. Used `INFO stats` to measure cache hit rate and understand what the numbers mean
6. Optionally explored Valkey Admin for visual observability

We're assuming you completed the [200-level workshop](../200-database-caching/). Cache-aside, write-through invalidation, and pattern-based invalidation should be familiar. If they aren't, go back.

You'll need Python 3.9 or later, Docker, a text editor, a terminal, and git.

## The application

Same bookstore from the 200-level. Same PostgreSQL database, same Valkey instance, same Flask routes. What changes is how the cache layer behaves under stress and what happens at startup. We're adding resilience and observability, not new features.

## Part 1: Cache warming with pipelines

### The cold start problem

Every time Valkey restarts (or you deploy a new version, or the container gets rescheduled), the cache is empty. The first N users all experience cache misses. For a low-traffic internal tool, that's a minor annoyance. For a high-traffic public service, those first few hundred requests all hit the database simultaneously. Sound familiar? It's a stampede caused by a cold cache rather than an expired key.

Cache warming solves this by pre-populating known high-traffic keys before any user request arrives.

### What we're warming

Not everything belongs in a warm cache. You warm the data that is:

- Requested frequently (genres list, popular genre pages)
- Expensive to compute or fetch
- Unlikely to be stale at startup (reference data, not user-specific state)

For our bookstore, that's the genre list and every genre's book listing. We know the full set of genres from the database, and we know every startup will need them.

### Pipelines: batching for efficiency

Writing 10 cache keys means 10 network round-trips to Valkey. A pipeline batches those into a single round-trip: the client queues all commands locally, sends them together, and reads all responses at once. For cache warming with known data, this is the right tool.

### Implementation

Participants will build a `warm_cache()` function that:

1. Queries PostgreSQL for all genres
2. Queries each genre's book listing
3. Opens a Valkey pipeline
4. Queues SET commands (with TTL) for `genres`, and each `genre:{name}` key
5. Executes the pipeline in one round-trip
6. Logs how many keys were warmed and how long it took

This runs at app startup (before Flask begins serving requests).

### Observing it

Start the app. Before loading any page in the browser, open a second terminal and run:

```bash
docker compose -f ../docker-compose.yml exec valkey valkey-cli KEYS "*"
```

Keys are already populated. The first page load shows Cache: HIT. No cold start penalty.

## Part 2: Preventing cache stampedes with mutex locking

### The stampede scenario

A genre page's cache key expires. In the same instant, 50 requests arrive for that genre. All 50 check the cache, all 50 get a miss, all 50 query PostgreSQL for the same data, all 50 write the same result back to the cache. The database did 50x the necessary work. One query would have been enough.

### The fix: lock and wait

The pattern:

1. Request checks the cache. Miss.
2. Request attempts to acquire a lock: `SET lock:genre:{name} 1 NX EX 5` (set only if not exists, expires in 5 seconds as a safety net)
3. If lock acquired: query the database, write to cache, delete the lock.
4. If lock not acquired: another request is already rebuilding. Wait briefly (sleep, then retry the cache). If the cache is populated on retry, serve it. If the lock expired without the cache being populated (the rebuilder crashed), fall through to the database.

### Why this works for Flask

Flask handles requests synchronously (one thread per request in the default threaded mode). A short sleep (50-100ms) while waiting for another thread to rebuild is acceptable. The database is protected from duplicate queries, and the user experiences a small delay rather than a timeout.

### Implementation

Participants will add a `get_with_lock()` method to `CacheLayer` that:

1. Attempts `cache.get(key)`. If hit, return immediately.
2. Attempts `SET lock:{key} 1 NX EX 5`. If acquired, return `(None, False, True)` signaling "you are the rebuilder."
3. If lock not acquired, sleep 100ms and retry `cache.get(key)` up to 3 times.
4. If retries exhausted, fall through to the database (never block forever).

Route handlers use this instead of raw `cache.get()` for high-traffic keys.

### Observing it

Participants simulate concurrent requests using a simple script (or `curl` in a loop) and watch:

- In `valkey-cli MONITOR`: only one `SET genre:fantasy ...` appears despite multiple simultaneous requests
- The `lock:genre:fantasy` key appears briefly and disappears
- Database query count (visible in app logs) stays at 1 instead of N

## Part 3: Circuit breaker for Valkey failures

### Why the 200-level approach isn't enough

In the 200-level, when Valkey goes down, every request still attempts a cache operation, waits for the connection timeout, logs a warning, and falls through to the database. That timeout (typically 1-3 seconds by default) adds latency to every single request during an outage. For a brief blip, it's fine. For a sustained outage, you're adding seconds of latency to every page load for no benefit.

### The circuit breaker pattern

Three states:

- **Closed** (normal operation): cache operations proceed as usual.
- **Open** (Valkey is down): skip all cache operations immediately. No connection attempt, no timeout penalty. Return miss instantly.
- **Half-open** (probing): after a cooldown period, allow a single request through to test if Valkey is back. If it succeeds, close the circuit. If it fails, reopen and reset the timer.

### Implementation

Participants will add circuit breaker state to `CacheLayer`:

- A failure counter
- A threshold (e.g., 3 consecutive failures)
- A timestamp for when the circuit opened
- A cooldown period (e.g., 30 seconds)

The `get()` and `set()` methods check the circuit state before attempting any Valkey operation. This replaces the per-request timeout cost with a near-zero-cost early return.

### Observing it

1. Load pages with Valkey running. Circuit closed, cache HIT/MISS as normal.
2. Stop Valkey. First 3 requests log warnings and trigger the circuit to open.
3. Subsequent requests skip the cache with zero added latency. A single log line: "Circuit open, skipping cache."
4. Start Valkey. After cooldown expires, one request probes. Cache recovers. Circuit closes.

## Part 4: Measuring cache effectiveness

### The metrics that matter

A cache you aren't measuring is a cache you're trusting on faith. The two numbers you need:

- **Hit rate**: hits / (hits + misses). Below 80% usually means TTLs are too short, keys are poorly designed, or the working set doesn't fit in memory.
- **Memory usage**: how much of your available memory is consumed. Approaching the limit means eviction is coming.

### Using INFO stats

Valkey's `INFO` command exposes server-wide statistics. The relevant fields:

```
keyspace_hits:      (number of successful key lookups)
keyspace_misses:    (number of failed key lookups)
used_memory_human:  (current memory consumption)
connected_clients:  (active connections)
```

Hit rate = `keyspace_hits / (keyspace_hits + keyspace_misses)`

### Implementation

Participants will:

1. Run `INFO stats` before and after a series of requests
2. Calculate hit rate by hand
3. Add a `/stats` endpoint to the Flask app that calls `INFO` and returns the hit rate and key count as JSON
4. Observe how warming, stampede prevention, and TTL length each affect the numbers

### Structured logging

Replace `logger.warning()` fire-and-forget with structured log lines that include:

- Cache key
- Operation (get/set/invalidate)
- Result (hit/miss/error)
- Latency (time spent on the cache operation)
- Circuit state (closed/open/half-open)

This gives participants a machine-parseable log stream they could feed into any log aggregation tool.

### Optional: Valkey Admin

[Valkey Admin](https://valkey-admin.valkey.io/) is an open source observability tool from the Valkey project. It ships as a Docker container and provides a visual dashboard for memory usage, operations/sec, key distribution, and anomaly detection.

Participants can optionally add it to their `docker-compose.yml` and see the same metrics they calculated by hand, rendered as time-series charts. This section is not required to complete the workshop but demonstrates what production monitoring looks like.

## Part 5: Putting it all together

### The full lifecycle

1. App starts. Cache warming populates known hot keys via pipeline.
2. First users arrive. All hits. No cold start.
3. TTL expires on a popular key. Multiple requests arrive simultaneously. Mutex lock ensures only one rebuilds. Others wait briefly and get the fresh value.
4. Valkey goes down. Circuit breaker opens after 3 failures. All subsequent requests skip the cache with zero latency penalty. App continues serving from PostgreSQL.
5. Valkey comes back. Circuit probes, succeeds, closes. Cache operations resume. Next miss triggers a rebuild, and the cycle continues.

### Load testing

Participants run a simple concurrent load test (provided script using `concurrent.futures`) to verify:

- Warming eliminates cold start misses
- Mutex prevents duplicate database queries under concurrency
- Circuit breaker eliminates timeout latency during outage
- Hit rate stays above 90% under sustained load with Valkey healthy

## Going further

The 400-level workshop (when available) builds on this with Valkey Cluster (distributed caching across multiple nodes), read replicas, eviction policies under memory pressure, and production alerting.

For reference:

- [Valkey SET command (NX and EX options)](https://valkey.io/commands/set/)
- [Valkey INFO command](https://valkey.io/commands/info/)
- [Valkey pipelining](https://valkey.io/topics/pipelining/)
- [Valkey distributed locks](https://valkey.io/topics/distlock/)
- [Valkey Admin](https://valkey-admin.valkey.io/)
- [Optimal Probabilistic Cache Stampede Prevention (Vattani et al.)](https://www.researchgate.net/publication/276465356_Optimal_probabilistic_cache_stampede_prevention)

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines on adding language implementations or improving workshop content.

## License

[WTFPL](../../LICENSE)
