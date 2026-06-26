# A Developer's Introduction to Caching with Valkey

Welcome to A Developer's Introduction to Caching with Valkey.

By the end of this workshop you'll have achieved three outcomes:
1. You'll understand what caching is, why it matters, and where it fits in application architecture
2. You'll be able to add a Valkey caching layer to a web application and observe the performance difference
3. You'll understand cache expiration and manual invalidation

To complete this workshop, you'll need Python 3.9 or later, Docker running on your machine, a text editor, and a terminal. The implementation files live in the `python/` subdirectory. All commands in this guide should be run from within that directory unless noted otherwise.

## Part 1: What is caching and why should you care?

If there's one sentence that captures caching, it's this: store the result of an expensive operation so you don't have to repeat it.

> "A cache stores data so that future requests for that data can be served faster; the data stored in a cache might be the result of an earlier computation or a copy of data stored elsewhere." [Wikipedia, Cache (computing)](https://en.wikipedia.org/wiki/Cache_(computing))

Your web browser caches images so it doesn't re-download them on every page load. DNS servers cache domain lookups so they don't traverse the full hierarchy every time. CDNs cache web content at edge locations. The pattern is the same: something is slow or expensive to produce, so you keep a copy of the result somewhere fast.

### Why this matters for application developers

Consider a web application that calls an external API on every request. The API takes two seconds to respond. Every user waits two seconds regardless of whether someone else asked the same question five seconds ago. As traffic grows, the problem compounds. The API gets hammered with duplicate requests, your latency stays bad, and nobody's happy.

Caching breaks this cycle. The first request pays the full cost. Every subsequent request for the same data returns instantly from the cache. The [Valkey documentation](https://valkey.io/docs/) identifies caching as one of the primary use cases for in-memory datastores precisely because this access pattern is so common.

Caching also introduces complexity. A cache can become a critical dependency. Cached data grows stale over time. These tradeoffs are real, and understanding them is part of learning to use caching effectively. In this workshop, you'll experience both sides firsthand.

### Where caching fits in the architecture

The pattern we're implementing is called "cache-aside" (also known as "lazy caching"). In this pattern, the application is responsible for managing the cache. The cache does not talk to the data source directly. Instead, your application code checks the cache, decides whether to fetch from the source, and writes the result back to the cache when it does. The cache is "aside" from the main data path: it only gets populated when the application explicitly puts data there.

The request flow works like this:

1. Application receives a request
2. Check the cache for existing data
3. **Cache hit**: data exists, return it immediately
4. **Cache miss**: fetch from the slow source, store the result in the cache, return it

The cache layer sits between your route handler and your data source. When the handler needs data, it checks the cache first. If the data's there, it skips the slow source entirely.

### Three definitions you need

**Caching** is storing the results of expensive operations in a fast-access layer so repeated requests don't repeat the original work.

**Time-to-live (TTL)** is how long a cached entry remains valid before the system removes it automatically. Set a key with a thirty-second TTL, and Valkey deletes it after thirty seconds. The [Valkey TTL command documentation](https://valkey.io/commands/ttl/) covers the mechanics.

**Cache invalidation** is removing entries before their TTL expires because you know the underlying data has changed. Phil Karlton's often-quoted observation that this is one of the two hard problems in computer science speaks to how tricky it gets in practice.

### What's Valkey?

[Valkey](https://valkey.io/) is an open source, in-memory datastore that the [Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community) hosts and the community maintains. It stores data in RAM, which means reads and writes complete in sub-millisecond time. For this workshop, you'll use it as a straightforward key/value cache: store a JSON string under a key, retrieve it later by that same key.

## Part 2: Building the application without a cache

In this part, you complete a Flask web application that fetches data from a deliberately slow source. Every request takes over two seconds. This baseline is the point: you need to feel the problem before the solution makes sense.

The project already contains starter files with TODO placeholders. You will open each file and fill in the missing logic. The code blocks below show what the completed version looks like, so you know exactly what to paste in.

### The data source

Open `data_source.py` in your text editor. You will see a skeleton with TODO comments marking where code needs to go. Replace the TODOs with the following:

First, replace the empty `_FACTS_DATABASE = {}` with this populated dictionary:

```python
_FACTS_DATABASE = {
    "valkey": [
        "Valkey is an open source high-performance key/value datastore.",
        "Valkey supports strings, hashes, lists, sets, and sorted sets.",
        "Valkey was created as a community-driven fork in 2024.",
        "Valkey is licensed under the BSD 3-Clause license.",
        "Valkey maintains backward compatibility with existing clients and protocols.",
    ],
    "python": [
        "Python was created by Guido van Rossum and first released in 1991.",
        "Python uses indentation to define code blocks instead of curly braces.",
        "Python supports multiple programming paradigms including procedural, object-oriented, and functional.",
        "The Python Package Index (PyPI) hosts over 400,000 packages.",
        "Python is dynamically typed and garbage-collected.",
    ],
    "docker": [
        "Docker uses OS-level virtualization to deliver software in containers.",
        "Docker containers share the host system kernel, making them lighter than virtual machines.",
        "A Dockerfile defines the steps to build a container image.",
        "Docker Hub is a public registry for sharing container images.",
        "Docker Compose allows defining multi-container applications in a single YAML file.",
    ],
    "caching": [
        "Caching stores copies of data in a high-speed storage layer for faster retrieval.",
        "Cache invalidation is one of the two hard problems in computer science.",
        "A cache hit occurs when requested data is found in the cache.",
        "A cache miss occurs when requested data is not in the cache and must be fetched from the source.",
        "Time-to-live (TTL) determines how long a cached entry remains valid before expiring.",
    ],
    "ttl": [
    "TTL stands for time-to-live and originated in IP networking to prevent packets from circling forever.",
    "Valkey implements TTL by storing the absolute Unix timestamp at which a key expires.",
    "A key with a TTL of zero is deleted immediately, which is equivalent to calling DEL.",
    "Valkey checks for expired keys using both lazy deletion on access and periodic background sampling.",
    "Setting a new value on an existing key removes its TTL unless you explicitly pass an expiration again.",
    ],
}
```

Then, replace the TODO comments in the `get_facts` function with this logic:

```python
def get_facts(topic):
    normalized_topic = topic.strip().lower()

    delay = float(os.environ.get("SLOW_DELAY_SECONDS", "2.5"))
    time.sleep(delay)

    facts = _FACTS_DATABASE.get(normalized_topic, [])

    return {
        "topic": normalized_topic,
        "facts": facts,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
```

This module simulates an expensive external operation with a 2.5-second `time.sleep()`. The delay is configurable via the `SLOW_DELAY_SECONDS` environment variable if you want to speed things up during development.

The output is deterministic: same topic in, same facts out. This matters when you add caching, because you'll be able to verify that cached responses match fresh ones.

### The Flask application

Open `app.py`. The starter has the imports, Flask setup, and the home route already done. You need to fill in the `/lookup` route. Replace the TODO section with:

```python
@app.route("/lookup")
def lookup():
    topic = request.args.get("topic", "").strip().lower()

    if not topic:
        flash("Please enter a topic to look up.")
        return redirect(url_for("home"))

    start = time.perf_counter()
    result = get_facts(topic)
    end = time.perf_counter()

    elapsed_ms = round((end - start) * 1000)

    return render_template("index.html",
        topic=result["topic"],
        facts=result["facts"],
        elapsed_ms=elapsed_ms,
        cache_status="DISABLED",
        fetched_at=result["fetched_at"],
        cache_warning=None,
    )
```

This is the no-cache version. Every request goes straight to the slow data source. The timing display shows how long each request took, and the cache status reads "DISABLED" because there's no cache yet. You'll change this in Part 4.

### The HTML template

Open `templates/index.html`. Replace the placeholder content with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Valkey Caching Workshop</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #333; }
        form { margin: 20px 0; }
        label { display: block; margin-bottom: 6px; font-weight: 500; }
        input[type="text"] { padding: 8px 12px; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px; width: 250px; }
        button { padding: 8px 16px; font-size: 1rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #1d4ed8; }
        .timing-info { margin: 20px 0; padding: 12px 16px; background: #f3f4f6; border-radius: 6px; display: flex; gap: 24px; }
        .timing-info span { font-weight: 500; }
        .facts-list { list-style: disc; padding-left: 20px; }
        .facts-list li { margin-bottom: 8px; line-height: 1.5; }
        .cache-warning { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; }
        .flash-message { background: #fee2e2; border: 1px solid #ef4444; color: #991b1b; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; }
    </style>
</head>
<body>
    <h1>Valkey Caching Workshop</h1>

    {% with messages = get_flashed_messages() %}
        {% if messages %}
            {% for message in messages %}
                <div class="flash-message" role="alert">{{ message }}</div>
            {% endfor %}
        {% endif %}
    {% endwith %}

    {% if cache_warning %}
        <div class="cache-warning" role="alert">{{ cache_warning }}</div>
    {% endif %}

    <form action="/lookup" method="get">
        <label for="topic-input">Enter a topic to look up:</label>
        <input type="text" id="topic-input" name="topic" placeholder="e.g. valkey, python, docker">
        <button type="submit">Look up</button>
    </form>

    {% if elapsed_ms is defined %}
    <div class="timing-info">
        <span>Response time: {{ elapsed_ms }} ms</span>
        <span>Cache: {{ cache_status }}</span>
    </div>
    {% endif %}

    {% if facts %}
    <h2>Facts about "{{ topic }}"</h2>
    <ul class="facts-list">
        {% for fact in facts %}
            <li>{{ fact }}</li>
        {% endfor %}
    </ul>
    {% endif %}
</body>
</html>
```

### Running it

You will need a text editor to modify the project files. Any editor works: VS Code, Sublime Text, Notepad, TextEdit (in plain text mode), or whatever you are comfortable with. If you do not have a preferred editor, [VS Code](https://code.visualstudio.com/) is a free option that works on all platforms.

Navigate into the Python implementation directory. All commands for the rest of this workshop should be run from here:

```bash
cd python
```

Set up a virtual environment. This keeps the workshop's dependencies isolated from the rest of your system (and on newer macOS and Ubuntu, `pip install` won't work without one):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Copy the example configuration file. The defaults work fine for now, but you'll edit this later when you enable caching:

```bash
cp .env.example .env
```

Start the app:

```bash
python app.py
```

This runs Flask's built-in development server on port 5000. You can also use `flask run` if you prefer, but `python app.py` is simpler for this workshop since it picks up all the configuration automatically.

Open [http://localhost:5000](http://localhost:5000). Search for "valkey." Watch the timing display. It takes about 2,500 ms. Search for "valkey" again. Same wait. The application doesn't remember anything between requests. Every lookup hits the slow source regardless of whether someone already asked for the same data.

This is the problem caching solves.

In case something has gone wrong, there are completed files in the `safety/` directory.

## Part 3: Running Valkey locally via Docker

Before you can add caching, you need a Valkey server. Docker gives you one with a single command.

### Starting Valkey

The workshop includes a `docker-compose.yml` one level up from the `python/` directory (in the `100-caching-intro/` root). Its contents:

```yaml
services:
  valkey:
    image: valkey/valkey:8.0
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 3
```

Run it from the `100-caching-intro/` directory (one level up from `python/`):

```bash
docker compose -f ../docker-compose.yml up -d
```

### Verifying it works

Confirm the container is up:

```bash
docker compose -f ../docker-compose.yml ps
```

Send a PING to verify Valkey is accepting connections:

```bash
docker compose -f ../docker-compose.yml exec valkey valkey-cli ping
```

You should see `PONG`. If you prefer verifying from Python:

```bash
python -c "import valkey; r = valkey.Valkey(); print(r.ping())"
```

This prints `True` if the connection succeeds.

### Stopping it

```bash
docker compose -f ../docker-compose.yml down
```

Data is lost when the container is removed. That's fine for a workshop. You will get a clean slate every time.

## Part 4: Adding the cache layer

You've got a slow application and a running Valkey server. Now you connect the two.

### The cache layer module

Open `cache_layer.py`. You will see a class skeleton with TODO placeholders in each method. The docstrings describe what each method should do, step by step. Fill in the method bodies with the following implementations:

**The `get` method:**

```python
    def get(self, key):
        try:
            raw = self._client.get(key)
            if raw is None:
                return (None, False)
            return (json.loads(raw), True)
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on get('%s'): %s", key, exc)
            return (None, False)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Deserialization error on get('%s'): %s", key, exc)
            return (None, False)
```

**The `set` method:**

```python
    def set(self, key, data):
        try:
            self._client.set(key, json.dumps(data), ex=self._ttl_seconds)
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on set('%s'): %s", key, exc)
        except (TypeError) as exc:
            logger.warning("Serialization error on set('%s'): %s", key, exc)
```

**The `invalidate` method:**

```python
    def invalidate(self, key):
        try:
            return self._client.delete(key) > 0
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on invalidate('%s'): %s", key, exc)
            return False
```

**The `is_connected` property:**

```python
    @property
    def is_connected(self):
        try:
            return self._client.ping()
        except (valkey.ConnectionError, valkey.TimeoutError):
            return False
```

The class wraps four Valkey operations: get, set, invalidate, and a connection health check. Data is serialized as JSON. Every method catches connection errors and degrades gracefully: `get` returns `(None, False)`, `set` becomes a no-op, `invalidate` returns `False`. If Valkey goes down, your application slows down but doesn't crash.

Keys follow the pattern `facts:{topic}`. The `facts:` prefix namespaces cache entries, and the topic maps directly to the user's input.

### Updating app.py

Now open `app.py` again. You need to replace the entire `/lookup` route you wrote in Part 2 with a version that checks the cache first, and add cache configuration at the top. Replace the full file contents with the following (comments mark what is new since Part 2):

```python
import os
import time

from dotenv import load_dotenv
from flask import Flask, flash, redirect, render_template, request, url_for

from data_source import get_facts

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

# --- NEW: cache configuration ---
CACHE_ENABLED = os.environ.get("CACHE_ENABLED", "false").lower() == "true"
cache = None

if CACHE_ENABLED:
    from cache_layer import CacheLayer
    cache = CacheLayer(
        host=os.environ.get("VALKEY_HOST", "localhost"),
        port=int(os.environ.get("VALKEY_PORT", "6379")),
        ttl_seconds=int(os.environ.get("CACHE_TTL_SECONDS", "30")),
    )
# --- END NEW ---


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/lookup")
def lookup():
    topic = request.args.get("topic", "").strip().lower()

    if not topic:
        flash("Please enter a topic to look up.")
        return redirect(url_for("home"))

    # --- NEW: cache-aside logic replaces the direct call to get_facts ---
    cache_status = "DISABLED"
    cache_warning = None
    result = None

    start = time.perf_counter()

    if CACHE_ENABLED and cache is not None:
        if cache.is_connected:
            cached_data, is_hit = cache.get(f"facts:{topic}")
            if is_hit:
                result = cached_data
                cache_status = "HIT"
            else:
                result = get_facts(topic)
                cache.set(f"facts:{topic}", result)
                cache_status = "MISS"
        else:
            cache_warning = (
                "Valkey is not reachable. Caching is disabled. "
                "Data is being fetched directly from the source."
            )
            result = get_facts(topic)
            cache_status = "MISS"
    else:
        result = get_facts(topic)

    end = time.perf_counter()
    elapsed_ms = round((end - start) * 1000)
    # --- END NEW ---

    return render_template("index.html",
        topic=result["topic"],
        facts=result["facts"],
        elapsed_ms=elapsed_ms,
        cache_status=cache_status,
        fetched_at=result["fetched_at"],
        cache_warning=cache_warning,
    )


if __name__ == "__main__":
    app.run(debug=True, port=5000)
```

The logic: if caching is enabled and Valkey is reachable, check the cache. On a hit, return the cached data. On a miss, call the slow source, store the result, and return it. If Valkey is down, fall back to the data source directly and show a warning.

### Enabling caching

Open your `.env` file (you created it earlier with `cp .env.example .env`) and change the `CACHE_ENABLED` value to `true`:

```
CACHE_ENABLED=true
```

Now make sure Valkey is running. If you stopped it after Part 3, start it again:

```bash
docker compose -f ../docker-compose.yml up -d
```

You can confirm it's healthy with:

```bash
docker compose -f ../docker-compose.yml ps
```

You should see the valkey service listed with a status of "Up" or "healthy."

Finally, restart the Flask app. Go to the terminal where `python app.py` is running, press `Ctrl+C` to stop it, then start it again:

```bash
python app.py
```

Flask needs to restart because the cache configuration is read once at startup. If you skip this step, `CACHE_ENABLED` will still be `false` in the running process even though you changed the file.

### Observing the difference

Search for "valkey." First time: about 2,500 ms, Cache: MISS. The data wasn't in the cache, so the app called the slow source and stored the result.

Search for "valkey" again. This time: about 1 ms, Cache: HIT. The app found the data in Valkey and returned it without touching the data source. That's a 2,500x improvement.

Try a different topic: "docker." Cache: MISS again, because that key hasn't been populated yet. Search "docker" a second time: instant.

In case something has gone wrong, there are completed files in the `safety/` directory.

## Part 5: Cache expiration and manual invalidation

A cache that never updates serves stale data forever. Two mechanisms keep things fresh: automatic expiration (TTL) and manual invalidation.

### How TTL works

TTL stands for "time-to-live." It's the number of seconds a cached entry remains valid before Valkey automatically deletes it. Think of it as an expiration date on the data.

Every time the cache layer stores an entry, it sets a TTL. In your application, that's thirty seconds (configurable via `CACHE_TTL_SECONDS`). Valkey tracks the countdown internally and deletes the key when it reaches zero. No application code needed.

The [Valkey EXPIRE command documentation](https://valkey.io/commands/expire/) explains the mechanics: Valkey stores the absolute Unix timestamp at which the key expires, then periodically removes expired keys.

TTL is a tradeoff. Short TTL means fresher data but fewer cache hits. Long TTL means more hits but staler data. Thirty seconds is enough to observe both behaviors without waiting forever.

### Seeing expiration in action

1. Search for "valkey." Cache: MISS. The thirty-second countdown starts.
2. Search again immediately. Cache: HIT. Under 1 ms.
3. Wait thirty seconds. Search again. Cache: MISS. The entry expired.

### Manual invalidation

Sometimes you need to remove an entry before its TTL expires. The `/invalidate` endpoint handles this. Add it to `app.py`:

```python
@app.route("/invalidate", methods=["POST"])
def invalidate():
    topic = request.form.get("topic", "").strip().lower()

    if not topic:
        flash("Please provide a topic to invalidate.")
        return redirect(url_for("home"))

    if CACHE_ENABLED and cache is not None:
        removed = cache.invalidate(f"facts:{topic}")
        if removed:
            flash(f"Cache entry for '{topic}' has been invalidated.")
        else:
            flash(f"No cache entry found for '{topic}'.")
    else:
        flash("Caching is not enabled.")

    return redirect(url_for("home"))
```

This route uses `methods=["POST"]` instead of the default GET. HTTP defines different "methods" (also called "verbs") for different kinds of actions. GET requests retrieve data without changing anything on the server; they're what your browser sends when you type a URL or submit the lookup form. POST requests tell the server to perform an action that changes state. Invalidating a cache entry is a state change (you're deleting data), so POST is the correct method. Using POST also prevents accidental invalidation from someone bookmarking or refreshing the URL.

The `invalidate` method calls Valkey's [DEL command](https://valkey.io/commands/del/), which removes the key immediately.

### Testing invalidation

1. Search for "valkey." Cache: MISS (entry stored).
2. Search again. Cache: HIT (entry exists).
3. Invalidate it using `curl`. The `-X POST` flag tells curl to send a POST request instead of the default GET, and the `-d` flag sends the form data:

```bash
curl -X POST http://localhost:5000/invalidate -d "topic=valkey"
```

4. Search again. Cache: MISS. The entry is gone.

### Invalidation in the real world

In production, invalidation is triggered by data changes, not manual HTTP calls. Common patterns: write-through invalidation (delete the cache entry when you update the source) and event-driven invalidation (a message queue notifies the cache layer when data changes). The principle is the same as what you practiced here.

In case something has gone wrong, there are completed files in the `safety/` directory.

## Wrapping up

You started with a web application that took over two seconds to respond to every request. You added a Valkey cache layer and dropped that to under one millisecond for repeat lookups. Along the way, you built the cache-aside pattern, configured TTL expiration, and implemented manual invalidation.

These are the same patterns used in production systems at scale. The mechanics are identical whether you're serving ten requests or ten million.

## Going further

This workshop is a 100-level introduction. When you're ready for the next step, continue with the [200-level workshop](../../200-database-caching/) which replaces the simulated delay with a real PostgreSQL database.

For deeper coverage of Valkey's capabilities, including data structures, persistence, pub/sub, and clustering:

- [Valkey documentation](https://valkey.io/docs/)
- [Valkey blog](https://valkey.io/blog/)
- [valkey-py client library](https://valkey-py.readthedocs.io/en/latest/)

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines on adding language implementations or improving workshop content.

## License

[WTFPL](../../LICENSE)
