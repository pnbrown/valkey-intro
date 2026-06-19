# Multi-Key Strategies and Cache Stampedes

Placeholder for the 300-level workshop.

## Planned scope

- Multiple data types with different TTL strategies per type
- Structured logging for cache hit rates and query times
- Cache warming (pre-populating the cache on startup or deploy)
- Cache stampede (thundering herd) prevention with request coalescing
- Error handling at the route layer (graceful degradation when the database is slow or unreachable)
- Test suite demonstrating cache behavior verification

## Prerequisites

Completion of the [200-level workshop](../200-database-caching/).
