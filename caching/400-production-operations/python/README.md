# Production Operations with Valkey Cluster

In the 300-level workshop you built resilience into a single-node setup: cache warming, stampede prevention, circuit breakers, and observability. All of that assumed one Valkey instance. Production systems rarely run a single instance. They run clusters: data sharded across multiple nodes, replicas for failover, memory limits enforced with eviction policies. The application code changes too. Connections become pooled resources. Serialization needs to handle types that `json.dumps` rejects. Health checks need to probe real dependencies, not just return 200.

This workshop splits into three sections. Part A hardens the application layer (your code). Part B introduces Valkey Cluster (your infrastructure). Part C ties them together with a full lifecycle walkthrough and load test. All three use the bookstore app from the [200](../../200-database-caching/) and [300-level](../../300-protecting-cache/), with a smaller catalog: 15 books across five genres (computing, engineering, networking, non-fiction, and science fiction).

By the end you will have:

1. Replaced per-request database connections with a connection pool
2. Replaced the single Valkey client with a cluster-aware client, and confirmed that cache warming and stampede protection keep working on it
3. Handled hash slot constraints and cross-slot limitations
4. Added a health check endpoint that probes PostgreSQL and Valkey
5. Added a JSON encoder for types that `json.dumps` rejects
6. Observed eviction under memory pressure
7. Run the bookstore on a 6-node Valkey Cluster with automatic failover
8. Created a hot shard and spotted it with per-node statistics

A note on scope: this workshop gives you hands-on experience with the operational concerns that appear at production scale. It does not cover every production topic (security hardening, capacity planning, backup strategies, incident response). What it does give you is vocabulary, working code, and enough understanding to know what to look up next.

We are assuming you completed the [300-level workshop](../../300-protecting-cache/). Cache warming, stampede prevention, and circuit breakers should be familiar. If they are not, go back.

