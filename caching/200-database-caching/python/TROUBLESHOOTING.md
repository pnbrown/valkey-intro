# Troubleshooting

Common issues you might hit during the 200-level workshop and how to fix them.

## I get "KeyError: DATABASE_URL" when running the app or seed script

Your `.env` file is missing or doesn't have `DATABASE_URL` set. Copy the example:

```bash
cp .env.example .env
```

Then confirm it contains:

```
DATABASE_URL=postgresql://workshop:workshop@localhost:5432/bookstore
```

## I get "could not connect to server: Connection refused" from PostgreSQL

The PostgreSQL container isn't running. From the `python/` directory:

```bash
docker compose -f ../docker-compose.yml up -d
docker compose -f ../docker-compose.yml ps
```

You should see `postgres` listed with a status of "Up" or "healthy." If it shows "starting," wait a few seconds and check again. PostgreSQL takes a moment to initialize on first run.

Also confirm nothing else is using port 5432:

```bash
lsof -i :5432
```

## The seed script says "Database seeded successfully" but the app shows no genres

The seed script ran against a different database than the app is reading from. Check that `DATABASE_URL` in your `.env` matches the credentials in `docker-compose.yml` (user: `workshop`, password: `workshop`, database: `bookstore`, port: `5432`).

You can verify data exists by querying directly:

```bash
docker compose -f ../docker-compose.yml exec postgres psql -U workshop -d bookstore -c "SELECT COUNT(*) FROM books;"
```

Should return sixty-two.

## I get "relation 'books' does not exist"

The seed script hasn't been run yet. The PostgreSQL container starts with an empty database. Run:

```bash
python seed_db.py
```

## I get "ModuleNotFoundError: No module named 'psycopg'"

You're running Python outside the virtual environment. Activate it:

```bash
source .venv/bin/activate
```

If you haven't created it yet:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Cache shows MISS every time even though Valkey is running

Check your `.env` file has `CACHE_ENABLED=true` (exact lowercase string). Then restart Flask. The config is read at startup; changing the file without restarting has no effect.

Verify Valkey is reachable:

```bash
docker compose -f ../docker-compose.yml exec valkey valkey-cli ping
```

Should return `PONG`.

## I edited a book but the old description still shows

If caching is enabled, the edit route invalidates affected cache keys automatically. If you're still seeing old data:

1. Confirm you restarted Flask after setting `CACHE_ENABLED=true`
2. Check that the edit actually saved (look for the green flash message "Description updated for...")
3. If you're testing with curl or a separate script that bypasses the edit route, you need to invalidate manually

## Port 5000 is already in use

On macOS, AirPlay Receiver binds to port 5000. Either disable it in System Settings (General, then AirDrop & Handoff) or change the Flask port. Edit the last line of `app.py`:

```python
app.run(debug=True, port=5001)
```

## Port 5432 is already in use

You have another PostgreSQL instance running locally. Either stop it or change the port mapping in `docker-compose.yml`:

```yaml
ports:
  - "5433:5432"
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
docker compose -f ../docker-compose.yml up -d
python seed_db.py
```

The `-v` flag removes the PostgreSQL data volume so the database is truly empty on next start.

## What is the `safety/` directory?

Completed reference versions of all source files. If your code isn't working and you can't figure out where it diverged, copy them over:

```bash
cp safety/app.py app.py
cp safety/db.py db.py
cp safety/cache_layer.py cache_layer.py
```
