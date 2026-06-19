# Production Operations with Valkey Cluster

Placeholder for the 400-level workshop.

## Planned scope

- Connection pooling (psycopg_pool and Valkey connection pools)
- Valkey Cluster mode (multiple nodes, hash slots, failover)
- Eviction policies under memory pressure (maxmemory configuration)
- Custom JSON serialization (handling timestamps, decimals, edge cases)
- Health checks and readiness probes
- Observability: monitoring hit rates, latency percentiles, alerting on degradation
- Read replicas for scaling reads

## Prerequisites

Completion of the [300-level workshop](../300-multi-key-strategies/).
