# Frequently Asked Questions

This document covers common questions about the design decisions in this workshop and links to official documentation for further reading. For help with specific errors or setup issues, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Design Decisions

### Why does the workshop run Valkey in a Docker container?

Valkey is a standalone server process, not a library you import into Python. Someone following this workshop needs a running Valkey instance to connect to, and Docker is the lowest-friction way to provide one across all platforms.

Running Valkey in a container means no platform-specific installation steps, no compiling from source, and no worrying about conflicting versions. A single `docker compose -f ../docker-compose.yml up -d`, run from the `python/` directory, gives you a working server on macOS, Linux, or Windows with WSL. When you're done, `docker compose -f ../docker-compose.yml down` removes everything cleanly. No leftover processes, no stale data between sessions.

This also mirrors how Valkey is deployed in production. Your application and your cache server are separate processes, often on separate machines. The container makes that architectural separation visible from the start.

For more on running Valkey with Docker, see the [official Valkey container image on Docker Hub](https://hub.docker.com/r/valkey/valkey).

### What is cache-aside and why did you choose it?

Cache-aside (also called "lazy caching") is a pattern where the application manages the cache explicitly. Your code checks the cache, decides whether to fetch from the original source, and writes results back to the cache. The cache itself has no awareness of the data source.

This workshop uses cache-aside because it is the simplest caching pattern to understand and implement. The application has full control over what gets cached, when it gets cached, and when it gets removed. There is no background process syncing data, no configuration on the Valkey side beyond accepting connections.

Other patterns exist. Write-through caching updates the cache on every write to the source. Read-through caching has the cache layer fetch from the source automatically on a miss. These add complexity that would distract from the core concepts at a 100-level introduction.

The [Valkey documentation](https://valkey.io/docs/) covers the commands used in cache-aside (GET, SET with EX, DEL) in detail.

### Why does the application fall back gracefully when Valkey is unavailable?

The cache layer wraps every Valkey operation in a try/except block that catches `ConnectionError` and `TimeoutError`. If Valkey is unreachable, the application skips the cache and calls the data source directly. This means the application gets slower (every request pays the full 2.5-second cost) but never crashes.

This is a deliberate design choice. A cache is an optimization, not a requirement for correctness. If your cache goes down, users should still get correct data, just more slowly. The alternative (letting the exception propagate and returning a 500 error) would make the cache a hard dependency, which defeats the purpose of it being an acceleration layer.

The workshop displays a yellow warning banner when Valkey is unreachable so you can see the fallback behavior in action.

### Why is `CACHE_ENABLED` a separate flag instead of just checking whether Valkey is reachable?

Separating the "should we try to cache" decision from the "can we reach Valkey" check gives you explicit control. You can turn caching off while debugging without stopping the Valkey container, or run the application in a test environment where no Valkey server exists. The flag makes the behavior predictable: if `CACHE_ENABLED=false`, the application never attempts a Valkey connection, regardless of whether one is available.

### Why does the workshop use `time.sleep()` instead of a real external API?

A real API introduces variables outside your control: network latency, rate limits, authentication, downtime. Each of them is a way for the workshop to fail for reasons unrelated to caching. The simulated delay gives you a consistent, reproducible 2.5-second wait that you can observe, measure, and compare against cached responses.

The delay is configurable via the `SLOW_DELAY_SECONDS` environment variable in your `.env` file. If you want faster iterations during development, set it to `1` or `0.5`.

### Why JSON for serialization instead of something more efficient?

The cache layer serializes data as JSON strings before storing them in Valkey. JSON is human-readable, which makes debugging straightforward: you can run `docker compose -f ../docker-compose.yml exec valkey valkey-cli GET facts:valkey` to see exactly what is stored. Binary formats like pickle or msgpack store the same data in a form you cannot read in `valkey-cli`, and they add concepts that distract from the caching lesson itself.

In production, the choice depends on your data size and performance requirements. For most web application caching use cases, JSON is sufficient.

### Why does the cache key use a `facts:` prefix?

The key format `facts:{topic}` uses a prefix to namespace the entries. If your application later caches other types of data (user sessions, configuration, rate-limit counters), each type gets its own prefix. This prevents key collisions and makes it easy to identify what a key contains when inspecting Valkey directly.

The [Valkey keyspace documentation](https://valkey.io/topics/keyspace/) recommends sticking with a schema such as "object-type:id" (its example is `user:1000`), which is the shape `facts:valkey` follows.

---

## Concepts

### What is TTL and how do I choose a value?

TTL stands for "time-to-live." When you store a key in Valkey with a TTL, Valkey automatically deletes that key after the specified number of seconds. No application code runs to clean it up; Valkey handles it internally.

This workshop uses a thirty-second TTL. That value is short enough that you can observe expiration during the workshop without waiting too long, but long enough to demonstrate multiple cache hits before the entry disappears.

In production, TTL values depend on how often the underlying data changes and how much staleness your application can tolerate. A product catalog that updates once a day can tolerate a TTL of several hours. A stock price feed needs a TTL of a few seconds. There is no universal correct value.

For the mechanics of how Valkey implements expiration, see the [EXPIRE command documentation](https://valkey.io/commands/expire/) and the [TTL command documentation](https://valkey.io/commands/ttl/).

### What are GET and POST requests?

HTTP defines several "methods" (also called "verbs") that indicate what kind of action a request is performing.

**GET** retrieves data without changing anything on the server. When you type a URL into your browser, submit a search form, or click a link, your browser sends a GET request. GET requests are safe to repeat, bookmark, and cache. The `/lookup` route in this workshop uses GET because looking up facts is a read-only operation.

**POST** tells the server to perform an action that changes state. Creating a record, submitting a payment, or deleting a cache entry are all state changes. The `/invalidate` route uses POST because it removes data from Valkey. Using POST prevents accidental invalidation from someone bookmarking the URL or a browser pre-fetching the link.

The `curl` command in Part 5 uses `-X POST` to specify the POST method and `-d "topic=valkey"` to send form data in the request body (the same way an HTML form with `method="post"` would). In Windows PowerShell, type `curl.exe` instead of `curl`; see the [platform notes](../../../README.md#platform-notes).

For a complete reference, see [MDN's HTTP request methods documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods).

### What is the difference between cache invalidation and expiration?

Expiration (TTL) is automatic. You set a duration when storing the key, and Valkey removes it after that time elapses. No code runs; it happens in the background.

Invalidation is manual. Your application explicitly tells Valkey to delete a key because you know the underlying data has changed. In this workshop, the `/invalidate` endpoint demonstrates this by calling Valkey's DEL command.

Both serve the same purpose (preventing stale data) but are triggered differently. TTL handles the common case where data drifts out of date over time. Invalidation handles the specific case where you know right now that the cached version is wrong.

### What happens if two requests arrive at the same time for an uncached topic?

Both requests will see a cache miss, both will call the slow data source, and both will write the result to the cache. The second write overwrites the first with identical data, so no harm is done. This is called a "thundering herd" or "cache stampede" in the case where many requests arrive simultaneously for the same uncached key.

For this workshop, this is not a problem because the data source is deterministic (same input always produces the same output). High-traffic production systems prevent the redundant work with techniques like request coalescing or locking. These are beyond the scope of a 100-level introduction; the [300-level workshop](../../300-protecting-cache/) builds a lock-based version.

### What is `decode_responses=True` in the Valkey client?

By default, the valkey-py client returns bytes from Valkey (e.g., `b'{"topic": "valkey"}'`). Setting `decode_responses=True` tells the client to decode those bytes to Python strings automatically. This saves you from calling `.decode("utf-8")` on every response. `json.loads()` accepts bytes as well as strings, so the cache layer's `get` works either way; the setting matters for everything else you read back, such as the replies you print while experimenting, which are easier to read as strings.

### What data types does Valkey support beyond strings?

This workshop uses only strings (storing JSON-serialized data as string values), but Valkey supports several data types: hashes, lists, sets, sorted sets, streams, and more. Each type has specialized commands optimized for different access patterns. For example, sorted sets are useful for leaderboards, and streams are useful for event logs.

The [Valkey data types documentation](https://valkey.io/topics/data-types/) provides a complete overview.

### Does Valkey persist data to disk?

Yes, by default. Valkey supports two kinds of persistence, point-in-time snapshots (RDB) and an append-only file (AOF). The workshop runs the Valkey image with its default settings, which turn on snapshots: Valkey saves its data to a file inside the container when it shuts down (and periodically while it runs), then loads that file when it starts again. So `docker compose stop` followed by `docker compose start` brings your cached keys back, minus any whose TTL ran out. `docker compose down` removes the container and the file with it, so the next `up` starts with an empty cache. For a cache, losing the data is acceptable because it can always be regenerated from the original source.

In production, whether you enable persistence depends on your use case. A pure cache does not need persistence. A session store or a primary datastore would.

The [Valkey persistence documentation](https://valkey.io/topics/persistence/) covers both options in detail.

---

## Python and Environment

### Why use a virtual environment?

A virtual environment creates an isolated Python installation for this project. Packages you install with `pip` go into the `.venv/` directory instead of your system Python. This prevents version conflicts between projects. Some operating systems also mark their system Python as "externally managed" under [PEP 668](https://peps.python.org/pep-0668/), and there `pip install` refuses to install packages outside a virtual environment.

The [Python venv documentation](https://docs.python.org/3/library/venv.html) covers the details.

### What does `python-dotenv` do?

The `load_dotenv()` call at the top of `app.py` reads your `.env` file and sets those values as environment variables in the running process. This keeps configuration (hostnames, ports, feature flags) separate from code. You can change behavior by editing `.env` instead of modifying Python files.

The [python-dotenv documentation](https://github.com/theskumar/python-dotenv) covers advanced usage like overriding variables and specifying alternate file paths.

### What does `flask` do? What is a "web framework"?

Flask is a web framework for Python. A web framework handles the repetitive parts of building a web application: listening for HTTP requests, routing them to the correct function based on the URL, rendering HTML templates, managing sessions, and sending responses back. Without a framework, you would need to write all of this yourself using low-level socket and HTTP parsing code.

In this workshop, Flask handles the web plumbing so you can focus on the caching logic.

The [Flask documentation](https://flask.palletsprojects.com/) is the official reference.

### Can I use a different Python version?

The workshop requires Python 3.9 or later. This minimum is set by Flask 3.1 (the workshop pins `Flask==3.1.1`), which requires Python 3.9 or later according to its [PyPI page](https://pypi.org/project/Flask/3.1.1/). If you have a newer version (3.10, 3.11, 3.12, 3.13), it will work without changes.

To check your version:

```bash
python --version
```

If your system has no `python` command, or it points to Python 2, run `python3 --version` and create the virtual environment with `python3 -m venv .venv`. Once the virtual environment is active, `python` points to its Python 3 interpreter, so the rest of the workshop's commands work as written. The [platform notes](../../../README.md#platform-notes) cover the Debian and Ubuntu `python3-venv` package and the Windows equivalents.

---

## Going Deeper

### Can I use Valkey for things other than caching?

Valkey is a general-purpose in-memory datastore. Common use cases beyond caching include session storage, rate limiting, real-time leaderboards, pub/sub messaging, job queues, and geospatial indexing. Each use case leverages different Valkey data types and commands.

The [Valkey documentation](https://valkey.io/docs/) provides guidance on these patterns.

### How would this work in production instead of localhost?

In production, Valkey runs on a dedicated server or a managed service rather than a Docker container on your laptop. The application connects to it over the network using a hostname and port, exactly as it does in this workshop (just with a different `VALKEY_HOST` value in the environment). You would also add authentication, TLS encryption, and connection pooling.

Managed Valkey services handle replication, failover, and scaling so you do not need to operate the infrastructure yourself.

### What is connection pooling and do I need it?

Connection pooling reuses a set of open connections to Valkey rather than creating a new connection for every request. The valkey-py client uses a connection pool by default. The `Valkey()` constructor in `cache_layer.py` creates a pool automatically; you do not need to configure it manually for this workshop.

High-traffic production applications tune the pool size to match how many requests run at once. The [valkey-py documentation](https://valkey-py.readthedocs.io/en/latest/) covers connection pool configuration.

### What happens if Valkey runs out of memory?

If Valkey reaches its configured memory limit, it can be set to evict older keys to make room for new ones. The eviction policy determines which keys get removed (least recently used, least frequently used, random, only keys that have a TTL, and others), or whether Valkey refuses writes that need more memory instead. This workshop does not configure a memory limit because the dataset is tiny, but production deployments should always set one.

The [Valkey eviction documentation](https://valkey.io/topics/lru-cache/) explains the available policies.

### Which Python client does the workshop use?

The workshop uses [valkey-py](https://github.com/valkey-io/valkey-py), the Python client published under the Valkey project's `valkey-io` organization on GitHub, which describes itself as the Python interface to the Valkey key-value store. You install it with `pip install valkey` (the workshop's `requirements.txt` pins `valkey==6.1.0`) and import it with `import valkey`. Each `valkey.Valkey(...)` client manages its own connection pool, so the cache layer creates one client and reuses it for every request.

The [valkey-py documentation](https://valkey-py.readthedocs.io/en/latest/) covers the full API, including pipelines (used in the 300-level workshop) and cluster connections (used in the 400-level workshop).

---

## Further Reading

- [Valkey documentation](https://valkey.io/docs/) covers all commands, data types, configuration, and deployment options.
- [Valkey blog](https://valkey.io/blog/) publishes technical deep-dives and release announcements.
- [valkey-py client library](https://valkey-py.readthedocs.io/en/latest/) is the Python client used in this workshop.
- [Valkey command reference](https://valkey.io/commands/) provides detailed documentation for every command, including the [GET](https://valkey.io/commands/get/), [SET](https://valkey.io/commands/set/), [DEL](https://valkey.io/commands/del/), [EXPIRE](https://valkey.io/commands/expire/), and [TTL](https://valkey.io/commands/ttl/) commands used in this workshop.
- [Flask documentation](https://flask.palletsprojects.com/) is the official reference for the web framework used in this workshop.
- [Flask quickstart](https://flask.palletsprojects.com/quickstart/) covers routing, templates, and request handling.
- [Python venv documentation](https://docs.python.org/3/library/venv.html) explains virtual environments.
- [Docker getting started guide](https://docs.docker.com/get-started/) covers containers, images, and Docker Compose.
- [MDN HTTP overview](https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview) is a beginner-friendly introduction to how HTTP works.