You will need Python 3.9 or later, Docker, a text editor, a terminal, and git. The Docker Compose setup for this workshop runs 8 containers (6 Valkey cluster nodes, a cluster initializer, and PostgreSQL), which requires more resources than earlier workshops. Ensure Docker Desktop has at least 4 GB of memory allocated. On Linux or Windows, read the [platform notes](../../../README.md#platform-notes) first.

## What is Valkey Cluster?

In the previous workshops, you ran a single Valkey instance. One process, one port, all keys in one place. That works for development and low-traffic production, but it has two limits: the data has to fit in one machine's memory, and if that machine goes down, the cache is gone.

Valkey Cluster solves both problems. It splits the keyspace into 16,384 hash slots and distributes those slots across multiple primary nodes. Each primary owns a range of slots and stores only the keys that hash into that range. When your application writes `genre:computing`, Valkey runs [CRC16](https://valkey.io/topics/cluster-spec/) (a fast 16-bit cyclic redundancy check, producing a value between 0 and 65535) on the key name, takes the result modulo 16,384, and routes the write to the node that owns that slot. (Why 16,384 specifically? See the [FAQ](FAQ.md#why-16384-hash-slots).)

Each primary has one or more replicas. The replica copies everything the primary does. If the primary dies, the cluster promotes the replica to take over those slots. Your application sees a brief interruption (about 7 seconds in our tests on this workshop's cluster, which uses a 5-second node timeout), then continues as if nothing happened.

From the application's perspective, a cluster-aware client (like [`ValkeyCluster`](https://valkey-py.readthedocs.io/en/latest/connections.html#valkey.cluster.ValkeyCluster) in valkey-py) handles the routing transparently. You issue commands the same way you always have. The client figures out which node should receive each one. The only thing that changes in your code is the client initialization and an awareness of cross-slot limitations (which we cover in Part A2).

The [Valkey Cluster tutorial](https://valkey.io/topics/cluster-tutorial/) covers the full specification. This workshop gives you the hands-on experience of running and operating a cluster locally.

## Setup

Start the infrastructure, install dependencies, and seed the database.

**1. Start the Valkey Cluster and PostgreSQL:**

```bash
cd caching/400-production-operations
docker compose up -d
```

Wait for the cluster to form. The `cluster-init` service runs `valkey-cli --cluster create` and exits once the cluster is healthy. Check its logs to confirm:

```bash
docker compose logs cluster-init
```

You should see a message like "Cluster creation successful" or "All 16384 slots covered." If you run `docker compose up -d` again later, `cluster-init` runs again, finds the existing cluster, and prints "Cluster already exists. Nothing to do." instead. If you see connection errors, wait a few seconds and check again (the nodes need time to start).

Verify the cluster state:

```bash
docker compose exec valkey-1 valkey-cli cluster info
```

Look for `cluster_state:ok` and `cluster_slots_assigned:16384`.

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

The defaults connect to the cluster through the first node (`localhost:7001`). The Valkey client auto-discovers the other nodes.

**4. Seed the database:**

```bash
python seed_db.py
```

**5. Start the application (without Part A changes, just to see it run):**

```bash
python app.py
```

Open http://localhost:5000 in your browser. Click a genre. The app connects to the first cluster node as if it were a standalone instance. Keys whose hash slot lives on that node work at first. Keys on other nodes come back as MOVED errors, which the cache layer counts as failures and treats as misses; after three of them the circuit breaker opens, and every request skips the cache until the 30-second cooldown passes. The app still functions because cache-aside falls through to PostgreSQL on every miss. This is the problem you will fix in Part A2 by switching to a cluster-aware client. Stop the app before continuing.

## Part A: Hardening the application layer

### A1: Connection pooling for PostgreSQL

In the 300-level, every database call opened a new TCP connection to PostgreSQL and closed it after the query. For a workshop with one user, that is fine. For a production app handling hundreds of concurrent requests, creating and tearing down TCP connections on every query adds latency and exhausts database connection slots.

`psycopg_pool` provides a `ConnectionPool` that maintains a set of open connections. Your code borrows a connection from the pool, runs a query, and returns it. The TCP handshake happens once at startup, not on every request.

#### Implementation

Open `db.py`. Add the `psycopg_pool` import at the top and replace `get_connection()` with a module-level pool:

```python
from psycopg_pool import ConnectionPool

_pool = ConnectionPool(
    conninfo=os.environ.get("DATABASE_URL", "postgresql://workshop:workshop@localhost:5432/bookstore"),
    min_size=int(os.environ.get("DB_POOL_MIN_SIZE", "2")),
    max_size=int(os.environ.get("DB_POOL_MAX_SIZE", "10")),
    open=True,
)


def get_connection():
    """Borrow a connection from the pool."""
    return _pool.connection()
```

The pool keeps at least `min_size` connections open and opens more on demand, up to `max_size`. Both come from `DB_POOL_MIN_SIZE` and `DB_POOL_MAX_SIZE` in your `.env` (2 and 10 by default).

Note on `open=True`: this tells the pool to start opening connections as soon as `db.py` is imported. It does not wait for them, so if PostgreSQL is not reachable when the app starts (common in container orchestration where startup order is not guaranteed), the app still starts, but anything that needs a connection waits up to 30 seconds and then fails with `couldn't get a connection after 30.00 sec`. In this workshop, that shows up first as a slow startup, because cache warming queries the database before the app begins serving. You avoid it here by starting the app only after `docker compose ps` shows PostgreSQL as healthy; the Compose health check reports readiness, but it cannot hold back an app that runs on your machine rather than in Compose. In production, you would either use `open=False` with explicit `pool.open()` after confirming connectivity, or add retry logic at startup.

The rest of `db.py` (the query functions) does not change. They already use `with get_connection() as conn:`, which returns the connection to the pool when the block exits.

#### Observing it

Start the app again with `python app.py` (you stopped it at the end of Setup). Load several pages quickly. In a separate terminal (in the `400-production-operations` directory), check PostgreSQL connection count:

```bash
docker compose exec postgres psql -U workshop -d bookstore -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'bookstore';"
```

With pooling, the count stays bounded however many requests you send, because each pool holds between `min_size` and `max_size` connections (2 and 10). Expect more than one pool's worth: in debug mode the reloader's watcher process imports `db.py` too and holds a pool of its own, and the `psql` session running the query counts as one more. In our test the count was 7 after a few page loads and 8 after the 60 requests of the Part C load test. Without pooling, each concurrent request would show a separate connection.

### A2: Cluster-aware Valkey client

The 300-level `CacheLayer` used `valkey.Valkey()`, a single-node client. Valkey Cluster distributes keys across hash slots on different nodes. A single-node client talks to one node. If you write to a key whose slot lives on a different node, the server returns a [MOVED](https://valkey.io/topics/cluster-spec/) redirect. The single-node client does not handle redirects.

[`valkey.ValkeyCluster`](https://valkey-py.readthedocs.io/en/latest/connections.html#valkey.cluster.ValkeyCluster) handles this transparently. It discovers the cluster topology, routes commands to the correct node, and follows [MOVED and ASK](https://valkey.io/topics/cluster-spec/) redirects automatically.

#### Implementation

Open `cache_layer.py`. First, add the cluster client import near the top of the file, below `import valkey`:

```python
from valkey.cluster import ValkeyCluster, ClusterNode
```

Then, inside `__init__`, replace the single-node client (the `# Part A2: Replace this single-node client...` comment, the `# See the README...` comment under it, and the three lines from `host = ...` through `self._client = valkey.Valkey(...)`) with this block. It is indented 8 spaces to sit inside `__init__`:

```python
        startup_nodes = [ClusterNode(host, int(port)) for host, port in
                         [node.split(":") for node in
                          os.environ.get("VALKEY_CLUSTER_NODES", "localhost:7001").split(",")]]

        self._client = ValkeyCluster(
            startup_nodes=startup_nodes,
            decode_responses=True,
            skip_full_coverage_check=True,
            address_remap=to_host_address,
        )
```

`address_remap=to_host_address` refers to a small function you add in the next step, "Advertised addresses versus reachable addresses." Add it before you save the file: debug mode restarts the app on every save, and until the function exists, the app starts without a cache.

The client only needs one seed node to discover the full topology. We pass multiple for resilience: if the first node is down at startup, the client tries the next.

#### Advertised addresses versus reachable addresses

When the client connects to the seed node, it asks the cluster which node owns which slots. Each node answers with its own idea of its address: the one it has on the Docker network (`172.30.0.11` through `172.30.0.16`, set in `docker-compose.yml`). Containers on that network can reach those addresses. On macOS and Windows your machine can't, because Docker Desktop does not route traffic from the host into its bridge networks. Without help, the client discovers the topology and then times out trying to reach every node it just discovered. (Docker Engine on Linux does route to those addresses. The mapping below is not required there, but it does no harm.)

The `address_remap` option fixes this. The client calls it on every address the cluster advertises, before connecting, and uses whatever address it returns. Add this function at module level in `cache_layer.py`, above the `CacheLayer` class:

```python
# Each node advertises its Docker network address (172.30.0.11-16, set in
# docker-compose.yml). Your machine can't reach those addresses, so map each
# one to the port Docker publishes for that node on localhost (7001-7006).
DOCKER_TO_HOST = {f"172.30.0.{10 + n}": 7000 + n for n in range(1, 7)}


def to_host_address(address):
    """Translate a node address the cluster advertises into one this machine can reach."""
    host, port = address
    if host in DOCKER_TO_HOST:
        return ("localhost", DOCKER_TO_HOST[host])
    return address
```

This is the same problem you meet in production whenever clients sit on a different network from the cluster: behind NAT, across a port forward, or outside a Kubernetes cluster. Valkey can solve it on the server side instead, with the `cluster-announce-*` settings covered under "Valkey Cluster with containers and NAT" in the [Valkey cluster tutorial](https://valkey.io/topics/cluster-tutorial/), but then every client, including `valkey-cli` running inside the containers, sees the announced address. Mapping in the client keeps the cluster's own tooling working unchanged, which is what you want in a local environment.

#### Hash tags and cross-slot limitations

Valkey Cluster hashes each key to one of 16,384 slots using [CRC16](https://valkey.io/topics/cluster-spec/) (the same algorithm described in the "What is Valkey Cluster?" section above). Keys on different slots can live on different nodes. Multi-key commands such as [MGET](https://valkey.io/commands/mget/) and [MSET](https://valkey.io/commands/mset/) only work if all their keys hash to the same slot.

Hash tags solve this. The cluster hashes only the portion of the key between `{` and `}`. So `genre:{computing}:books` and `genre:{computing}:count` both hash to the slot determined by `computing`, regardless of what surrounds the braces.

A warning on hash tags: every key sharing the same tag lands on the same slot, which means the same node. If you tag all your keys with a single value, you concentrate all traffic on one node and lose the sharding benefit entirely. That node becomes a hot shard, handling disproportionate load while the other primaries sit idle. Use hash tags narrowly, only for keys that genuinely need multi-key operations against each other, and never as a blanket pattern across all keys.

For our bookstore, this matters for pattern-based invalidation. `invalidate_pattern("genre:*")` uses [SCAN](https://valkey.io/commands/scan/), which works per-node. The cluster client handles this by scanning each node. No code change needed for SCAN. Pipelines also keep working across slots: `ValkeyCluster` splits a pipeline by node and sends each node the commands for the keys it owns, so you pay one round trip per node instead of one in total. What fails is a single command that names several keys on different slots, such as `MSET` or `MGET`. The server rejects it with `CROSSSLOT Keys in request don't hash to the same slot`, and valkey-py checks this before sending, raising `ValkeyClusterException: MSET - all keys must map to the same key slot`.

#### Cache warming in cluster mode

The starter carries forward `warm_cache.py` from the 300-level, and `app.py` still calls it at startup. It queues a [SET](https://valkey.io/commands/set/) for the genre list and one for each genre's listing, then sends them as a single pipeline. Those keys hash to different slots owned by different primaries, so it is fair to ask whether the pipeline survives the move to a cluster.

It does, with no code change. Once `self._client` is a `ValkeyCluster`, `cache.pipeline()` returns a cluster pipeline. When you call `execute()`, it works out which node owns each queued key, splits the commands into one batch per node, and sends each batch to its node. The 300-level pipeline made one network round trip; on this cluster the same code makes one round trip per primary, three in total. You can confirm it in the app log at startup:

```
INFO:warm_cache: Cache warmed: 6 keys in 47 ms
```

The time varies with your machine. The point is that the line says "Cache warmed" rather than "Cache warming failed." Before you finish this part, while `self._client` is still the single-node client, the same startup step logs `Cache warming failed ... MOVED`, because a single-node client cannot follow keys to other nodes.

The distinction to remember is between a pipeline and a multi-key command. A pipeline is many single-key commands, and the cluster client can split it. A command like `MSET` that names several keys in one call cannot be split, and it fails unless every key shares a slot, which is where hash tags come in.

#### Stampede protection in cluster mode

The genre route also keeps the 300-level stampede protection: `get_with_lock()` takes a short-lived lock with `SET lock:genre:<name> 1 NX EX 5` so that only one request rebuilds a missing genre listing, and the route releases it in a `finally` block. The lock key and the data key (`genre:<name>`) hash to different slots, and those slots can belong to different primaries (on this cluster, `genre:engineering` lives on one primary and `lock:genre:engineering` on another). That causes no trouble, for the same reason the warming pipeline works: every command in `get_with_lock()` names a single key, so the cluster client routes each one to the node that owns it. Nothing in the method changes for the cluster.

### A3: Health check endpoint

A production deployment needs a health check that reports whether the application can actually serve requests. Returning 200 from a static endpoint proves the process is alive but says nothing about whether it can reach its dependencies.

The important design question is which dependencies are required. This app cannot serve a single page without PostgreSQL, so a failed database check must fail the health check. Valkey is different: every page still works from PostgreSQL when the cache is down (you built that fallback in the 200-level and the circuit breaker in the 300-level). If a cache outage failed the health check, an orchestrator would pull a working instance out of service. So the cache is an optional dependency: its state is reported, as `"degraded"` when something is wrong, but it never turns a 200 into a 503.

#### Implementation

First, open `cache_layer.py` and add a method that asks every primary whether it is up. A plain `ping()` on a `ValkeyCluster` goes to a single node, so on its own it cannot tell you that one primary out of three is down. Add this method to the `CacheLayer` class:

```python
    def primaries_status(self):
        """Ping every primary separately. Returns (reachable, total).

        A plain ping() goes to a single node, so it cannot tell you that one
        primary out of three is down. Asking each primary can.
        """
        primaries = self._client.get_primaries()
        reachable = 0
        for node in primaries:
            try:
                if self._client.ping(target_nodes=node):
                    reachable += 1
            except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError):
                pass
        return reachable, len(primaries)
```

Then open `app.py` and add the `/health` route (import `get_connection` from `db` inside the function, the same way the other routes import their database functions):

```python
@app.route("/health")
def health():
    """Report readiness. PostgreSQL is required; the cache is optional.

    Every page still works from PostgreSQL when Valkey is unavailable, so a
    cache problem is reported as "degraded" but does not fail the check.
    """
    from db import get_connection

    checks = {}

    # PostgreSQL: required. Without it the app cannot serve pages.
    try:
        with get_connection() as conn:
            conn.execute("SELECT 1")
        checks["postgres"] = "ok"
    except Exception as exc:
        checks["postgres"] = f"error: {exc}"

    # Valkey Cluster: optional. Report its state, but never fail the check for it.
    if not CACHE_ENABLED:
        checks["valkey"] = "disabled"
    elif cache is None:
        checks["valkey"] = f"degraded: not connected at startup ({cache_startup_error})"
    else:
        reachable, total = cache.primaries_status()
        if reachable == total:
            checks["valkey"] = "ok"
        else:
            checks["valkey"] = f"degraded: {total - reachable} of {total} primaries unreachable"

    status = 200 if checks["postgres"] == "ok" else 503
    return jsonify(checks), status
```

This endpoint returns 200 whenever PostgreSQL answers and 503 when it does not. The `"valkey"` entry reads `ok` when every primary answers, and `degraded: 1 of 3 primaries unreachable` (or similar) when some do not; you will see that during the failover exercise in Part B3. The `cache_startup_error` variable comes from the cache setup at the top of `app.py`: `ValkeyCluster` connects as soon as it is created, so the starter wraps that step in a `try`. If the cluster is unreachable when the app starts, the app keeps serving from PostgreSQL, and `/health` reports `degraded: not connected at startup (...)` with the reason. Container orchestrators (Docker health checks, Kubernetes readiness probes) call this endpoint to decide whether to route traffic to the instance.

### A4: Custom JSON serialization

The 300-level used `json.dumps()` directly. This works for dictionaries with strings, ints, and lists. It breaks on `datetime` objects, `Decimal` values, and other types that PostgreSQL returns depending on your schema.

Valkey also supports JSON as a native data type through the [JSON module](https://valkey.io/topics/valkey-json/) (compatible with Valkey 8.0 and above). With the JSON module, you can store, retrieve, and query JSON documents natively without serializing them to strings yourself. We are not using it in this workshop because we are building on the string-based caching pattern from the earlier levels, and the JSON module requires enabling it explicitly in your Valkey configuration. It is worth knowing it exists: for new projects where you control the Valkey deployment, native JSON eliminates the serialization step entirely.

For this workshop, we stay with `json.dumps()` and handle the edge cases with a custom encoder.

#### Implementation

Open `cache_layer.py` and add a custom encoder at module level, above the `CacheLayer` class:

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

Then, in the `set()` method, replace the `self._client.set(...)` line with:

```python
self._client.set(key, json.dumps(data, cls=CacheEncoder), ex=self._ttl_seconds)
```

This prevents serialization crashes without silently corrupting data. ISO format for timestamps is lossless and reversible. The `Decimal` to `float` conversion deserves a caveat: it is lossy for values with more than 15-16 significant digits. For the bookstore schema (integers and short strings), this is safe. For currency or financial data where precision beyond 15 digits matters, you would serialize Decimals as strings instead and parse them back on read.

`warm_cache.py` serializes with plain `json.dumps()` too. It can stay that way here, because the genre listings it writes hold only text and integer columns. If you warm data that includes timestamps or numeric columns, import `CacheEncoder` from `cache_layer` and pass `cls=CacheEncoder` there as well.

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

Valkey also supports `allkeys-lfu` (least frequently used). Where LRU evicts the key that has not been accessed for the longest time, LFU evicts the key that has been accessed the fewest times over its lifetime. LFU is better at keeping popular keys that are accessed in bursts. Suppose a key was read 1,000 times in the last few minutes, and then a batch of other keys is each read once. Under LRU, the popular key is now among the least recently used, so it becomes an eviction candidate; under LFU, its high access count protects it. That protection fades once the key goes quiet. According to the [Valkey key eviction](https://valkey.io/topics/lru-cache/) documentation, the counter reaches only 18 after 1,000 hits at the default `lfu-log-factor` of 10, and it decays every minute by default (`lfu-decay-time 1`), so a key that stops being read loses its advantage within about twenty minutes.

The trade-off is not memory. Every key carries one 24-bit field that holds either the LRU value (a timestamp in seconds) or, under LFU, a 16-bit last-evaluation time plus an 8-bit logarithmic counter, as the comment at the top of [`lrulfu.h`](https://github.com/valkey-io/valkey/blob/unstable/src/lrulfu.h) in the Valkey source describes. Switching policies costs nothing per key. The difference is behavior: LFU depends on the two tunables above, and a key that was hot keeps its advantage for minutes after it goes quiet. LRU needs no tuning, which makes it the simpler default. Choose LFU when your access pattern has clear "hot" keys that you want to protect from eviction even during brief quiet periods.

This workshop uses `allkeys-lru`. If you want to experiment with LFU, change the policy in `docker-compose.yml` (`--maxmemory-policy allkeys-lfu`) and restart the cluster. Either way, eviction is the system performing cache invalidation on your behalf. In the 100-level, we quoted Phil Karlton calling cache invalidation one of the two hard problems in computer science. Eviction policies are the machine's answer to that problem: when you cannot decide what to invalidate, let recency (or frequency) decide for you.

The cluster nodes in this workshop are configured with a small `maxmemory` (16 MB per node) so you can observe eviction without filling gigabytes of RAM.

#### Observing eviction

Load the bookstore. Browse several genres and books to populate the cache. Then fill memory with dummy keys:

```bash
docker compose exec valkey-1 valkey-cli debug populate 100000 dummy 1024
```

This creates 100,000 keys of ~1 KB each on the node, blowing past the 16 MB limit. (Valkey disables `DEBUG` commands by default, and they should never run against production data. The workshop's `docker-compose.yml` turns them on with `--enable-debug-command local`, which accepts `DEBUG` only from connections made inside the container. That is why this command runs through `docker compose exec`. We use it here in a disposable local environment to simulate memory pressure quickly.) Now check:

```bash
docker compose exec valkey-1 valkey-cli info memory | grep used_memory_human
docker compose exec valkey-1 valkey-cli info stats | grep evicted_keys
```

`used_memory_human` comes from the memory section of [INFO](https://valkey.io/commands/info/) and `evicted_keys` from the stats section. Valkey evicts while it processes later commands, not during `debug populate` itself, so the first memory reading can still be far above 16 MB. Run the two commands again and memory settles at the limit while `evicted_keys` climbs into the tens of thousands. The node evicted older keys to stay under `maxmemory`.

Whether any of your bookstore cache entries were evicted depends on where they live. Only keys stored on `valkey-1` can be: each key lives on the primary that owns its hash slot, and the other primaries were never under pressure. Reload the genre pages you browsed earlier. Any whose key was evicted shows a cache MISS and a fresh database query, while genres stored on other nodes still show a HIT. Either way the page loads. To the application, an evicted key is an ordinary miss: `GET` returns nothing, no error is raised, the circuit breaker never sees a failure, and cache-aside rebuilds the entry from PostgreSQL.

### B3: Node failure and automatic failover

Stop a primary node:

```bash
docker compose stop valkey-1
```

Wait 5-10 seconds (the `cluster-node-timeout` is set to 5000ms). Check the cluster state:

```bash
docker compose exec valkey-2 valkey-cli cluster nodes
```

The replica that was following `valkey-1` is now promoted to primary, and the slots that `valkey-1` owned are served by the promoted replica. Run `docker compose exec valkey-2 valkey-cli cluster info` and `cluster_state` reads `ok`. In our test, checking `valkey-2` once a second from the moment `valkey-1` stopped, it read `ok` at every check.

Load a page in the bookstore. It still works. The `ValkeyCluster` client detected the topology change and routes commands to the new primary.

Watch the health check while this happens. Open http://localhost:5000/health right after stopping the node: it returns 200 with `"valkey": "degraded: 1 of 3 primaries unreachable"`, because the app keeps serving every page while the cluster recovers. Once the replica is promoted, it reads `ok` again; in tests on this workshop's cluster that took 7 to 9 seconds.

A caveat on data loss: Valkey replication is asynchronous. A write acknowledged by the primary but not yet replicated to the replica is lost on failover. For a cache, this is harmless (the lost key becomes a miss, and the application rebuilds it from the database). For systems using Valkey as a primary data store, asynchronous replication means writes can be lost in a failover window. This workshop uses Valkey strictly as a cache, so the behavior is safe.

Bring the node back:

```bash
docker compose start valkey-1
```

It rejoins as a replica of the node that was promoted. The slots stay with the new primary; nothing moves back on its own. (If you want `valkey-1` to be a primary again, for example to repeat the eviction exercise from Part B2, run `docker compose exec valkey-1 valkey-cli cluster failover`.)

### B4: Resharding (adding capacity)

The Docker Compose file includes 6 nodes, but you can scale further. To add a 7th node and migrate slots to it:

```bash
docker compose exec valkey-1 valkey-cli --cluster add-node <new-node-ip>:6379 172.30.0.11:6379
docker compose exec valkey-1 valkey-cli --cluster reshard 172.30.0.11:6379
```

Inside the Docker network every node listens on port 6379; ports 7001 to 7006 exist only on your machine, so these commands use the network addresses. The reshard command prompts for how many slots to move and which node receives them. This is a live operation: the cluster continues serving requests during the migration.

This section is a demonstration, not a hands-on exercise. Adding a 7th node to Docker Compose requires modifying the compose file. The point is seeing the commands and understanding that Valkey Cluster supports live resharding without downtime.

### B5: Spotting a hot shard

In Part A2 you read a warning about hash tags: tag too many keys with the same value and they all land on one primary, which then does all the work for them. That primary is called a hot shard. In this part you create one and watch it happen.

To see it, you need statistics per node. The `get_stats()` method you carried forward from the 300-level calls `info()` and `dbsize()` with no target, and in cluster mode those commands run on a single node, so `/stats` has been reporting one primary's numbers as if they were the whole cluster's. Open `cache_layer.py` and replace `get_stats()` with a version that asks each primary separately, adds the numbers up, and keeps the per-node figures:

```python
    def get_stats(self):
        """Cluster-wide cache statistics, plus one entry per primary.

        In cluster mode, INFO and DBSIZE run on a single node unless you name
        the nodes yourself, so this asks each primary separately and adds the
        numbers up. Replicas are left out: they hold copies of their primary's
        keys and do not serve this app's reads.
        """
        if self._circuit_is_open():
            return None

        nodes = []
        hits_total = misses_total = keys_total = memory_total = clients_total = 0
        for node in self._client.get_primaries():
            try:
                stats = self._client.info("stats", target_nodes=node)
                memory = self._client.info("memory", target_nodes=node)
                clients = self._client.info("clients", target_nodes=node)
                keys = self._client.dbsize(target_nodes=node)
            except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError) as exc:
                logger.warning("Valkey connection error on get_stats() for %s: %s", node.name, exc)
                nodes.append({"node": node.name, "error": str(exc)})
                continue

            hits = stats.get("keyspace_hits", 0)
            misses = stats.get("keyspace_misses", 0)
            nodes.append({
                "node": node.name,
                "total_keys": keys,
                "keyspace_hits": hits,
                "keyspace_misses": misses,
                "hit_rate": round(hits / (hits + misses), 4) if hits + misses else 0.0,
                "used_memory_human": memory.get("used_memory_human", "unknown"),
            })
            hits_total += hits
            misses_total += misses
            keys_total += keys
            memory_total += memory.get("used_memory", 0)
            clients_total += clients.get("connected_clients", 0)

        if all("error" in n for n in nodes):
            self._record_failure()
            return None

        self._record_success()
        lookups = hits_total + misses_total
        return {
            "hit_rate": round(hits_total / lookups, 4) if lookups else 0.0,
            "keyspace_hits": hits_total,
            "keyspace_misses": misses_total,
            "used_memory_human": f"{memory_total / (1024 * 1024):.2f}M",
            "connected_clients": clients_total,
            "total_keys": keys_total,
            "nodes": sorted(nodes, key=lambda n: n["node"]),
        }
```

Restart the app (saving `cache_layer.py` does this in debug mode) and open http://localhost:5000/stats. The top-level numbers now cover the whole cluster, and the `nodes` list shows each primary's share. With only the bookstore's keys cached, the shares are small and uneven, because a handful of keys cannot spread evenly across three nodes.

#### Creating a hot shard

From the `python/` directory, write 1,000 keys with no hash tag:

```bash
python hot_shard.py spread
```

The script prints how many keys landed on each primary, and `/stats` shows the same split under `nodes`: roughly a third each, because each key's whole name is hashed and the results scatter across all 16,384 slots. Now write 1,000 keys that share one hash tag:

```bash
python hot_shard.py tagged
```

The keys are named `demo:{hot}:0`, `demo:{hot}:1`, and so on. Only `hot`, the part inside the braces, is hashed, so every key gets the same slot and lands on the same primary. Reload `/stats`: one entry under `nodes` jumps by 1,000 keys while the other two stay where they were. Every read and write for those keys now goes to that one node, however many primaries the cluster has. Both sets of demo keys expire after 120 seconds.

The lesson carries over to real data. A per-node view like this one is how you spot a hot shard in production: one primary with far more keys, memory, or traffic than its peers. The usual causes are a hash tag applied too broadly or a single very popular key, and the fix is to tag only keys that genuinely need multi-key operations together.

The per-node view also shows failover. If you repeat the stop from Part B3 now, the `nodes` list shows the promoted replica in `valkey-1`'s place, holding the keys it replicated.

## Part C: Putting it all together

### The production stack

1. App starts. Connection pool opens 2 persistent connections to PostgreSQL.
2. `ValkeyCluster` client discovers all 6 nodes from a single seed.
3. Cache warming writes keys to the correct nodes (each SET routes automatically).
4. Requests come in. On a genre miss, the stampede lock lets one request rebuild while the others wait briefly for the result. Reads route to the node owning that key's slot. Writes go to the primary, replicate to its replica.
5. A primary dies. The cluster promotes a replica. The client detects the change. Cached values that finished replicating are preserved. Any writes in flight during the failover window become misses (the app rebuilds them from PostgreSQL).
6. Memory fills up. Eviction removes LRU keys. The app handles misses as normal.
7. `/health` reports dependency status. If PostgreSQL is unreachable, it returns 503 and the orchestrator stops routing traffic. A Valkey problem is reported as degraded but does not fail the check, because the app keeps serving from PostgreSQL.

### Load testing

Run the provided load test (from the `python/` directory):

```bash
python load_test.py
```

The script sends 60 requests (five to each of twelve endpoints, including `/health` and `/stats`) across ten threads, and it finishes in well under a second. That is too fast to stop a node in the middle of a run, so stop the node first. From the `400-production-operations` directory:

```bash
docker compose stop valkey-2
```

Then, from `python/`, run `python load_test.py` right away and again about 10 seconds later. In a test run on this workshop's cluster, both runs showed the same pattern:

- Every page request succeeded. While the cluster fails over, the cache layer treats each failed Valkey call as a cache miss and the page is served from PostgreSQL. After a few failures the circuit breaker opened, which stopped the app from retrying Valkey on every request.
- The five `/stats` requests in each run returned 503, and the load test counts them as failures. `/stats` does not answer while the circuit breaker is open (30 seconds by default after it opens). That is expected; reload `/stats` after the cooldown and it answers again, with the promoted replica in the `nodes` list.
- The slowest request took longer while the client found the new topology: 105 ms in the first run, against 33 ms before the node stopped.

Start the node again when you are done:

```bash
docker compose start valkey-2
```

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

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for guidelines on adding language implementations or improving workshop content.

## License

[WTFPL](../../../LICENSE)
