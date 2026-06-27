# Multi-Key Strategies and Cache Stampedes

In the 200-level workshop you cached database queries and invalidated them on write. The pattern worked because your traffic was you, alone, clicking links in a browser. Production traffic is not one person clicking links. It is hundreds, maybe thousands, of concurrent requests hitting the same endpoint at the same moment a cache key expires. When that happens, every request simultaneously discovers the cache is empty and races to rebuild it from the database. The database gets slammed with duplicate work. That is called a cache stampede.

This workshop teaches you to handle the failure modes that emerge under concurrency: stampedes, cold starts, and the operational blind spots that come from not measuring your cache's effectiveness. By the end you'll have:

1. Warmed the cache on startup so the first real user never hits a cold cache
2. Used Valkey pipelines to batch multiple cache writes into a single network round-trip
3. Implemented a mutex lock to prevent cache stampedes (only one request rebuilds, others wait)
4. Built a circuit breaker into the cache layer so repeated Valkey failures stop adding latency
5. Used `INFO stats` to measure cache hit rate and understand what the numbers mean
6. Optionally explored Valkey Admin for visual observability

We're assuming you completed the [200-level workshop](../200-database-caching/). Cache-aside, write-through invalidation, and pattern-based invalidation should be familiar. If they aren't, go back.

You'll need Python 3.9 or later, Docker, a text editor, a terminal, and git.

## Setup

Start the infrastructure, install dependencies, and seed the database. These steps bring the workshop to a runnable state before you implement anything.

**1. Start Valkey and PostgreSQL:**

```bash
cd 300-multi-key-strategies
docker compose up -d
```

Wait for both containers to report healthy:

```bash
docker compose ps
```

**2. Install Python dependencies:**

```bash
cd python
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**3. Configure environment variables:**

```bash
cp .env.example .env
```

Review `.env` and confirm the defaults match your Docker Compose setup (they should if you haven't changed ports).

**4. Seed the database:**

```bash
python seed_db.py
```

You should see "Database seeded successfully."

**5. Start the application:**

```bash
python app.py
```

Open http://localhost:5000 in your browser. Click a genre. Note the cache status: the first request shows **MISS** because the cache is empty. Click the same genre again and it shows **HIT** (the 200-level cache-aside pattern at work). This is the cold start problem: every first request after startup pays the database cost.

Stop the app (`Ctrl+C`) before continuing to Part 1.

## The application

Same bookstore from the 200-level. Same PostgreSQL database, same Valkey instance, same Flask routes. What changes is how the cache layer behaves under stress and what happens at startup. We're adding resilience and observability, not new features.

## Part 1: Cache warming with pipelines

### The cold start problem

You just saw it. The app started, the cache was empty, and your first page load hit the database. When it was just you clicking a link, that miss took a few milliseconds and nobody noticed. Now imagine a production deployment: the container restarts and 200 users hit the homepage in the same second. Every one of them gets a miss. Every one of them queries PostgreSQL for the same genre list. That's a stampede caused by a cold cache rather than an expired key.

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

Open `warm_cache.py`. Replace the entire body of `warm_cache()` (everything below the docstring, including the `logger.info` placeholder) with the following:

```python
def warm_cache(cache):
    """Pre-populate the cache with genre listings at startup."""
    from db import get_all_genres, get_books_by_genre

    start = time.perf_counter()

    try:
        genres = get_all_genres()
        pipe = cache.pipeline()

        # Queue the genre list
        pipe.set("genres", json.dumps(genres), ex=cache.ttl_seconds)
        keys_queued = 1

        # Queue each genre's book listing
        for genre in genres:
            books = get_books_by_genre(genre)
            pipe.set(f"genre:{genre}", json.dumps(books), ex=cache.ttl_seconds)
            keys_queued += 1

        # Execute all SET commands in one round-trip
        pipe.execute()

        elapsed_ms = round((time.perf_counter() - start) * 1000)
        logger.info("Cache warmed: %d keys in %d ms", keys_queued, elapsed_ms)

    except Exception as exc:
        elapsed_ms = round((time.perf_counter() - start) * 1000)
        logger.warning("Cache warming failed after %d ms: %s", elapsed_ms, exc)
