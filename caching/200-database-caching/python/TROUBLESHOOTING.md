# Troubleshooting

Common issues during the 200-level workshop and how to fix them. Commands are written for a macOS or Linux shell; on Windows, or on a Linux system without a `python` command, see the [platform notes](../../../README.md#platform-notes).

## "port is already allocated" when starting Docker Compose

`docker compose -f ../docker-compose.yml up -d` fails with `Bind for 127.0.0.1:6379 failed: port is already allocated` (or the same message for port 5432). The 100, 200, and 300 levels all publish Valkey on port 6379, and the 200, 300, and 400 levels all publish PostgreSQL on port 5432, so a stack from another level is still running. Stop it from that level's directory, for example `docker compose down` in `100-caching-intro`, then start this one again. `docker ps` lists every running container if you are not sure which level is still up.

## Docker is not running

If Docker commands fail with `Cannot connect to the Docker daemon`, start Docker Desktop (or, on Linux, the Docker Engine service), wait for it to finish starting, and retry. On Linux, a "permission denied" error instead means your user cannot reach the Docker socket; see the [platform notes](../../../README.md#platform-notes).

## The app fails with `KeyError: 'DATABASE_URL'`, or seed_db.py says DATABASE_URL is not set

The app raises `KeyError: 'DATABASE_URL'`, and `python seed_db.py` prints `ERROR: DATABASE_URL is not set. Copy .env.example to .env and check the value.` Both mean your `.env` file is missing or doesn't have `DATABASE_URL` set. Copy the example:

```bash
cp .env.example .env
```

Then confirm it contains:

```
DATABASE_URL=postgresql://workshop:workshop@localhost:5432/bookstore
```

## PostgreSQL refuses the connection

`python seed_db.py` prints `ERROR: Could not connect to the database. Is PostgreSQL running?`, or the app's error includes `port 5432 failed` and `Connection refused`. The PostgreSQL container isn't running. From the `python/` directory:

```bash
docker compose -f ../docker-compose.yml up -d
docker compose -f ../docker-compose.yml ps
```

You should see `postgres` listed with a status of "Up" or "healthy." If it shows "starting," wait a few seconds and check again. PostgreSQL takes a moment to initialize on first run.

Also confirm nothing else is using port 5432:

```bash
lsof -i :5432
```

(On Windows, use `netstat -ano | findstr :5432`; see the [platform notes](../../../README.md#platform-notes).)

## The seed script says "Database seeded successfully" but the app shows no genres

If you haven't completed Part 2 yet, this is expected: the starter `home()` route and `get_all_genres()` return empty lists, and opening a book page directly (such as [http://localhost:5000/book/13](http://localhost:5000/book/13)) returns you home with "Book not found." until you fill them in.

Otherwise, the seed script and the app are using different databases. Check that `DATABASE_URL` in your `.env` matches the credentials in `docker-compose.yml` (user: `workshop`, password: `workshop`, database: `bookstore`, port: `5432`).

You can verify data exists by querying directly:

```bash
docker compose -f ../docker-compose.yml exec postgres psql -U workshop -d bookstore -c "SELECT COUNT(*) FROM books;"
```

Should return sixty-seven.

## I get `relation "books" does not exist`

The seed script hasn't been run yet. The PostgreSQL container starts with an empty database. Run:

```bash
python seed_db.py
```

## I get "ModuleNotFoundError: No module named 'psycopg'"

You're running Python outside the virtual environment. (On Windows or Linux, the activation and `python` commands differ; see the [platform notes](../../../README.md#platform-notes). On Windows on Arm, use WSL 2: this level's pinned `psycopg[binary]` has no Windows Arm64 package.) Activate it:

```bash
source .venv/bin/activate
```

If you haven't created it yet:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Pages show "Cache: DISABLED"

Caching is turned off. Check that your `.env` file exists (`cp .env.example .env` if not) and contains `CACHE_ENABLED=true`. The value is not case-sensitive, but it must be the word `true`; `yes` and `1` are not accepted. Then restart Flask. The config is read at startup, and debug mode reloads the app when you save a `.py` file, not when you edit `.env`, so changing the file without restarting has no effect.

If `CACHE_ENABLED` is already `true`, check that you completed Part 3: the starter routes report `DISABLED` until you replace them.

## Cache shows MISS every time

With caching enabled, a MISS on every request means Valkey is not answering. Look in the terminal running Flask for lines like `WARNING:cache_layer: Valkey connection error on get('genre:fantasy')`. Verify Valkey is reachable:

```bash
docker compose -f ../docker-compose.yml exec valkey valkey-cli ping
```

Should return `PONG`. If Valkey was stopped (for example, in Part 5's failure exercise), start it again with `docker compose -f ../docker-compose.yml up -d valkey`.

## I edited a book but the old description still shows

If caching is enabled, the edit route invalidates affected cache keys automatically. If you're still seeing old data:

1. Confirm you completed Part 4. Until then, the starter edit route only shows "Edit functionality not implemented yet." and changes nothing.
2. Confirm you restarted Flask after setting `CACHE_ENABLED=true`
3. Check that the edit actually saved (look for the green flash message "Description updated for..." on the book page)
4. If you changed the database directly, for example with the `psql` UPDATE in Part 3, the app never saw the write, so nothing invalidated the cache. Delete the keys manually with `docker compose -f ../docker-compose.yml exec valkey valkey-cli DEL book:13`, or wait for the TTL to expire.

## Port 5000 is already in use

On macOS, AirPlay Receiver listens on port 5000 whenever it is enabled. Either disable it in System Settings (General, then AirDrop & Handoff) or change the Flask port. Edit the last line of `app.py`:

```python
app.run(debug=True, port=5001)
```

## Port 5432 is already in use

You have another PostgreSQL instance running locally. Either stop it or change the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "127.0.0.1:5433:5432"
```

Then update `DATABASE_URL` in your `.env` to use port 5433:

```
DATABASE_URL=postgresql://workshop:workshop@localhost:5433/bookstore
```

## `docker compose` gives "command not found"

Older Docker installations use `docker-compose` (with a hyphen). Try:

```bash
docker-compose -f ../docker-compose.yml up -d
```

If that also fails, Docker isn't installed or isn't in your PATH. Follow the [Docker installation guide](https://docs.docker.com/get-docker/).

## I want to start over with a clean database

Stop the containers, remove the volume, and start fresh:

```bash
docker compose -f ../docker-compose.yml down -v
docker compose -f ../docker-compose.yml up -d --wait
python seed_db.py
```

The `-v` flag removes the PostgreSQL data volume so the database is truly empty on next start. The `--wait` flag makes Docker Compose return only once both containers report healthy; on a fresh volume, PostgreSQL takes a few seconds to initialize, and seeding before then fails with "Is PostgreSQL running?"

## What is the `safety/` directory?

Completed final versions of the source files, as they stand at the end of the workshop. If your code isn't working and you can't figure out where it diverged, copy them over:

```bash
cp safety/app.py app.py
cp safety/db.py db.py
cp safety/cache_layer.py cache_layer.py
```

The templates in `safety/templates/` are identical to the ones in `templates/`, so you don't need to copy them. (On Windows PowerShell, use `Copy-Item` instead of `cp`; see the [platform notes](../../../README.md#platform-notes).)
