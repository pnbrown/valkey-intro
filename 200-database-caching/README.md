# 200: Database-Backed Caching with Valkey

In the 100-level, you cached results from a simulated slow source. This time the latency is real. You're querying PostgreSQL and learning what happens when your application both reads and writes data. The moment you write, every cached copy becomes a lie until you do something about it.

## What you'll learn

- Cache-aside applied to real database queries
- Write-through invalidation: clearing cache entries when the underlying data changes
- Pattern-based invalidation: clearing groups of related keys at once
- Cache key design: how key structure mirrors data relationships

## Prerequisites

- Completion of the [100-level workshop](../100-caching-intro/)
- Docker (for running Valkey and PostgreSQL)
- A text editor
- A terminal

## Architecture

Same cache-aside pattern as the 100-level, with an added write path:

```
READ PATH:                          WRITE PATH:
request → cache check               form POST → database UPDATE
  ├─ HIT → return                     ├─ invalidate book:{id}
  └─ MISS → database → cache → return├─ invalidate genre:*
                                      ├─ invalidate genres
                                      └─ redirect → (triggers read path)
```

The key insight: cache invalidation must mirror your data relationships. When a book changes, both the book cache and the genre listing cache are affected.

## Choose your language

| Language | Status | Directory |
|----------|--------|-----------|
| Python   | Complete | [python/](python/) |

Pick a language and follow the README inside that directory.

## Infrastructure

The `docker-compose.yml` in this directory runs both Valkey and PostgreSQL. Start them before beginning any language-specific workshop:

```bash
docker compose up -d
```
