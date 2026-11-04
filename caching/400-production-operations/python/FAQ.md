# FAQ: Production Operations with Valkey Cluster

## Why use a connection pool instead of opening connections per request?

Each TCP connection to PostgreSQL involves a handshake, authentication, and session setup. Under concurrent load, creating hundreds of short-lived connections saturates the database's `max_connections` limit and adds latency to every request that has to wait for a new connection, more so over a network than on localhost. A pool amortizes that cost across the lifetime of the application. The connections stay open; your code borrows and returns them.

## Why ValkeyCluster instead of just Valkey with one node's port?

A single-node client does not understand cluster topology. If you send a command to a node that does not own the target key's hash slot, the server responds with a [MOVED](https://valkey.io/topics/cluster-spec/) error pointing to the correct node. A regular `Valkey()` client does not follow it; it raises the reply as a `ResponseError` (`MOVED 6681 172.30.0.12:6379`). The workshop's `CacheLayer` catches that error like a connection failure: it logs a "Valkey connection error" warning, counts it toward the circuit breaker, and falls back to PostgreSQL, which is why the app keeps working in Setup step 5 before you switch clients. `ValkeyCluster` follows the redirect transparently, maintains a slot map, and routes future commands directly to the right node without an extra round-trip.

## Why does the client remap node addresses?

A cluster client learns where every node lives by asking the cluster, and each node reports its own idea of its address. In this workshop that is its Docker network address, `172.30.0.11` through `172.30.0.16`. Your machine reaches the nodes through the ports Docker publishes on `localhost` (7001 through 7006), not through those internal addresses, because Docker Desktop on macOS and Windows does not route traffic from your machine into its networks. (Docker Engine on Linux does, so the mapping is not required there, but it does no harm.) The `to_host_address` function translates each advertised address into its published port before the client connects. Production systems hit the same mismatch behind NAT, across port forwards, and outside Kubernetes clusters. The server-side alternative is the `cluster-announce-*` family of settings described in the [Valkey cluster tutorial](https://valkey.io/topics/cluster-tutorial/), which changes what the nodes advertise to every client, including `valkey-cli` inside the containers.

## What happens to multi-key operations in cluster mode?

Multi-key commands ([MGET](https://valkey.io/commands/mget/), [MSET](https://valkey.io/commands/mset/), [DEL](https://valkey.io/commands/del/) with multiple keys, and cross-key Lua scripts) only work on the server when all keys hash to the same slot. If the keys land on different slots, the server rejects the command with `CROSSSLOT Keys in request don't hash to the same slot`. valkey-py's `ValkeyCluster` checks `MGET` and `MSET` before sending and raises `ValkeyClusterException` (for example, `MSET - all keys must map to the same key slot`). It quietly splits a multi-key `DEL` by slot instead, so that call succeeds. Pipelines also work across slots, because the cluster client splits a pipeline by node. Hash tags (`{tag}` in the key name) force keys to the same slot by making the cluster hash only the portion between braces. Use them when you need to operate on related keys atomically.

## Why not use hash tags for everything?

If every key uses the same hash tag, all keys land on one slot, which means one node stores all your data. You lose the sharding benefit entirely. That node becomes a hot shard: it handles disproportionate traffic while the other primaries sit idle. Hash tags are for grouping related keys that need multi-key operations, not for bypassing the distribution model.

## Why 16,384 hash slots?

The number is a fixed constant in the Valkey Cluster protocol. Nodes communicate cluster state through a heartbeat (sometimes called a gossip message) that includes a bitmap of which slots each node owns. At 16,384 slots, that bitmap is 2 KB, small enough to include in every heartbeat without consuming meaningful bandwidth. A larger number (say, 65,536) would quadruple the bitmap to 8 KB in every message. A smaller number would limit how finely you can redistribute slots when adding or removing nodes. The [cluster specification](https://valkey.io/topics/cluster-spec/) suggests a maximum cluster size on the order of 1,000 nodes, so 16,384 slots still leaves every primary in a large cluster more than a dozen slots to move.

## Why is maxmemory set to 16 MB in the workshop?

To make eviction observable within seconds rather than requiring gigabytes of test data. In production, you would set `maxmemory` based on your instance's available RAM minus overhead for replication buffers, OS processes, and fragmentation.

## What does allkeys-lru actually do?

When the node reaches `maxmemory`, it samples a set of keys (`maxmemory-samples`, 5 by default according to the [Valkey key eviction documentation](https://valkey.io/topics/lru-cache/)) and evicts the one among them that was accessed least recently. Because it samples, this is an approximation of true LRU. "allkeys" means any key is eligible for eviction, whether or not it has a TTL set. This is the right choice for a pure cache workload where every key is expendable. Use `volatile-lru` if some keys must survive eviction (those without a TTL are protected).

## What happens to my application when eviction occurs?

Nothing dramatic. The evicted key disappears. The next request for that key gets a cache miss, queries the database, and repopulates the cache. The cache-aside pattern from the 200-level handles this transparently. You do not need special application logic for eviction.

## How does automatic failover work?

Each node pings every other node periodically. If a primary does not respond within `cluster-node-timeout` milliseconds, the other nodes mark it as `PFAIL` (possibly failed). Once a majority of primaries agree it is unreachable, it becomes `FAIL`. The replica with the most up-to-date data requests a vote from the remaining primaries and, if elected, promotes itself. Detection takes the full `cluster-node-timeout` (5 seconds in this workshop). The [cluster specification](https://valkey.io/topics/cluster-spec/) then has the replica wait 500 milliseconds plus a random 0 to 500 milliseconds (plus one second per rank, and with one replica per primary the rank is 0) before it asks for votes. In a test on this workshop's cluster, the replica was promoted about 7 seconds after `valkey-1` stopped, inside the 5 to 10 seconds the README suggests waiting.

## Why does /health return 200 when Valkey is down?

Because the app does not need Valkey to serve pages. A readiness check answers one question for an orchestrator: should this instance receive traffic? With PostgreSQL down, the answer is no, so `/health` returns 503. With Valkey down, every page still works from PostgreSQL, a little slower, so pulling the instance out of service would turn a slowdown into an outage. The check still reports the cache's state, as `"degraded: 1 of 3 primaries unreachable"` or similar, so monitoring can alert on it.

Detecting a degraded cluster takes asking every primary. A plain `ping()` on a `ValkeyCluster` goes to a single node, and as long as that node answers it reports success even while another primary is down. `primaries_status()` pings each primary separately with `target_nodes`, which is how `/health` can count the unreachable ones.

## Why does the health check use a local import?

The `/health` endpoint imports `get_connection` from `db` inside the function body rather than at module level, the same way every other route in `app.py` imports its database functions. It is a consistency choice rather than a requirement: `db.py` imports nothing from `app.py`, so a module-level import would work too. Importing `db` creates the connection pool. When the cache is connected, that happens at startup, because cache warming imports `db` before the first request. With caching disabled, or with the cluster unreachable at startup, warming does not run, and the first request that needs the database creates the pool instead. The import sits outside the endpoint's `try` blocks, so a broken `db.py` produces a 500 error from Flask, not a 503; the only 503 comes from the PostgreSQL probe.

## Is this workshop enough to run Valkey in production?

No. This workshop covers the operational fundamentals: clustering, eviction, failover, pooling, and health checks. Production deployments also involve network security (TLS, ACLs), persistence strategy (RDB snapshots, AOF logs), capacity planning, monitoring and alerting pipelines, backup and restore procedures, and upgrade rollout strategies. This workshop gives you the vocabulary and hands-on intuition to approach those topics with confidence.
