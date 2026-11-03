# Caching Track

Four hands-on workshops that teach you to speed up an application with [Valkey](https://valkey.io/). You start by putting a cache in front of a slow data source and finish by running the same application on a six-node Valkey Cluster. Each level builds on the one before it.

## Levels

| Level | Workshop | What you'll learn |
|-------|----------|-------------------|
| 100 | [Introduction to Caching with Valkey](100-caching-intro/) | The cache-aside pattern, TTL expiration, manual invalidation, and what happens when the cache goes down |
| 200 | [Database-Backed Caching with Valkey](200-database-caching/) | Caching real PostgreSQL queries, write-through invalidation, pattern-based invalidation, and cache key design |
| 300 | [Protecting the Cache Layer with Valkey](300-protecting-cache/) | Cache warming with pipelines, preventing cache stampedes, a circuit breaker for Valkey failures, and measuring hit rate |
| 400 | [Production Operations with Valkey Cluster](400-production-operations/) | Connection pooling, a cluster-aware client, health checks, eviction under memory pressure, and automatic failover |

## Where to start

Start with the [100-level workshop](100-caching-intro/). It assumes no prior experience with Valkey or caching. Each later level assumes you completed the one before it.

The 100-level workshop uses a simulated slow data source so you can focus on the caching pattern itself. From the 200 level on, every workshop uses the same bookstore application backed by PostgreSQL, so you keep building on code you already know.

## What you need

All four levels need Python 3.9 or later, Docker, a text editor, and a terminal. The infrastructure grows with each level:

| Level | Containers |
|-------|------------|
| 100 | Valkey |
| 200 and 300 | Valkey and PostgreSQL |
| 400 | A six-node Valkey Cluster and PostgreSQL. Allocate at least 4 GB of memory to Docker Desktop. |

Each level's `docker-compose.yml` starts everything that level needs.

## How each level is organized

Each level has a short overview in its own `README.md`, and the full walkthrough lives in its language directory (for example, `100-caching-intro/python/README.md`). The language directory also holds an `FAQ.md`, a `TROUBLESHOOTING.md`, the starter files, and a `safety/` directory with completed reference files if you get stuck.

[Back to all tracks](../README.md)