```

The function queries the database for all genres and their book listings, queues every SET into a single pipeline, then executes them in one network round-trip. If anything fails (Valkey down, database unreachable), it logs a warning and lets the app start anyway. A failed warm is not fatal; the cache-aside pattern from the 200-level still works, just without the head start.

Now open `app.py` and find the comment `# Part 1: Call warm_cache() here at startup.` Replace that comment and the line below it with:

```python
# Cache warming at startup (Part 1)
if CACHE_ENABLED and cache is not None:
    from warm_cache import warm_cache
    warm_cache(cache)
```

This calls your warming function once at import time, before Flask starts accepting requests.

### Observing it

Clear any leftover keys from the setup step so you can confirm warming works in isolation:

```bash
cd ..
docker compose exec valkey valkey-cli FLUSHALL
cd python
```

Now start the app:

```bash
python app.py
```

Before loading any page in the browser, open a second terminal (in the `300-multi-key-strategies` directory) and check for keys:

```bash
docker compose exec valkey valkey-cli KEYS "*"
```

Keys are already there. You haven't loaded a single page, but the warming function you just wrote ran at startup and populated them. Now open http://localhost:5000 and click a genre. The first page load shows **Cache: HIT**. Compare this to the setup step where the same action was a MISS because no warming existed.

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

Open `cache_layer.py` and find the `get_with_lock()` method. Replace the entire method body (everything below `def get_with_lock`) with the following. This is copy-pasteable as a complete method:

```python
    def get_with_lock(self, key, lock_ttl=5, wait_time=0.1, max_retries=3):
        """
        Retrieve a cached entry with stampede prevention.

        Returns (data, is_hit, is_rebuilder).
        """
        if self._circuit_is_open():
            return (None, False, False)

        try:
            # Check cache first
            raw = self._client.get(key)
            if raw is not None:
                self._record_success()
                return (json.loads(raw), True, False)

            # Cache miss. Try to acquire the lock.
            lock_key = f"lock:{key}"
            acquired = self._client.set(lock_key, "1", nx=True, ex=lock_ttl)

            if acquired:
                self._record_success()
                return (None, False, True)

            # Lock not acquired. Another request is rebuilding. Wait and retry.
            for _ in range(max_retries):
                _time.sleep(wait_time)
                raw = self._client.get(key)
                if raw is not None:
                    self._record_success()
                    return (json.loads(raw), True, False)

            # Retries exhausted. Fall through to database.
            self._record_success()
            return (None, False, False)

        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on get_with_lock('%s'): %s", key, exc)
            self._record_failure()
            return (None, False, False)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Deserialization error on get_with_lock('%s'): %s", key, exc)
            return (None, False, False)
```

Notice that this method talks to `self._client` directly rather than calling `self.get()`. That is intentional. The lock acquisition and the cache check need to happen in a tight sequence without the overhead of re-checking the circuit breaker or re-wrapping JSON on every retry. The circuit check happens once at the top.

The three possible return values tell the caller what to do:

- `(data, True, False)`: cache hit, serve `data` immediately.
- `(None, False, True)`: you acquired the lock, you are the rebuilder. Query the DB, call `cache.set()`, then call `cache.release_lock()`.
- `(None, False, False)`: retries exhausted or error. Fall through to the database without locking.

Now open `app.py` and find the `genre_listing` route. Replace the cache block (the section between `if CACHE_ENABLED and cache is not None:` and `else:`) with the following. Note the 8-space indentation; it sits inside the route function's `if` block:

```python
        data, is_hit, is_rebuilder = cache.get_with_lock(cache_key)

        if is_hit:
            books = data
            cache_status = "HIT"
        elif is_rebuilder:
            books = get_books_by_genre(genre)
            cache.set(cache_key, books)
            cache.release_lock(cache_key)
            cache_status = "MISS"
        else:
            # Retries exhausted or error. Fall through to DB.
            books = get_books_by_genre(genre)
            cache_status = "MISS"
```

