# Database-Backed Caching with Valkey

In the 100-level workshop, you cached results from a fake slow source. You configured a `time.sleep()` pretending to be latency. It worked for learning the pattern, but nobody ships code that sleeps for two and a half seconds on purpose unless you're looking for an easy way to reduce latency to make stakeholders happy.

This time the latency is real. You're querying PostgreSQL, observing actual network round-trips, and learning when caching database results is worth the added complexity. We're using the same cache-aside pattern. What changes is the invalidation story. Most applications don't just read data, they write it too. The moment you write, every cached copy of that data becomes a lie until you do something about it.

By the end of this workshop you'll have:

1. Cached database query results using cache-aside (same pattern, real data source)
2. Implemented write-through invalidation, clearing cache entries the moment underlying data changes
3. Used pattern-based invalidation to clear groups of related cache entries at once

This is where caching gets interesting, honestly. The 100-level teaches you the mechanics. This one teaches you why invalidation has a reputation.

We're assuming you completed the [100-level workshop](../../100-caching-intro/). If cache-aside, TTL, and manual invalidation aren't comfortable to you yet, go back and finish that one first.

You'll need Python 3.9 or later, Docker, a text editor, and a terminal. All commands should be run from this directory unless noted otherwise.

## The application

A bookstore catalog. Authors, books, genres. Our database has thirty-four authors and sixty-seven books across nine genres. Small enough to reason about by hand, large enough that database queries take measurable time (typically two to ten milliseconds on a local PostgreSQL container, depending on your machine).

Architecturally, it's the same as the 100-level. A cache layer sits between route handlers and the data source. What's different is that "data source" is now PostgreSQL instead of a Python dictionary.

## Part 1: Setting up the environment

### Starting the infrastructure

We need two containers this time. Valkey (same as before) and PostgreSQL. The `docker-compose.yml` in this directory defines both:

```yaml
services:
  valkey:
    image: valkey/valkey:8.0
    ports:
      - "6379:6379"

  postgres:
    image: postgres:16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: workshop
      POSTGRES_PASSWORD: workshop
      POSTGRES_DB: bookstore
```

From the `200-database-caching/` directory, start them:

```bash
docker compose up -d
```

Verify both are running:

```bash
docker compose ps
```

You should see `valkey` and `postgres` listed with a status of "Up" or "healthy."

### Setting up Python

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Copy the config file:

```bash
cp .env.example .env
```

### Seeding the database

Our database starts empty. Populate it:

```bash
python seed_db.py
```

You should see "Database seeded successfully." Connection error? Make sure the PostgreSQL container is running and healthy.

Verify the data loaded:

```bash
docker compose -f ../docker-compose.yml exec postgres psql -U workshop -d bookstore -c "SELECT COUNT(*) FROM books;"
```

Should return sixty-seven. ⁶🤷⁷

## Part 2: Building the database-backed application (no cache)

We're wiring up Flask routes to query PostgreSQL directly. Every page load hits the database. You'll observe query time in the UI, establishing the baseline we'll improve in Part 3.

