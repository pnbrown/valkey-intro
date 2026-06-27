# Production Operations with Valkey Cluster

In the 300-level workshop you built resilience into a single-node setup: cache warming, stampede prevention, circuit breakers, and observability. All of that assumed one Valkey instance. Production systems rarely run a single instance. They run clusters: data sharded across multiple nodes, replicas for failover, memory limits enforced with eviction policies. The application code changes too. Connections become pooled resources. Serialization needs to handle types that `json.dumps` rejects. Health checks need to probe real dependencies, not just return 200.

This workshop splits into three sections. Part A hardens the application layer (your code). Part B introduces Valkey Cluster (your infrastructure). Part C ties them together with a full lifecycle walkthrough and load test. All three use the same bookstore from the [200](../200-database-caching/) and [300-level](../300-multi-key-strategies/).

By the end you will have:

1. Replaced per-request database connections with a connection pool
2. Replaced the single Valkey client with a cluster-aware client
3. Handled hash slot constraints and cross-slot limitations
4. Configured eviction policies under memory pressure
5. Added a health check endpoint that probes PostgreSQL and Valkey
6. Run the bookstore on a 6-node Valkey Cluster with automatic failover

A note on scope: this workshop gives you hands-on experience with the operational concerns that appear at production scale. It does not cover every production topic (security hardening, capacity planning, backup strategies, incident response). What it does give you is vocabulary, working code, and enough understanding to know what to look up next.

We are assuming you completed the [300-level workshop](../300-multi-key-strategies/). Cache warming, stampede prevention, and circuit breakers should be familiar. If they are not, go back.

You will need Python 3.9 or later, Docker, a text editor, a terminal, and git. The Docker Compose setup for this workshop runs 9 containers (6 Valkey cluster nodes, a cluster initializer, PostgreSQL, and optionally Valkey Admin), which requires more resources than earlier workshops. Ensure Docker Desktop has at least 4 GB of memory allocated.

## What is Valkey Cluster?

In the previous workshops, you ran a single Valkey instance. One process, one port, all keys in one place. That works for development and low-traffic production, but it has two limits: the data has to fit in one machine's memory, and if that machine goes down, the cache is gone.