The route now handles all three cases. Only the rebuilder queries the database and writes back to the cache. Everyone else either gets the cached value or, in the worst case, falls through to a direct database query without holding a lock.

### Observing it

First, flush the cache and restart the app so you start with a cold cache (no warming, to isolate the stampede behavior):

```bash
docker compose exec valkey valkey-cli FLUSHALL
```

Start `valkey-cli MONITOR` in a second terminal (from the `300-multi-key-strategies` directory):

```bash
docker compose exec valkey valkey-cli MONITOR
```

Now, in a third terminal, send 10 concurrent requests to the same genre endpoint. This one-liner uses `curl` and background processes:

```bash
for i in $(seq 1 10); do curl -s http://localhost:5000/genre/fantasy > /dev/null & done; wait
```

In the MONITOR output, you should see:

- Only one `SET genre:fantasy ...` command (the rebuilder wrote to cache)
- A `SET lock:genre:fantasy ...` with NX and EX flags (the lock acquisition)
- A `DEL lock:genre:fantasy` (the lock release after rebuild)

Without the mutex, you would see 10 separate SET commands for the same key. With it, only one request queried the database.

## Part 3: Circuit breaker for Valkey failures

### Why the 200-level approach isn't enough

In the 200-level, when Valkey goes down, every request still attempts a cache operation, waits for the connection timeout, logs a warning, and falls through to the database. That timeout (typically 1-3 seconds by default) adds latency to every single request during an outage. For a brief blip, it's fine. For a sustained outage, you're adding seconds of latency to every page load for no benefit.

### The circuit breaker pattern

Three states:

- **Closed** (normal operation): cache operations proceed as usual.
- **Open** (Valkey is down): skip all cache operations immediately. No connection attempt, no timeout penalty. Return miss instantly.
- **Half-open** (probing): after a cooldown period, allow a single request through to test if Valkey is back. If it succeeds, close the circuit. If it fails, reopen and reset the timer.

### Implementation

Open `cache_layer.py` and find the three circuit breaker methods (`_circuit_is_open`, `_record_failure`, `_record_success`). Replace each method body with the following. These are copy-pasteable as complete methods:

```python
    def _circuit_is_open(self):
        """Check if the circuit breaker is open."""
        if self._circuit_opened_at is None:
            return False
        elapsed = _time.time() - self._circuit_opened_at
        if elapsed >= self._circuit_cooldown:
            # Half-open: allow one probe
            return False
        return True

    def _record_failure(self):
        """Record a connection failure. Open the circuit if threshold is reached."""
        self._failure_count += 1
        if self._failure_count >= self._circuit_threshold:
            self._circuit_opened_at = _time.time()
            logger.warning(
                "Circuit breaker opened after %d failures", self._failure_count
            )

    def _record_success(self):
        """Record a successful operation. Close the circuit if it was open."""
        if self._circuit_opened_at is not None:
            logger.warning("Circuit breaker closed, Valkey recovered")
        self._failure_count = 0
        self._circuit_opened_at = None
```

The logic is simple. `_circuit_is_open()` returns `True` only when the circuit has been tripped and the cooldown has not yet elapsed. Once the cooldown passes, it returns `False` (the half-open state), which allows exactly one request through as a probe. If that probe succeeds, `_record_success()` resets everything and the circuit closes. If it fails, `_record_failure()` re-opens the circuit with a fresh timestamp.

The `get()` and `set()` methods already call `_circuit_is_open()` at the top and `_record_success()`/`_record_failure()` on every outcome. You do not need to change them. Pasting in the three methods above is all that is needed to activate the circuit breaker.

### Observing it

1. Load pages with Valkey running. Circuit closed, cache HIT/MISS as normal.
2. Stop Valkey (from the `300-multi-key-strategies` directory): `docker compose stop valkey`
3. Load a page. First 3 requests log warnings and trigger the circuit to open.
4. Subsequent requests skip the cache with zero added latency. A single log line: "Circuit breaker opened after 3 failures"
5. Start Valkey: `docker compose start valkey` (from the same directory)
6. After cooldown expires (30 seconds by default), one request probes. Cache recovers. Circuit closes.

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