You don't need to write SQL from scratch in this workshop (the queries are provided), but you do need to read them to understand what's being cached. If SQL is unfamiliar, [SQLBolt](https://sqlbolt.com/) is a free interactive tutorial that teaches through short exercises in the browser. Lessons 1 through 6 (SELECT, filtering, JOINs) cover everything used here. [Boot.dev's SQL course](https://www.boot.dev/courses/learn-sql) takes a similar hands-on approach with real queries in the browser as part of a broader backend learning path. For a deeper reference that uses PostgreSQL specifically, [Practical SQL](https://nostarch.com/practical-sql-2nd-edition) by Anthony DeBarros (No Starch Press) is hands-on and builds from zero.

### The database module

Open `db.py`. Function stubs with TODO placeholders. Fill them in:

**`get_books_by_genre`:**

```python
def get_books_by_genre(genre):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("""
                SELECT b.id, b.title, a.name AS author_name,
                       b.published_year, b.description
                FROM books b
                JOIN authors a ON b.author_id = a.id
                WHERE b.genre = %s
                ORDER BY b.published_year DESC
            """, (genre,))
            return [dict(row) for row in cur.fetchall()]
```

**`get_book_detail`:**

```python
def get_book_detail(book_id):
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("""
                SELECT b.id, b.title, a.name AS author_name, a.bio AS author_bio,
                       b.genre, b.published_year, b.description
                FROM books b
                JOIN authors a ON b.author_id = a.id
                WHERE b.id = %s
            """, (book_id,))
            row = cur.fetchone()
            return dict(row) if row else None
```

**`get_all_genres`:**

```python
def get_all_genres():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT genre FROM books ORDER BY genre")
            return [row[0] for row in cur.fetchall()]
```

**`update_book_description`:**

```python
def update_book_description(book_id, new_description):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE books SET description = %s WHERE id = %s",
                (new_description, book_id)
            )
            rowcount = cur.rowcount
        conn.commit()
        return rowcount > 0
```

Notice the `with get_connection() as conn:` pattern. It handles closing the connection automatically when the block exits. No more `try/finally` boilerplate. And `row_factory=dict_row` on the cursor returns rows as dictionaries directly.

Every query uses `%s` placeholders instead of string formatting. These are parameterized queries. SQL structure and data values are sent to PostgreSQL separately, so user input can never be interpreted as SQL commands. This prevents SQL injection, where a malicious input like `'; DROP TABLE books; --` could destroy your data if it were interpolated directly into the query string.

### Wiring up the routes

Open `app.py`. Replace the TODO placeholders:

**Home route:**

```python
@app.route("/")
def home():
    from db import get_all_genres
    genres = get_all_genres()
    return render_template("index.html", genres=genres)
```

Every page load fetches the genre list from the database. You'll cache it in Part 3.

**Genre listing:**

```python
@app.route("/genre/<genre>")
def genre_listing(genre):
    from db import get_books_by_genre

    start = time.perf_counter()
    books = get_books_by_genre(genre)
    end = time.perf_counter()

    elapsed_ms = round((end - start) * 1000)

    return render_template("genre.html",
        genre=genre,
        books=books,
        elapsed_ms=elapsed_ms,
        cache_status="DISABLED",
    )
```

**Book detail:**

```python
@app.route("/book/<int:book_id>")
def book_detail(book_id):
    from db import get_book_detail

    start = time.perf_counter()
    book = get_book_detail(book_id)
    end = time.perf_counter()

    elapsed_ms = round((end - start) * 1000)

    if book is None:
        flash("Book not found.")
        return redirect(url_for("home"))

    return render_template("book.html",
        book=book,
        elapsed_ms=elapsed_ms,
        cache_status="DISABLED",
    )
```

### Running it

```bash
python app.py
```

Open [http://localhost:5000](http://localhost:5000). A genre list appears. Click one. Books show up with a "Query time" display. Click a book for its detail page.

Query times are small (low double-digit milliseconds for this dataset), but they're real network round-trips to PostgreSQL. On a local container, low double-digit milliseconds doesn't feel like a problem worth solving. Put that database on the other side of a network boundary and those double digits become triple digits real quick. Caching becomes valuable when query latency is high, when the same query runs repeatedly, or when you need to reduce database load.

Refresh a genre page a few times. Query time stays roughly the same on every load. Nothing is remembered between requests.

The app runs in debug mode, which means two things: Flask automatically reloads when you save changes to a `.py` file (no manual restart needed), and if something goes wrong, the browser itself shows the full error traceback instead of a generic "Internal Server Error" page. If you see a traceback in the browser, read it from the bottom up. The last line is the actual exception, and the frames above it show the call stack that led there.

If you hit an error you're not able to troubleshoot, remember the completed files are in the `safety/` directory.

## Part 3: Adding the cache layer

Same cache-aside pattern from the 100-level, applied to real database queries. What's different now is that we have multiple query types to cache (genre listings, book details) and we need to think about which key maps to which data.

Here's the read path we're building:

```
REQUEST → check cache
            ├─ HIT  → return cached data
            └─ MISS → query database → store in cache → return data
```

Same shape as the 100-level. The complexity comes in Part 4 when we add the write path.

### Cache key design

Before writing code, think about the key structure:

- `genre:{genre_name}` caches the full book listing for a genre
- `book:{book_id}` caches a single book's detail page data
- `genres` caches the list of available genres

Each key type maps to one query. When data changes, you need to know which keys to invalidate. Say a book's description changes. You invalidate `book:{id}` (the specific book) and `genre:{genre}` (the listing that includes it). 

This is the part nobody warns you about in caching tutorials. Writing to the cache is easy. Knowing what to blow away when something changes is the actual work.

### Filling in `invalidate_pattern`

Open `cache_layer.py`. Our `get`, `set`, and `invalidate` methods are already complete (identical to the 100-level). Fill in the new `invalidate_pattern` method:

```python
    def invalidate_pattern(self, pattern):
        try:
            count = 0
            for key in self._client.scan_iter(match=pattern):
                self._client.delete(key)
                count += 1
            return count
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on invalidate_pattern('%s'): %s", pattern, exc)
            return 0
```

We're using Valkey's [SCAN command](https://valkey.io/commands/scan/) to iterate over keys matching a glob pattern (a wildcard syntax where `*` means "any characters," so `genre:*` matches `genre:fantasy`, `genre:computing`, and every other genre key) without blocking the server. Each match is deleted individually. In production with large key spaces, you'd batch deletes with a pipeline. For our dataset, individual deletes are fine.

### Adding cache-aside to the routes

Open `app.py`. Replace the routes you wrote in Part 2 with cached versions:

**Home route (cached):**

```python
@app.route("/")
def home():
    from db import get_all_genres

    if CACHE_ENABLED and cache is not None:
        cached_data, is_hit = cache.get("genres")
        if is_hit:
            genres = cached_data
        else:
            genres = get_all_genres()
            cache.set("genres", genres)
    else:
        genres = get_all_genres()

    return render_template("index.html", genres=genres)
```

Our genres list changes rarely (only when a book with a new genre is added), so caching it is straightforward. A single key, `"genres"`, with no variable component.

**Genre listing (cached):**

```python
@app.route("/genre/<genre>")
def genre_listing(genre):
    from db import get_books_by_genre

    cache_status = "DISABLED"
    cache_key = f"genre:{genre}"

    start = time.perf_counter()

    if CACHE_ENABLED and cache is not None:
        cached_data, is_hit = cache.get(cache_key)
        if is_hit:
            books = cached_data
            cache_status = "HIT"
        else:
            books = get_books_by_genre(genre)
            cache.set(cache_key, books)
            cache_status = "MISS"
    else:
        books = get_books_by_genre(genre)

    end = time.perf_counter()
    elapsed_ms = round((end - start) * 1000)

    return render_template("genre.html",
        genre=genre,
        books=books,
        elapsed_ms=elapsed_ms,
        cache_status=cache_status,
    )
```

**Book detail (cached):**

```python
@app.route("/book/<int:book_id>")
def book_detail(book_id):
    from db import get_book_detail

    cache_status = "DISABLED"
    cache_key = f"book:{book_id}"

    start = time.perf_counter()

    if CACHE_ENABLED and cache is not None:
        cached_data, is_hit = cache.get(cache_key)
        if is_hit:
            book = cached_data
            cache_status = "HIT"
        else:
            book = get_book_detail(book_id)
            if book is not None:
                cache.set(cache_key, book)
            cache_status = "MISS"
    else:
        book = get_book_detail(book_id)

    end = time.perf_counter()
    elapsed_ms = round((end - start) * 1000)

    if book is None:
        flash("Book not found.")
        return redirect(url_for("home"))

    return render_template("book.html",
        book=book,
        elapsed_ms=elapsed_ms,
        cache_status=cache_status,
    )
```

### Enabling caching

Open `.env` and set:

```
CACHE_ENABLED=true
```

Restart Flask (Ctrl+C, then `python app.py`).

### Observing the difference

Genre page, first load. Cache MISS, double-digit milliseconds. Second load. Cache HIT, near zero. No database query on the second request.

Same pattern on the book detail page. First load hits PostgreSQL. Second is returned from Valkey.

On a local instance the performance improvement is modest (milliseconds). In production, where the database lives on a separate machine and queries are more complex, the difference is dramatic. But the pattern is identical regardless of scale.

### Looking inside the cache

Open a second terminal window. Keep Flask running in the first one.

You can see exactly what Valkey is holding with `valkey-cli`. These commands use the `-f` flag because you're running them from the `python/` directory:

```bash
docker compose -f ../docker-compose.yml exec valkey valkey-cli KEYS "*"
```

You should see keys like `genre:fantasy`, `book:13`, and `genres`. Check the contents of one:

```bash
docker compose -f ../docker-compose.yml exec valkey valkey-cli GET "book:13"
```

That's the JSON your cache layer serialized. Check how long a key has before it expires:

```bash
docker compose -f ../docker-compose.yml exec valkey valkey-cli TTL "genre:fantasy"
```

Returns the number of seconds remaining. If the keys have already expired by the time you run these commands, reload a page in the browser first to repopulate the cache. If you find yourself consistently missing them, increase `CACHE_TTL_SECONDS` in your `.env` file (the default is 300 seconds, but you can raise it further while learning).

Watching keys appear after requests, seeing them disappear after invalidation (in Part 4), and checking TTL countdown gives you a direct feedback loop on what the code is doing.

### Optional: Try breaking it

Before moving on to Part 4, try this. With caching enabled, load a book's detail page (so it's cached). Then change the description directly in the database, bypassing the application:

```bash
docker compose -f ../docker-compose.yml exec postgres psql -U workshop -d bookstore -c "UPDATE books SET description = 'I changed this behind the cache''s back' WHERE id = 13;"
```

Now refresh the book detail page in your browser. The old description still shows. Cache: HIT. The cache is serving data that no longer matches the database. This is the problem. The cache doesn't know the database changed because nobody told it. Part 4 solves this.

Reset the data when you're done:

```bash
python seed_db.py
```

Again, if anything went wrong that you cannot troubleshoot, the completed files are in the `safety/` directory.

## Part 4: Write-through invalidation

Our cache works, but there's a problem. Update a book's description in the database and the cache still serves the old version until TTL expires. For our five-minute TTL, that's up to five minutes of stale data after every change.

Here's what the write path needs to look like:

```
FORM POST → update database
              ├─ invalidate book:{id}
              ├─ invalidate genre:*
              ├─ invalidate genres
              └─ redirect → (triggers read path, which refills cache with fresh data)
```

Write-through invalidation fixes this. Every time we write to the database, we also invalidate the affected cache entries. Invalidation happens as part of the write path, not as a separate background process. Write goes through, cache gets cleared, next read fetches fresh data.

### Implementing the edit route

Open `app.py`. Replace the placeholder `/book/<int:book_id>/edit` route:

```python
@app.route("/book/<int:book_id>/edit", methods=["GET", "POST"])
def edit_book(book_id):
    from db import get_book_detail, update_book_description

    book = get_book_detail(book_id)
    if book is None:
        flash("Book not found.")
        return redirect(url_for("home"))

    if request.method == "GET":
        return render_template("edit.html", book=book)

    # POST: update the database
    new_description = request.form.get("description", "").strip()
    if not new_description:
        flash("Description cannot be empty.")
        return render_template("edit.html", book=book)

    update_book_description(book_id, new_description)

    # Invalidate affected cache entries
    if CACHE_ENABLED and cache is not None:
        cache.invalidate(f"book:{book_id}")
        cache.invalidate_pattern(f"genre:*")
        cache.invalidate("genres")

    flash(f"Description updated for '{book['title']}'.")
    return redirect(url_for("book_detail", book_id=book_id), code=303)
```

The `code=303` on the redirect tells the client to follow with a GET request regardless of what method was used to submit. Without it, some HTTP clients (like curl with `-L`) would follow the redirect with another POST, which the book detail route doesn't accept.

What matters here is the invalidation after the database update. Three cache operations happen when a book description changes:

1. `cache.invalidate(f"book:{book_id}")` clears the specific book's detail cache.
2. `cache.invalidate_pattern("genre:*")` clears all genre listing caches. We use the pattern because a book edit could affect multiple views (the genre listing shows descriptions), and clearing all genre caches is simpler than tracking which specific one contains this book.
3. `cache.invalidate("genres")` clears the genre list itself (in case you later add logic that changes genre assignments on edit).

That's `invalidate_pattern` in action. For a single book edit we could get away with `cache.invalidate(f"genre:{book['genre']}")` (targeted), but the pattern demonstrates the technique and is safer if your data relationships grow more complex.

I like to think of write-through invalidation simply as this. Database write and cache clear happen together in the same request. No magic, and folks sometimes overcomplicate it. A few extra lines after the database write. The hard part isn't the code. It's remembering to do it every time.

### Testing it

1. Navigate to a book's detail page. Note the description. Cache: MISS first load, HIT on refresh.
2. Click "Edit description." Change the text. Save.
3. You're redirected to the detail page. Cache: MISS (the old entry was invalidated). New description displayed.
4. Refresh. Cache: HIT. New description still there, cached from the fresh query in step 3.
5. Navigate to the genre listing containing this book. Cache: MISS (the genre listing was also invalidated). New description appears.

Without write-through invalidation, step 3 would show Cache: HIT with the old description until TTL expired. That's the problem we're solving.

### When to use pattern-based invalidation

We just used `cache.invalidate_pattern("genre:*")` in the edit route. It cleared all genre caches with one call instead of requiring us to know which specific genre the book belongs to. For this workshop, we could have used `cache.invalidate(f"genre:{book['genre']}")` instead (targeted invalidation). Both work. I prefer the pattern approach here because it's more defensive. If your data model changes and a book appears in multiple genres, the pattern still works without modification.

Pattern-based invalidation becomes the clear choice when relationships are many-to-many, when a write could affect entries you can't enumerate cheaply, or when you're doing bulk operations (importing a CSV of new books, for example).

You know by now, but, as a reminder, safety files are in the `safety` directory.

## Part 5: Understanding the tradeoffs

We have a working write-through cache. Every read checks the cache first. Every write invalidates affected entries. Worth stepping back to look at when this works and when it doesn't.

### When database caching is worth it

Caching database queries makes sense when the same query runs repeatedly with the same parameters (high read-to-write ratio), when query latency is significant (complex joins, large result sets, remote databases), when database load needs to come down, or when some staleness is acceptable. Even a few seconds of caching helps under load.

In this workshop our dataset is small and the database is local. The milliseconds saved aren't dramatic. In production, where a query takes fifty to two hundred milliseconds because the database is in a different availability zone, caching cuts that to sub-millisecond on hits.

### When it adds more complexity than value

Caching isn't always the right answer. Write-heavy workloads where data changes on nearly every request invalidate cache entries faster than they can be used. Highly personalized data unique to each user has a low hit rate. Data with strict consistency requirements (financial transactions, inventory counts) where even brief staleness is unacceptable. Simple, fast queries where the database already responds in under a millisecond. If your data changes on every request, your cache is just a slower database with extra steps.

### The consistency question

What we've implemented here is eventual consistency between the database and the cache. After a write, there's a brief window (between the database commit and cache invalidation completing) where the cache entry doesn't exist and the next request fetches fresh data. In practice, that window is microseconds on a local connection.

Here's the harder case: Multiple application instances. Instance A updates the database and invalidates the key. But what about instance B? Valkey solves this because all instances share the same external cache. Once a key is deleted from Valkey, every instance sees the deletion on the next read. That's one of the advantages of an external cache over in-process caching.

### Seeing graceful degradation firsthand

You built graceful degradation into the cache layer (connection errors return safe defaults), but you haven't seen it work. Try it:

```bash
docker compose -f ../docker-compose.yml stop valkey
```

Now refresh a page in the browser. The app still works. Query times are back to database speed (double-digit milliseconds), the cache status shows MISS on every request (the cache layer attempts the operation, fails, and falls through to the database), and if you look at the terminal where Flask is running you'll see logged warnings about Valkey connection failures. The application slowed down but didn't crash.

Start Valkey again:

```bash
docker compose -f ../docker-compose.yml up -d valkey
```

Refresh. The cache is empty (Valkey lost its data when stopped), so you'll see MISS on the first request and HIT on the second. The system recovered without intervention. That's what graceful degradation looks like in practice: the cache is an optimization, not a requirement for correctness.

## Wrapping up

We replaced a simulated delay with a real database, applied cache-aside, and added write-through invalidation. What's different from the 100-level is that invalidation now requires understanding your data relationships. When a book changes, both the book cache and the genre cache are affected. That relationship-awareness is what makes production caching interesting.

These patterns scale directly. Our bookstore is small, but the architecture is the same whether you have sixty-seven books or sixty-seven million.

## Going further

The 300-level workshop (when available) builds on this with multiple TTL strategies, cache warming, and stampede prevention.

For reference:

- [Valkey SCAN command documentation](https://valkey.io/commands/scan/)
- [PostgreSQL documentation](https://www.postgresql.org/docs/16/)
- [psycopg documentation](https://www.psycopg.org/psycopg3/docs/)

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines on adding language implementations or improving workshop content.

## License

[WTFPL](../../LICENSE)
