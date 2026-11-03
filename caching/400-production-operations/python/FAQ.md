# FAQ: Production Operations with Valkey Cluster

## Why use a connection pool instead of opening connections per request?

Each TCP connection to PostgreSQL involves a handshake, authentication, and session setup. Under concurrent load, creating hundreds of short-lived connections saturates the database's `max_connections` limit and adds measurable latency (typically 5-15ms per connection on localhost, more over a network). A pool amortizes that cost across the lifetime of the application. The connections stay open; your code borrows and returns them.

## Why ValkeyCluster instead of just Valkey with one node's port?

A single-node client does not understand cluster topology. If you send a command to a node that does not own the target key's hash slot, the server responds with a [MOVED](https://valkey.io/topics/cluster-spec/) error pointing to the correct node. A regular `Valkey()` client treats that as a connection error. `ValkeyCluster` follows the redirect transparently, maintains a slot map, and routes future commands directly to the right node without an extra round-trip.

## What happens to multi-key operations in cluster mode?

Multi-key commands ([MGET](https://valkey.io/commands/mget/), [MSET](https://valkey.io/commands/mset/), [DEL](https://valkey.io/commands/del/) with multiple keys, and cross-key Lua scripts) only work when all keys hash to the same slot. If the keys land on different slots, the cluster returns a `CrossSlotError`. Hash tags (`{tag}` in the key name) force keys to the same slot by making the cluster hash only the portion between braces. Use them when you need to operate on related keys atomically.

## Why not use hash tags for everything?

If every key uses the same hash tag, all keys land on one slot, which means one node stores all your data. You lose the sharding benefit entirely. That node becomes a hot shard: it handles disproportionate traffic while the other primaries sit idle. Hash tags are for grouping related keys that need multi-key operations, not for bypassing the distribution model.

## Why 16,384 hash slots?

The number is a fixed constant in the Valkey Cluster protocol. Nodes communicate cluster state through a heartbeat (sometimes called a gossip message) that includes a bitmap of which slots each node owns. At 16,384 slots, that bitmap is 2 KB, small enough to include in every heartbeat without consuming meaningful bandwidth. A larger number (say, 65,536) would quadruple the bitmap size in every message for minimal practical benefit. A smaller number would limit how finely you can redistribute slots when adding or removing nodes. 16,384 is the sweet spot.

## Why is maxmemory set to 16 MB in the workshop?

To make eviction observable within seconds rather than requiring gigabytes of test data. In production, you would set `maxmemory` based on your instance's available RAM minus overhead for replication buffers, OS processes, and fragmentation (typically 70-80% of total RAM).

## What does allkeys-lru actually do?

When the node reaches `maxmemory`, it samples a set of keys (default 5) and evicts the one that was accessed least recently. "allkeys" means any key is eligible for eviction, whether or not it has a TTL set. This is the right choice for a pure cache workload where every key is expendable. Use `volatile-lru` if some keys must survive eviction (those without a TTL are protected).

## What happens to my application when eviction occurs?

Nothing dramatic. The evicted key disappears. The next request for that key gets a cache miss, queries the database, and repopulates the cache. The cache-aside pattern from the 200-level handles this transparently. You do not need special application logic for eviction.

## How does automatic failover work?

Each node pings every other node periodically. If a primary does not respond within `cluster-node-timeout` milliseconds, the other nodes mark it as `PFAIL` (possibly failed). Once a majority of primaries agree it is unreachable, it becomes `FAIL`. The replica with the most up-to-date data requests a vote from the remaining primaries and, if elected, promotes itself. The entire process typically completes within 1-2 timeout intervals (10 seconds in this workshop).

## Why does the health check use a local import?

The `/health` endpoint imports `get_connection` from `db` inside the function body rather than at module level. This avoids circular import issues (the pool initializes at import time using environment variables that must be loaded first) and keeps the health check self-contained: if the import itself fails, the endpoint returns 503 rather than crashing the whole application.

## Is this workshop enough to run Valkey in production?

No. This workshop covers the operational fundamentals: clustering, eviction, failover, pooling, and health checks. Production deployments also involve network security (TLS, ACLs), persistence strategy (RDB snapshots, AOF logs), capacity planning, monitoring and alerting pipelines, backup and restore procedures, and upgrade rollout strategies. This workshop gives you the vocabulary and hands-on intuition to approach those topics with confidence.
