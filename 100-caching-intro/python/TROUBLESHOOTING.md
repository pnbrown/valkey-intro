# Troubleshooting

Common issues we've seen during the workshop and how to resolve them.

## I get "Connection refused" when the app tries to reach Valkey

Your Valkey container is either not running or it's listening on a different port. Run `docker compose -f ../docker-compose.yml ps` to check the container status. If it's not listed, start it with `docker compose -f ../docker-compose.yml up -d`. If the status shows anything other than "healthy" or "Up," check the logs with `docker compose -f ../docker-compose.yml logs valkey`.

Also confirm that nothing else is using port 6379 on your machine. On macOS or Linux, run `lsof -i :6379` to check.

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

## The cache shows MISS every time even though Valkey is running

Check that your `.env` file contains `CACHE_ENABLED=true` (not `True`, not `yes`, not `1`; we check for the exact lowercase string `"true"` in the code). Then restart the Flask app. Flask reads environment variables at startup, so changing the file without restarting has no effect.

You can verify the value is loaded correctly by adding a temporary `print(CACHE_ENABLED)` after the line that sets it in `app.py`.

## The timing shows 0 ms on a cache hit. Is that real?

Yes, for the purposes of this workshop. Valkey responds in sub-millisecond time for simple GET operations, and `time.perf_counter()` rounds to the nearest millisecond in our display. Actual time is a fraction of a millisecond. Compared to the 2,500 ms data source, the difference is effectively instant.

## I changed the TTL in `.env` but old entries still expire at the old value

TTL is set at the moment a key is stored, not retroactively. Changing `CACHE_TTL_SECONDS` in your `.env` file (and restarting Flask) only affects entries written after the restart. Entries already in Valkey retain whatever TTL they were originally given. If you want a clean slate, stop the container and start it again:

```bash
docker compose -f ../docker-compose.yml down
docker compose -f ../docker-compose.yml up -d
```

## Port 5000 is already in use

On macOS, AirPlay Receiver sometimes binds to port 5000. You can either disable AirPlay Receiver in System Settings under General, then AirDrop & Handoff, or change the Flask port. Edit the last line of `app.py`:

```python
app.run(debug=True, port=5001)
```

Then access the app at [http://localhost:5001](http://localhost:5001) instead.

## `docker compose` gives "command not found"

Older versions of Docker use `docker-compose` (with a hyphen) as a separate binary. Try:

```bash
docker-compose up -d
```

If that also fails, Docker is either not installed or not in your PATH. Follow the [Docker installation guide](https://docs.docker.com/get-docker/) for your operating system.

## I see a yellow warning banner saying "Valkey is not reachable"

Your Flask app started with `CACHE_ENABLED=true` but can't connect to Valkey on the configured host and port. It's falling back to the slow data source. Confirm your Valkey container is running (`docker compose -f ../docker-compose.yml ps`) and that `VALKEY_HOST` and `VALKEY_PORT` in your `.env` file match the container's published port (default is localhost and 6379).

## What is the `safety/` directory?

It contains completed versions of all the source files at each stage of the workshop. If something goes wrong and you can't figure out where your code diverged, compare your files against the ones in `safety/`. You can also copy them directly to get back on track:

```bash
cp safety/app.py app.py
cp safety/cache_layer.py cache_layer.py
cp safety/data_source.py data_source.py
cp -r safety/templates/ templates/
```
