# Frequently Asked Questions

This document covers design decisions, concepts, and deeper questions about the 200-level workshop. For setup issues and error messages, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Terms used in this document

**ORM (Object-Relational Mapper):** A library that lets you interact with a database using Python objects and methods instead of writing SQL directly. SQLAlchemy is the most common Python ORM. You define a `Book` class, and the ORM generates the SQL for you. We use raw SQL in this workshop instead because the caching pattern is easier to see when you can read the actual query.

**Context manager:** A Python pattern using the `with` keyword that automatically handles setup and cleanup. `with get_connection() as conn:` opens a connection when the block starts and closes it when the block ends, even if an error occurs. It replaces the `try/finally` pattern with less boilerplate.

**Connection pool:** A set of pre-opened database connections that get reused across requests instead of opening a new one each time. Opening a connection involves a TCP handshake (a multi-step network negotiation between your application and the database server), which takes a few milliseconds. A pool pays that cost once and reuses the result.

**SQL injection:** An attack where a malicious user provides input that gets executed as SQL. If you build queries with string formatting (`f"WHERE id = {user_input}"`), an attacker can provide `1; DROP TABLE books` as input and destroy your data. Parameterized queries (`%s` placeholders) prevent this because the SQL structure is separated from the data values.

---

## Design Decisions

### Why open a new database connection on every function call?

Every function in `db.py` calls `get_connection()`, does its work, and the `with` block closes the connection. We made this intentionally simple. In production, you'd use a connection pool (`psycopg_pool.ConnectionPool`) so you're reusing existing connections instead of paying the TCP handshake cost on every query.

Connection pooling adds concepts (pool size, connection lifecycle, exhaustion handling) that would distract from the caching lesson. We traded database efficiency for code clarity here. In a real application, the pool sits behind `get_connection()` and the rest of the code looks identical.