Valkey Cluster solves both problems. It splits the keyspace into 16,384 hash slots and distributes those slots across multiple primary nodes. Each primary owns a range of slots and stores only the keys that hash into that range. When your application writes `genre:fantasy`, Valkey runs [CRC16](https://valkey.io/topics/cluster-spec/) (a fast 16-bit cyclic redundancy check, producing a value between 0 and 65535) on the key name, takes the result modulo 16,384, and routes the write to the node that owns that slot. (Why 16,384 specifically? See the [FAQ](FAQ.md#why-16384-hash-slots).)

Each primary has one or more replicas. The replica copies everything the primary does. If the primary dies, the cluster promotes the replica to take over those slots. Your application sees a brief interruption (typically under 10 seconds), then continues as if nothing happened.

From the application's perspective, a cluster-aware client (like [`ValkeyCluster`](https://valkey-py.readthedocs.io/en/latest/connections.html#valkey.cluster.ValkeyCluster) in valkey-py) handles the routing transparently. You issue commands the same way you always have. The client figures out which node to talk to. The only thing that changes in your code is the client initialization and an awareness of cross-slot limitations (which we cover in Part A2).

The [Valkey Cluster tutorial](https://valkey.io/topics/cluster-tutorial/) covers the full specification. This workshop gives you the hands-on experience of running and operating a cluster locally.

## Setup

Start the infrastructure, install dependencies, and seed the database.

**1. Start the Valkey Cluster and PostgreSQL:**

```bash
cd 400-production-operations
docker compose up -d
```

Wait for the cluster to form. The `cluster-init` service runs `valkey-cli --cluster create` and exits once the cluster is healthy. Check its logs to confirm:

```bash
docker compose logs cluster-init
```

You should see a message like "Cluster creation successful" or "All 16384 slots covered." If you see connection errors, wait a few seconds and check again (the nodes need time to start).

Verify the cluster state:

```bash
docker compose exec valkey-1 valkey-cli cluster info
```

Look for `cluster_state:ok` and `cluster_slots_assigned:16384`.

**2. Install Python dependencies:**

```bash
cd python
pip install -r requirements.txt
```

**3. Configure environment variables:**

```bash
cp .env.example .env
```

The defaults connect to the cluster through the first node (`localhost:7001`). The Valkey client auto-discovers the other nodes.

**4. Seed the database:**

```bash
python seed_db.py
```

**5. Start the application (without Part A changes, just to see it run):**

```bash
python app.py
```

Open http://localhost:5000 in your browser. Click a genre. The app connects to the first cluster node as if it were a standalone instance. Keys whose hash slot lives on that node work normally. Keys on other nodes result in cache misses (the circuit breaker catches the MOVED errors gracefully). The app still functions because cache-aside falls through to PostgreSQL on every miss. This is the problem you will fix in Part A2 by switching to a cluster-aware client. Stop the app before continuing.

## Part A: Hardening the application layer

### A1: Connection pooling for PostgreSQL

In the 300-level, every database call opened a new TCP connection to PostgreSQL and closed it after the query. For a workshop with one user, that is fine. For a production app handling hundreds of concurrent requests, creating and tearing down TCP connections on every query adds latency and exhausts database connection slots.

`psycopg_pool` provides a `ConnectionPool` that maintains a set of open connections. Your code borrows a connection from the pool, runs a query, and returns it. The TCP handshake happens once at startup, not on every request.

#### Implementation

Open `db.py`. Add the `psycopg_pool` import at the top and replace `get_connection()` with a module-level pool:

```python
from psycopg_pool import ConnectionPool

_pool = ConnectionPool(
    conninfo=os.environ["DATABASE_URL"],
    min_size=2,
    max_size=10,
    open=True,
)


def get_connection():
    """Borrow a connection from the pool."""
    return _pool.connection()
```

Note on `open=True`: this tells the pool to establish connections immediately at import time. If PostgreSQL is not reachable when the app starts (common in container orchestration where startup order is not guaranteed), the pool creation fails and the app crashes. For this workshop, the Docker Compose health checks ensure PostgreSQL is ready before you start the app. In production, you would either use `open=False` with explicit `pool.open()` after confirming connectivity, or add retry logic at startup.

The rest of `db.py` (the query functions) does not change. They already use `with get_connection() as conn:`, which returns the connection to the pool when the block exits.

#### Observing it

Restart the app. Load several pages quickly. In a separate terminal (in the `400-production-operations` directory), check PostgreSQL connection count:

```bash
docker compose exec postgres psql -U workshop -d bookstore -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'bookstore';"
```

With pooling, the count stays stable (around 2-10) regardless of request volume. Without pooling, each concurrent request would show a separate connection.

### A2: Cluster-aware Valkey client

The 300-level `CacheLayer` used `valkey.Valkey()`, a single-node client. Valkey Cluster distributes keys across hash slots on different nodes. A single-node client talks to one node. If you write to a key whose slot lives on a different node, the server returns a [MOVED](https://valkey.io/topics/cluster-spec/) redirect. The single-node client does not handle redirects.

[`valkey.ValkeyCluster`](https://valkey-py.readthedocs.io/en/latest/connections.html#valkey.cluster.ValkeyCluster) handles this transparently. It discovers the cluster topology, routes commands to the correct node, and follows [MOVED and ASK](https://valkey.io/topics/cluster-spec/) redirects automatically.

#### Implementation

Open `cache_layer.py`. Replace the client initialization:

```python
from valkey.cluster import ValkeyCluster, ClusterNode

startup_nodes = [ClusterNode(host, int(port)) for host, port in
                 [node.split(":") for node in
                  os.environ.get("VALKEY_CLUSTER_NODES", "localhost:7001").split(",")]]

self._client = ValkeyCluster(
    startup_nodes=startup_nodes,
    decode_responses=True,
    skip_full_coverage_check=True,
)
```

The client only needs one seed node to discover the full topology. We pass multiple for resilience: if the first node is down at startup, the client tries the next.

#### Hash tags and cross-slot limitations

Valkey Cluster hashes each key to one of 16,384 slots using [CRC16](https://valkey.io/topics/cluster-spec/) (the same algorithm described in the "What is Valkey Cluster?" section above). Keys on different slots can live on different nodes. Multi-key operations ([MGET](https://valkey.io/commands/mget/), [MSET](https://valkey.io/commands/mset/), pipeline commands spanning multiple keys) only work if all keys hash to the same slot.

Hash tags solve this. The cluster hashes only the portion of the key between `{` and `}`. So `genre:{fantasy}:books` and `genre:{fantasy}:count` both hash to the slot determined by `fantasy`, regardless of what surrounds the braces.

A warning on hash tags: every key sharing the same tag lands on the same slot, which means the same node. If you tag all your keys with a single value, you concentrate all traffic on one node and lose the sharding benefit entirely. That node becomes a hot shard, handling disproportionate load while the other primaries sit idle. Use hash tags narrowly, only for keys that genuinely need multi-key operations against each other, and never as a blanket pattern across all keys.

For our bookstore, this matters for pattern-based invalidation. `invalidate_pattern("genre:*")` uses [SCAN](https://valkey.io/commands/scan/), which works per-node. The cluster client handles this by scanning each node. No code change needed for SCAN, but be aware: pipelines that span keys on different slots will raise a `CrossSlotError`.

The cache warming pipeline from the 300-level queues [SET](https://valkey.io/commands/set/) commands for different genre keys. In cluster mode, those keys land on different slots. Replace the single pipeline with per-key `SET` calls, or group keys by slot. The simplest approach for our dataset size:

```python
# In warm_cache.py: replace pipe.execute() with individual SETs
for genre in genres:
    books = get_books_by_genre(genre)
    cache.set(f"genre:{genre}", books)
```

This trades the pipeline efficiency (one round-trip) for cluster compatibility (each SET routes to the correct node). For a small number of genres, the difference is negligible. For thousands of keys, you would group by slot and pipeline per-node, which is beyond the scope of this workshop.

### A3: Health check endpoint

A production deployment needs a health check that reports whether the application can actually serve requests. Returning 200 from a static endpoint proves the process is alive but says nothing about whether it can reach its dependencies.

#### Implementation

Open `app.py`. Add the `/health` route (import `get_connection` from `db` inside the function to avoid circular imports):

```python
@app.route("/health")
def health():
    """Probe dependencies and report readiness."""
    from db import get_connection

    checks = {}

    # Check PostgreSQL
    try:
        with get_connection() as conn:
            conn.execute("SELECT 1")
        checks["postgres"] = "ok"
    except Exception as exc:
        checks["postgres"] = f"error: {exc}"

    # Check Valkey Cluster
    try:
        if cache is not None and cache.is_connected:
            checks["valkey"] = "ok"
        elif cache is not None:
            checks["valkey"] = "error: ping failed"
        else:
            checks["valkey"] = "disabled"
    except Exception as exc:
        checks["valkey"] = f"error: {exc}"

    status = 200 if all(v == "ok" or v == "disabled" for v in checks.values()) else 503
    return jsonify(checks), status
```

This endpoint returns 200 when all probed dependencies respond, 503 otherwise. Container orchestrators (Docker health checks, Kubernetes readiness probes) call this endpoint to decide whether to route traffic to the instance.

### A4: Custom JSON serialization

The 300-level used `json.dumps()` directly. This works for dictionaries with strings, ints, and lists. It breaks on `datetime` objects, `Decimal` values, and other types that PostgreSQL returns depending on your schema.

Valkey also supports JSON as a native data type through the [JSON module](https://valkey.io/topics/json/) (available in Valkey 8.1+). With the JSON module, you can store, retrieve, and query JSON documents natively without serializing them to strings yourself. We are not using it in this workshop because we are building on the string-based caching pattern from the earlier levels, and the JSON module requires enabling it explicitly in your Valkey configuration. It is worth knowing it exists: for new projects where you control the Valkey deployment, native JSON eliminates the serialization step entirely.

For this workshop, we stay with `json.dumps()` and handle the edge cases with a custom encoder.

#### Implementation

Open `cache_layer.py` and add a custom encoder:

```python
import decimal
from datetime import datetime, date

class CacheEncoder(json.JSONEncoder):
    """Handle types that json.dumps rejects."""
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        return super().default(obj)
```

Then use it in the `set()` method:

```python
self._client.set(key, json.dumps(data, cls=CacheEncoder), ex=self._ttl_seconds)
```

This prevents serialization crashes without silently corrupting data. ISO format for timestamps is lossless and reversible. The `Decimal` to `float` conversion deserves a caveat: it is lossy for values with more than 15-16 significant digits. For the bookstore schema (integers and short strings), this is safe. For currency or financial data where precision beyond 15 digits matters, you would serialize Decimals as strings instead and parse them back on read.

## Part B: Operating the infrastructure layer

### B1: Understanding the cluster topology

The Docker Compose file starts 6 Valkey nodes: 3 primaries and 3 replicas. Each primary owns a range of hash slots. Each replica replicates one primary and can be promoted if the primary fails.

Inspect the topology:

```bash
docker compose exec valkey-1 valkey-cli cluster nodes
```

Each line shows a node ID, its role, the slots it owns (for primaries), and which primary it replicates (for replicas).

A note on terminology: the `cluster nodes` output uses "master" and "slave" in its flags and fields. This is legacy terminology carried over from earlier versions of the protocol. These terms are harmful, rooted in the history of human enslavement, and the industry is actively replacing them. The Valkey project and this workshop use "primary" and "replica" in all prose and documentation. When you see `master` or `slave` in command output, read them as "primary" and "replica." For more context, see the [Inclusive Naming Initiative](https://inclusivenaming.org/language/word-list/), a Linux Foundation project working to remove harmful language from technology.

Key concepts to observe:

- Slots are divided roughly equally: 0-5460, 5461-10922, 10923-16383
- Each replica's replication field points to the node ID of the primary it follows
- Flags include `myself`, `master` (primary), `slave` (replica), `connected`

### B2: Eviction policies under memory pressure

When Valkey runs out of memory, it has to decide what happens. The `maxmemory-policy` configuration controls this. For a caching use case, `allkeys-lru` is the standard choice: when memory is full, evict the least recently used key regardless of whether it has a TTL.

Valkey also supports `allkeys-lfu` (least frequently used). Where LRU evicts the key that has not been accessed for the longest time, LFU evicts the key that has been accessed the fewest times over its lifetime. LFU is better at keeping popular keys that are accessed in bursts (a key accessed 1,000 times yesterday but not yet today survives under LFU; under LRU it is eligible for eviction the moment something else gets accessed more recently).

The trade-off is overhead. LRU tracks a single timestamp per key (last access time), costing 24 bits of metadata. LFU tracks an access frequency counter per key, which Valkey implements as a logarithmic counter in 8 bits plus a decay timestamp in 16 bits. The memory difference per key is negligible, but the CPU cost differs: LFU requires updating and decaying the counter on every access, which adds a small amount of computation per operation. For most caching workloads, LRU is sufficient and simpler to reason about. Choose LFU when your access pattern has clear "hot" keys that you want to protect from eviction even during brief quiet periods.

This workshop uses `allkeys-lru`. If you want to experiment with LFU, change the policy in `docker-compose.yml` (`--maxmemory-policy allkeys-lfu`) and restart the cluster. Either way, eviction is the system performing cache invalidation on your behalf. In the 100-level, we quoted Phil Karlton calling cache invalidation one of the two hard problems in computer science. Eviction policies are the machine's answer to that problem: when you cannot decide what to invalidate, let recency (or frequency) decide for you.

The cluster nodes in this workshop are configured with a small `maxmemory` (16 MB per node) so you can observe eviction without filling gigabytes of RAM.

#### Observing eviction

Load the bookstore. Browse several genres and books to populate the cache. Then fill memory with dummy keys:

```bash
docker compose exec valkey-1 valkey-cli debug populate 100000 dummy 1024
```

This creates 100,000 keys of ~1 KB each on the node, blowing past the 16 MB limit. (`DEBUG` commands are disabled by default in production Valkey configurations and should never run against production data. We use it here in a disposable local environment to simulate memory pressure quickly.) Now check:

```bash
docker compose exec valkey-1 valkey-cli info memory
```

Look at `used_memory_human` and `evicted_keys`. The node evicted older keys to stay under `maxmemory`. Your bookstore cache entries may be among the evicted. Reload a genre page in the browser: you will see a cache MISS and a fresh database query, proving the eviction worked and the application handled it gracefully (the circuit breaker and cache-aside pattern absorb eviction transparently).

### B3: Node failure and automatic failover

Stop a primary node:

```bash
docker compose stop valkey-1
```

Wait 5-10 seconds (the `cluster-node-timeout` is set to 5000ms). Check the cluster state:

```bash
docker compose exec valkey-2 valkey-cli cluster nodes
```

The replica that was following `valkey-1` is now promoted to primary. The cluster state remains `ok`. The slots that `valkey-1` owned are now served by the promoted replica.

Load a page in the bookstore. It still works. The `ValkeyCluster` client detected the topology change and routes commands to the new primary.

A caveat on data loss: Valkey replication is asynchronous. A write acknowledged by the primary but not yet replicated to the replica is lost on failover. For a cache, this is harmless (the lost key becomes a miss, and the application rebuilds it from the database). For systems using Valkey as a primary data store, asynchronous replication means writes can be lost in a failover window. This workshop uses Valkey strictly as a cache, so the behavior is safe.

Bring the node back:

```bash
docker compose start valkey-1
```

It rejoins as a replica of the node that was promoted. The cluster rebalances automatically.

### B4: Resharding (adding capacity)

The Docker Compose file includes 6 nodes, but you can scale further. To add a 7th node and migrate slots to it:

```bash
docker compose exec valkey-1 valkey-cli --cluster add-node <new-node-ip>:7007 <existing-node-ip>:7001
docker compose exec valkey-1 valkey-cli --cluster reshard <existing-node-ip>:7001
```

The reshard command prompts for how many slots to move and which node receives them. This is a live operation: the cluster continues serving requests during the migration.

This section is a demonstration, not a hands-on exercise. Adding a 7th node to Docker Compose requires modifying the compose file. The point is seeing the commands and understanding that Valkey Cluster supports live resharding without downtime.

## Part C: Putting it all together

### The production stack

1. App starts. Connection pool opens 2 persistent connections to PostgreSQL.
2. `ValkeyCluster` client discovers all 6 nodes from a single seed.
3. Cache warming writes keys to the correct nodes (each SET routes automatically).
4. Requests come in. Reads route to the node owning that key's slot. Writes go to the primary, replicate to its replica.
5. A primary dies. The cluster promotes a replica. The client detects the change. Cached values that finished replicating are preserved. Any writes in flight during the failover window become misses (the app rebuilds them from PostgreSQL).
6. Memory fills up. Eviction removes LRU keys. The app handles misses as normal.
7. `/health` reports dependency status. If PostgreSQL or Valkey is unreachable, the orchestrator stops routing traffic.

### Load testing

Run the provided load test (from the `python/` directory):

```bash
python load_test.py
```

While the load test runs, try killing a node (`docker compose stop valkey-2`) and watch:

- Brief spike in latency as the client discovers the topology change
- No errors returned to the load test (the circuit breaker absorbs the transition)
- Hit rate recovers within seconds as the promoted replica begins serving

## Going further

This workshop covers the operational basics. Topics for further study:

- [Valkey Cluster tutorial](https://valkey.io/topics/cluster-tutorial/) for the full specification
- [Valkey key eviction](https://valkey.io/topics/lru-cache/) for eviction algorithm details
- [Valkey Admin](https://valkey-admin.valkey.io/) for visual cluster management (covered briefly in the 300-level)
- [psycopg_pool documentation](https://www.psycopg.org/psycopg3/docs/api/pool.html) for advanced pool configuration
- [Valkey persistence (RDB and AOF)](https://valkey.io/topics/persistence/) for durability beyond in-memory caching
- [Valkey Cluster specification](https://valkey.io/topics/cluster-spec/) for the gossip protocol and failure detection internals

## Help

If something is not working, check [TROUBLESHOOTING.md](TROUBLESHOOTING.md). For deeper explanations of design decisions, see [FAQ.md](FAQ.md).

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines on adding language implementations or improving workshop content.

## License

[WTFPL](../../LICENSE)
