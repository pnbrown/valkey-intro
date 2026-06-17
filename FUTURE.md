# Future Workshop Series

This repository is the 100-level entry point in a planned series of Valkey caching workshops. Each level builds on the previous one's codebase and assumes the participant completed the earlier workshops.

## 200-Level: Database-Backed Caching

Replace the simulated delay with a real PostgreSQL database. Participants query a large dataset, observe realistic latency, and learn when caching a database result is worth the added complexity. Introduces cache invalidation tied to database writes (write-through and write-behind patterns).

## 300-Level: Multi-Key Strategies and Cache Stampedes

The application grows to serve different data types (user profiles, product listings, session data) with different TTL strategies per type. Covers cache warming, handling cache stampedes (thundering herd), and request coalescing to prevent multiple simultaneous fetches for the same key.

## 400-Level: Production Operations with Valkey Cluster

Distributed caching with Valkey Cluster, read replicas, eviction policies under memory pressure, and observability (monitoring hit rates, tracking cache efficiency, alerting on degradation). Focuses on the operational concerns that emerge at production scale.