Open `cache_layer.py` and find the `get_stats()` method. Replace the entire method body with:

```python
    def get_stats(self):
        """Retrieve cache statistics from Valkey's INFO command."""
        if self._circuit_is_open():
            return None

        try:
            stats = self._client.info("stats")
            memory = self._client.info("memory")
            clients = self._client.info("clients")
            total_keys = self._client.dbsize()

            hits = stats.get("keyspace_hits", 0)
            misses = stats.get("keyspace_misses", 0)
            total = hits + misses
            hit_rate = hits / total if total > 0 else 0.0

            self._record_success()
            return {
                "hit_rate": round(hit_rate, 4),
                "keyspace_hits": hits,
                "keyspace_misses": misses,
                "used_memory_human": memory.get("used_memory_human", "unknown"),
                "connected_clients": clients.get("connected_clients", 0),
                "total_keys": total_keys,
            }
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on get_stats(): %s", exc)
            self._record_failure()
            return None
```

The method calls `INFO` with specific sections rather than fetching the entire info dump. This keeps the response focused and avoids parsing hundreds of irrelevant fields. `dbsize()` is a separate command that returns the total number of keys in the current database.

Now open `app.py` and find the `/stats` route. Replace the entire route function (from `@app.route("/stats")` to the `return` statement) with:

```python
@app.route("/stats")
def stats():
    """Return cache statistics as JSON."""
    if not CACHE_ENABLED or cache is None:
        return jsonify({"error": "Cache is disabled"}), 503

    data = cache.get_stats()
    if data is None:
        return jsonify({"error": "Could not retrieve stats from Valkey"}), 503

    return jsonify(data)
```

After implementing both, restart the app and visit http://localhost:5000/stats. You will see a JSON response with the hit rate, memory usage, and key count. Browse a few pages first to generate some hits and misses, then check the endpoint again to see the numbers change.

### Structured logging

The structured logging section is left as an exercise. The idea: replace the generic `logger.warning()` calls with structured log lines that include the cache key, operation (get/set/invalidate), result (hit/miss/error), latency, and circuit state. This produces a machine-parseable log stream suitable for any log aggregation tool. The safety/ directory contains an example if you want to see one approach.

### Optional: Valkey Admin

[Valkey Admin](https://valkey-admin.valkey.io/) is an open source observability and management tool from the Valkey project. It provides a visual dashboard for memory usage, operations/sec, key distribution, and anomaly detection.

To run it alongside your workshop infrastructure, add the following service to your `docker-compose.yml`:

```yaml
  valkey-admin:
    image: valkey/valkey-admin:latest
    ports:
      - "8080:8080"
```

Then restart your services:

```bash
docker compose up -d
```

Open http://localhost:8080 in your browser. In the Valkey Admin UI, add a connection to `valkey` on port `6379` (the service name from your Docker Compose network). You will see the same metrics you calculated by hand (hit rate, memory, connected clients) rendered as time-series charts, plus key-level inspection and slow log visibility.

This section is not required to complete the workshop. The 400-level workshop covers observability in greater depth. For more on Valkey Admin's capabilities, see the [Introducing Valkey Admin 1.0](https://valkey.io/blog/introducing-valkey-admin-1-0-visual-cluster-management-for-valkey/) blog post.

## Part 5: Putting it all together

### The full lifecycle

1. App starts. Cache warming populates known hot keys via pipeline.
2. First users arrive. All hits. No cold start.
3. TTL expires on a popular key. Multiple requests arrive simultaneously. Mutex lock ensures only one rebuilds. Others wait briefly and get the fresh value.
4. Valkey goes down. Circuit breaker opens after 3 failures. All subsequent requests skip the cache with zero latency penalty. App continues serving from PostgreSQL.
5. Valkey comes back. Circuit probes, succeeds, closes. Cache operations resume. Next miss triggers a rebuild, and the cycle continues.

### Load testing

Run the provided concurrent load test (from the `python/` directory):

```bash
python load_test.py
```

The script uses `concurrent.futures` to send parallel requests and reports results. Verify that:

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
