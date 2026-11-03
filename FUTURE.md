# Workshop Series Roadmap

This repository is organized into tracks. Each track lives in its own top-level directory and runs from a 100-level introduction to a 400-level production workshop. Within a track, each level builds on the previous one and assumes you completed the earlier workshops.

## Caching track (complete)

All four levels live in [`caching/`](caching/).

### 100-Level: Introduction to Caching with Valkey

Cache-aside pattern, TTL expiration, manual invalidation. We use a simulated slow data source to make the performance difference visceral.

### 200-Level: Database-Backed Caching

Replace the simulated delay with a real PostgreSQL database. You'll cache real query results, wire up write-through invalidation tied to database writes, and implement pattern-based invalidation for clearing groups of related keys.

### 300-Level: Protecting the Caching Layer with Valkey

The same bookstore, now facing real traffic. We cover cache warming with Valkey pipelines to eliminate cold starts, mutex locking to prevent cache stampedes (thundering herd), a circuit breaker so a failing Valkey stops adding latency to every request, and measuring cache effectiveness with INFO stats.

### 400-Level: Production Operations with Valkey Cluster

The capstone of the caching track. We harden the application with connection pooling, a cluster-aware Valkey client, health checks, and serialization for types that `json.dumps` rejects. Then we run the bookstore on a six-node Valkey Cluster and work through hash slots, eviction policies under memory pressure, and automatic failover when a primary goes down.
