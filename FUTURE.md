# Workshop Series Roadmap

We built this repository as a progressive series of Valkey caching workshops. Each level builds on the previous one and assumes you completed the earlier workshops.

## Completed

### 100-Level: Introduction to Caching with Valkey

Cache-aside pattern, TTL expiration, manual invalidation. We use a simulated slow data source to make the performance difference visceral.

### 200-Level: Database-Backed Caching

Replace the simulated delay with a real PostgreSQL database. You'll cache real query results, wire up write-through invalidation tied to database writes, and implement pattern-based invalidation for clearing groups of related keys.

### 300-Level: Protecting the Caching Layer with Valkey

The same bookstore, now facing real traffic. We cover cache warming with Valkey pipelines to eliminate cold starts, mutex locking to prevent cache stampedes (thundering herd), a circuit breaker so a failing Valkey stops adding latency to every request, and measuring cache effectiveness with INFO stats.

### 400-Level: Production Operations with Valkey Cluster

Distributed caching with Valkey Cluster, read replicas, eviction policies under memory pressure, and observability (monitoring hit rates, tracking cache efficiency, alerting on degradation). We focus on the operational concerns that emerge at production scale.
