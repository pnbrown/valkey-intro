# Workshop Series Roadmap

We built this repository as a progressive series of Valkey caching workshops. Each level builds on the previous one and assumes you completed the earlier workshops.

## Completed

### 100-Level: Introduction to Caching with Valkey

Cache-aside pattern, TTL expiration, manual invalidation. We use a simulated slow data source to make the performance difference visceral.

### 200-Level: Database-Backed Caching

Replace the simulated delay with a real PostgreSQL database. You'll cache real query results, wire up write-through invalidation tied to database writes, and implement pattern-based invalidation for clearing groups of related keys.

### 300-Level: Multi-Key Strategies and Cache Stampedes

Here the application grows to serve different data types (user profiles, product listings, session data) with different TTL strategies per type. We cover cache warming, handling cache stampedes (thundering herd), and request coalescing to prevent multiple simultaneous fetches for the same key.

### 400-Level: Production Operations with Valkey Cluster

Distributed caching with Valkey Cluster, read replicas, eviction policies under memory pressure, and observability (monitoring hit rates, tracking cache efficiency, alerting on degradation). We focus on the operational concerns that emerge at production scale.
