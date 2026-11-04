# Troubleshooting

Common issues we've seen during the workshop and how to resolve them. Commands are written for a macOS or Linux shell; on Windows, or on a Linux system without a `python` command, see the [platform notes](../../../README.md#platform-notes).

## Searching does nothing and sends me back to the home page

That is the starter code. Until you complete Part 2, the `/lookup` route redirects straight back to the home page and `get_facts()` returns no facts. Fill in `data_source.py` and the `/lookup` route as described in Part 2, then restart the app.

## A topic shows a response time but no facts

The data source only knows four topics: `valkey`, `python`, `docker`, and `caching`. Any other topic still pays the 2.5-second delay and returns an empty list.

## "port is already allocated" when starting Docker Compose

`docker compose -f ../docker-compose.yml up -d` fails with `Bind for 127.0.0.1:6379 failed: port is already allocated`. The 100, 200, and 300 levels all publish Valkey on port 6379, so a stack from another level is still running. Stop it from that level's directory, for example `docker compose down` in `200-database-caching`, then start this one again. `docker ps` lists every running container if you are not sure which one is up.

## Docker is not running

If Docker commands fail with `Cannot connect to the Docker daemon`, start Docker Desktop (or, on Linux, the Docker Engine service), wait for it to finish starting, and retry. On Linux, a "permission denied" error instead means your user cannot reach the Docker socket; see the [platform notes](../../../README.md#platform-notes).

## I get "Connection refused" when connecting to Valkey

You see this from the `python -c "import valkey; ..."` check in Part 3, or as a warning in the terminal running Flask when you call `/invalidate`. Lookups do not log it: the app checks the connection first and, if Valkey is unreachable, shows the yellow "Valkey is not reachable" banner described below instead. Your Valkey container is either not running or it's listening on a different port. Run `docker compose -f ../docker-compose.yml ps` to check the container status. If it's not listed, start it with `docker compose -f ../docker-compose.yml up -d`. If the status shows anything other than "healthy" or "Up," check the logs with `docker compose -f ../docker-compose.yml logs valkey`.

Also confirm that nothing else is using port 6379 on your machine. On macOS or Linux, run `lsof -i :6379` to check; on Windows, `netstat -ano | findstr :6379`. If another program needs 6379, change the mapping in `docker-compose.yml` to `"127.0.0.1:6380:6379"` and set `VALKEY_PORT=6380` in your `.env`.

## I get "ModuleNotFoundError: No module named 'valkey'" (or flask, or dotenv)

You're running Python outside the virtual environment. Activate it first:

```bash
source .venv/bin/activate
```

Then confirm the packages are installed:

```bash
pip install -r requirements.txt
```

If you opened a new terminal window or tab since creating the virtual environment, you need to activate it again. Activation is per-terminal-session, not permanent.

## The page shows "Cache: DISABLED"

Caching is turned off. Check that your `.env` file exists (`cp .env.example .env` if not) and contains `CACHE_ENABLED=true`. The value is not case-sensitive, but it must be the word `true`; `yes` and `1` are not accepted. Then restart the Flask app. Flask reads environment variables at startup, and debug mode reloads the app when you save a `.py` file, not when you edit `.env`, so changing the file without restarting has no effect.

You can verify the value is loaded correctly by adding a temporary `print(CACHE_ENABLED)` after the line that sets it in `app.py`.

## The timing shows 0 ms on a cache hit. Is that real?

Yes. The app rounds the elapsed time to whole milliseconds with `round()` before displaying it, and a cache hit against Valkey running on your own machine can finish in a fraction of a millisecond, which rounds to 0. In our tests, hits showed 0 to 2 ms. Compared to the 2,500 ms data source, the difference is effectively instant.

## I changed the TTL in `.env` but old entries still expire at the old value

TTL is set at the moment a key is stored, not retroactively. Changing `CACHE_TTL_SECONDS` in your `.env` file (and restarting Flask) only affects entries written after the restart. Entries already in Valkey retain whatever TTL they were originally given. If you want a clean slate, stop the container and start it again:

```bash
docker compose -f ../docker-compose.yml down
docker compose -f ../docker-compose.yml up -d
```

## Port 5000 is already in use

On macOS, AirPlay Receiver listens on port 5000 whenever it is enabled. You can either disable AirPlay Receiver in System Settings under General, then AirDrop & Handoff, or change the Flask port. Edit the last line of `app.py`:

```python
app.run(debug=True, port=5001)
```

Then access the app at [http://localhost:5001](http://localhost:5001) instead, and use port 5001 in the `curl` command in Part 5.

## `docker compose` gives "command not found"

Older versions of Docker use `docker-compose` (with a hyphen) as a separate binary. Try:

```bash
docker-compose -f ../docker-compose.yml up -d
```

On Linux, `docker compose` (with a space) comes from the Compose plugin; see the [platform notes](../../../README.md#platform-notes). If that also fails, Docker is either not installed or not in your PATH. Follow the [Docker installation guide](https://docs.docker.com/get-docker/) for your operating system.

## I see a yellow warning banner saying "Valkey is not reachable"

Your Flask app started with `CACHE_ENABLED=true` but can't connect to Valkey on the configured host and port. It's falling back to the slow data source. Confirm your Valkey container is running (`docker compose -f ../docker-compose.yml ps`) and that `VALKEY_HOST` and `VALKEY_PORT` in your `.env` file match the container's published port (default is localhost and 6379).

If Valkey is running and the banner still appears, check that you completed `cache_layer.py` in Part 4. The starter version's `is_connected` always returns `False`, so the app reports Valkey as unreachable until you fill it in.

## Invalidating says "No cache entry found" when I expected one

The message appears when the key does not exist, which is normal if the entry already expired (30 seconds after it was stored) or was never looked up. It also appears when Valkey is down, because the delete fails; in that case the terminal running Flask shows a `Valkey connection error on invalidate` warning.

## The curl invalidate command prints HTML, and no confirmation appears in the browser

That is expected. `/invalidate` responds with a redirect to the home page, and curl prints the redirect's short HTML body instead of following it. The confirmation message is stored in curl's session, not the browser's, so it never appears on your page. To confirm the invalidation worked, search for the topic again in the browser and look for `Cache: MISS`. If you open `/invalidate` directly in the browser instead, you get `405 Method Not Allowed`, because the route accepts only POST requests; use the curl command from Part 5.

## What is the `safety/` directory?

It contains completed final versions of all the source files, as they stand at the end of Part 5. If something goes wrong and you can't figure out where your code diverged, compare your files against the ones in `safety/`. You can also copy them directly to get back on track:

```bash
cp safety/app.py app.py
cp safety/cache_layer.py cache_layer.py
cp safety/data_source.py data_source.py
cp safety/templates/index.html templates/index.html
```

On Windows PowerShell, use `Copy-Item` instead of `cp`; see the [platform notes](../../../README.md#platform-notes).
