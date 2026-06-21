# 100: Introduction to Caching with Valkey

Store the result of an expensive operation so you don't have to repeat it. That's caching. This workshop teaches you the foundational pattern (cache-aside), how expiration works (TTL), and how to manually remove stale entries (invalidation).

## What you'll learn

- The cache-aside pattern: check cache, miss means fetch from source, store the result
- Time-to-live (TTL): automatic expiration of cached entries
- Manual invalidation: removing entries before TTL expires
- Graceful degradation: what happens when the cache goes down

## Prerequisites

- Docker (for running Valkey)
- A text editor
- A terminal
- Git (for cloning the repo)

## Architecture

The cache layer sits between your application's route handlers and a slow data source. On a cache hit, the data source is never touched. On a miss, the source is queried and the result is stored in the cache for next time.

```
REQUEST → check cache
            ├─ HIT  → return cached data
            └─ MISS → fetch from source → store in cache → return data
```

The data source in this workshop is simulated (a deliberate 2.5-second delay). The 200-level workshop replaces this with a real PostgreSQL database.

## Choose your language

| Language | Status | Directory |
|----------|--------|-----------|
| Python   | Complete | [python/](python/) |

Pick a language and follow the README inside that directory.

## Infrastructure

The `docker-compose.yml` in this directory runs Valkey. It's shared across all language implementations. Start it before beginning any language-specific workshop:

```bash
docker compose up -d
```