For connection pooling details, see the [psycopg pool documentation](https://www.psycopg.org/psycopg3/docs/api/pool.html).

### Why psycopg3 instead of psycopg2 or SQLAlchemy?

psycopg3 (the `psycopg` package) is the actively maintained PostgreSQL adapter for Python. It has a cleaner API than its predecessor. Connections work as context managers, cursors support `row_factory=dict_row` natively, and it's what the psycopg team recommends for all new projects.

psycopg2 is still widely deployed, but it's in maintenance mode. SQLAlchemy adds an ORM and query builder. Both are valid choices, but both add concepts orthogonal to caching. We went with psycopg3 because it keeps the SQL visible and the code minimal.

### Why use `dict_row`?

`row_factory=dict_row` on the cursor returns rows as dictionaries instead of tuples. For us, that means the cache layer can serialize them directly to JSON without any transformation. It also makes template rendering straightforward. You write `{{ book.title }}` instead of `{{ book[1] }}`.

A small performance cost comes with dict construction vs. tuple. For this dataset, it's negligible.

### Why TRUNCATE in the seed script instead of INSERT ON CONFLICT?

Our seed script uses `TRUNCATE books, authors RESTART IDENTITY CASCADE` before inserting. Re-runs are always clean. You get the same dataset with the same IDs every time. `INSERT ON CONFLICT DO NOTHING` would skip duplicates but leave stale data from previous runs if rows were removed from the SQL file.

`RESTART IDENTITY` resets the serial counters so author IDs and book IDs stay predictable. Because we use hardcoded `author_id` values in the book inserts, predictable IDs are a requirement.

### Why store `published_year` as INTEGER instead of DATE?

Many entries in our dataset predate the Common Era (Diogenes, Epictetus). PostgreSQL's DATE type doesn't handle negative years cleanly. INTEGER stores the year as a simple number, which works for 350 BCE (`-350`) and 2022 CE (`2022`) without any parsing issues.

### Why is the cache TTL sixty seconds instead of thirty?

At the 100-level we use thirty seconds because you need to observe expiration quickly during the workshop. Here at the 200-level, the focus shifts to write-through invalidation, where you're clearing cache entries manually on writes rather than waiting for TTL. A longer TTL makes cache hits more visible between writes without requiring you to rush through the testing steps.

Sixty seconds is still short enough to observe natural expiration if you wait.

### Why separate the cache layer into its own module?

`CacheLayer` encapsulates all Valkey interaction. Route handlers don't know (or care) whether caching uses Valkey, Memcached, an in-process dict, or anything else. Swapping the cache implementation requires changing one file.

It also makes graceful degradation clean. Exceptions are caught inside the cache layer, and safe defaults are returned. A route handler never sees a Valkey error.

---

## Concepts

### What is write-through invalidation?

Write-through invalidation means that when you write to the database, you also invalidate (delete) the affected cache entries in the same operation. We call it "write-through" because the invalidation happens as part of the write path, not as a background job or a TTL-based cleanup.

Without it, you'd rely on TTL alone, which means stale data is served until the key expires. Write-through gives you consistency at the cost of explicitly tracking which cache keys are affected by each write.

### What is pattern-based invalidation and when would I use it?

Pattern-based invalidation uses Valkey's SCAN command to find all keys matching a glob pattern (like `genre:*`) and deletes them. It's useful when a single write affects an unknown or large number of cache entries.

In this workshop, the relationships are simple (one book belongs to one genre), so we use targeted invalidation by specific key name because it's clearer. Pattern-based becomes valuable when relationships are many-to-many, when a write could affect entries you can't enumerate cheaply, or when you're doing bulk operations.

For the mechanics, see the [Valkey SCAN command documentation](https://valkey.io/commands/scan/).

### How is this different from the 100-level's invalidation?

In the 100-level, invalidation was manual (you hit an endpoint that deleted a key). No data was actually mutated. You had one key per topic, and the only relationship was "this key holds this data."

Here at the 200-level, invalidation is triggered by a real data change (editing a book description), and you need to invalidate multiple keys because the data appears in multiple cached views. A book's description lives in both `book:{id}` and `genre:{genre}`. Missing one means stale data in one view but not the other, which is worse than stale data everywhere because it's inconsistent.

### What happens if the cache invalidation fails after the database write succeeds?

Your database has the correct data. The cache still holds the old version. On the next read, stale data is served from the cache until TTL expires. We accept that tradeoff. It's eventual consistency: cache and database can briefly disagree.

In practice, Valkey DEL calls on a local server fail only if Valkey is completely unreachable. If that's the case, the cache layer's error handling returns gracefully and subsequent reads fall through to the database directly (because `is_connected` will return False).

For applications where this window of staleness is unacceptable, you'd need distributed transactions or a different architecture. That's beyond what we cover here.

### Why does the edit route fetch the book detail without using the cache?

In `edit_book`, the call to `get_book_detail(book_id)` goes directly to the database (no cache check). We do this intentionally. You're about to write, so you want the freshest possible data to display in the form. Using the cache here could show a stale version of the description in the edit form, which would be confusing.

---

## Database and SQL

### Can I run the seed script multiple times?

Yes. All data is truncated before inserting, so you always end up with the same clean dataset regardless of how many times you run it. Serial IDs are also reset, so book and author IDs stay predictable across runs.

### Why are there negative `published_year` values?

Diogenes and Epictetus wrote (or had their words recorded) before the Common Era. `-350` represents 350 BCE. PostgreSQL handles negative integers without issue. If you're querying and want only modern books, filter with `WHERE published_year > 0`.

### Why does the SQL use `%s` placeholders instead of f-strings?

`%s` placeholders are psycopg's parameterized query syntax. Escaping and type conversion are handled by the database driver, which prevents SQL injection. An f-string like `f"WHERE genre = '{genre}'"` would allow a malicious input like `'; DROP TABLE books; --` to execute arbitrary SQL.

Parameterized queries are not optional in production code. We use them from the start so the habit is never wrong.

---

## Going Deeper

### What happens if Valkey runs out of memory?

In this workshop the dataset is tiny, so memory is never a concern. In production, Valkey stores everything in RAM, and RAM is finite. If you cache without limits, Valkey eventually runs out of memory and starts refusing writes.

You solve this by configuring `maxmemory` and an eviction policy. An eviction policy tells Valkey what to do when it's full. It can evict the least recently used keys (`allkeys-lru`), evict only keys with TTLs (`volatile-lru`), reject new writes (`noeviction`), or use several other strategies. For a pure cache where every key has a TTL, I'd recommend `volatile-lru` as a reasonable default.

For all available policies, see the [Valkey eviction documentation](https://valkey.io/topics/lru-cache/). We explore eviction under memory pressure in more depth at the 300-level.

### How would connection pooling change the code?

Replace `get_connection()` with a pool that's initialized once at startup:

```python
from psycopg_pool import ConnectionPool

pool = ConnectionPool(conninfo=os.environ["DATABASE_URL"], min_size=1, max_size=10)

def get_connection():
    return pool.getconn()
```

Then change the `with get_connection() as conn:` pattern to `with pool.connection() as conn:` which handles checkout and return automatically. Everything else (queries, cache logic, error handling) stays the same.

### Would an ORM change how caching works?

Not really. The caching pattern is identical regardless of whether you write raw SQL or use an ORM. Your cache sits between the route handler and whatever produces the data. With SQLAlchemy, you'd cache the serialized result of a query rather than the raw cursor output, but the cache-aside logic (check cache, miss means query, store result) doesn't change.

ORMs can make cache key design harder because queries are built dynamically. With raw SQL, you can see exactly what parameters define the cache key. I find that clarity valuable.

### What about caching at the query layer instead of the route layer?

You could put caching inside `get_books_by_genre` itself rather than in the route handler. Every caller would get caching for free.

Here's the tradeoff. The function now has two responsibilities (fetching data and managing cache). Invalidation also becomes harder to reason about because the cache logic is hidden inside the data layer rather than visible at the point where writes happen. For this workshop, we keep cache logic in the route handlers because it makes the pattern explicit and the invalidation obvious.

---

## Further Reading

- [Valkey documentation](https://valkey.io/docs/)
- [Valkey SCAN command](https://valkey.io/commands/scan/)
- [psycopg documentation](https://www.psycopg.org/psycopg3/docs/)
- [psycopg connection pooling](https://www.psycopg.org/psycopg3/docs/api/pool.html)
- [PostgreSQL documentation](https://www.postgresql.org/docs/16/)
- [Flask documentation](https://flask.palletsprojects.com/)
