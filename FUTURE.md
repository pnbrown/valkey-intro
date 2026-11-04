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

The capstone of the caching track. We harden the application with connection pooling, a cluster-aware Valkey client, health checks, and serialization for types that `json.dumps` rejects. Then we run the bookstore on a six-node Valkey Cluster and work through hash slots, spotting a hot shard with per-node stats, eviction policies under memory pressure, and automatic failover when a primary goes down.

## Session storage track (planned)

Sessions turn the caching track's lessons around. A cached value can always be rebuilt from the database, but a session usually cannot. If one disappears, a reader gets signed out or loses work in progress. The session track uses the same bookstore to show how that difference changes the way you store, expire, and protect data in Valkey.

### 100-Level: The session lifecycle

Sign a reader in, keep them signed in while they browse, and sign them out. Covers storing a session in Valkey, idle timeouts that reset with each request, and what it means when a session is missing.

### 200-Level: Where state belongs

Recently viewed books, a draft review that survives a page refresh, and a session that ends after a set time even while the reader is active. Each part asks how long a piece of state should last and where it should live.

### 300-Level: Many sessions per reader

A reader signed in on several devices. Sign out everywhere at once, limit how many sessions a reader can have, and handle two sign-ins that arrive at the same moment.

### 400-Level: Sessions at scale

Eviction, persistence, replication, and clustering, revisited for data you cannot rebuild. Why the eviction policy that worked for caching would sign readers out, and what survives when a node fails.
