# Troubleshooting: Protecting the Cache Layer

Commands below are written for a macOS or Linux shell. On Windows, or on a Linux system without a `python` command, see the [platform notes](../../../README.md#platform-notes) for equivalents of `lsof`, `source .venv/bin/activate`, and `cp`.

## "port is already allocated" when starting Docker Compose

**Symptom:** `docker compose up -d` fails with `Bind for 127.0.0.1:6379 failed: port is already allocated` (or the same message for port 5432).

**Cause:** The 100, 200, and 300 levels all publish Valkey on port 6379, and the 200, 300, and 400 levels all publish PostgreSQL on port 5432, so a stack from another level is still holding the port.

**Fix:** Stop the earlier stack from its own directory, for example `docker compose down` in `200-database-caching`, then run `docker compose up -d` here again. `docker ps` lists every running container if you are not sure which level is still up.

## Docker is not running

**Symptom:** `docker compose up -d` fails with `Cannot connect to the Docker daemon`.

**Fix:** Start Docker Desktop (or, on Linux, the Docker Engine service) and wait for it to finish starting, then retry. On Linux, a "permission denied" error instead means your user cannot reach the Docker socket; see the [platform notes](../../../README.md#platform-notes).

## Valkey is not running

**Symptom:** Connection refused errors when starting the app, or `docker compose exec valkey valkey-cli PING` fails.

**Fix:** Ensure Docker Compose is running from the `300-protecting-cache` directory:
```bash
docker compose up -d
docker compose ps
```
Both `valkey` and `postgres` should show "healthy."

## "Database seeded successfully" but no data appears in the app

**Symptom:** The genre list is empty or book pages show "not found."

**Cause:** The app is connecting to a different database than the one you seeded, or the `.env` file is missing.

**Fix:** Verify `.env` exists in the `python/` directory and that `DATABASE_URL` matches your Docker Compose configuration (`postgresql://workshop:workshop@localhost:5432/bookstore`). Re-run `python seed_db.py` if needed.

## Cache warming logs "not implemented yet"

**Symptom:** App starts but `INFO:warm_cache: Cache warming not implemented yet.` appears in the console.

**Cause:** You added the `warm_cache(cache)` call to `app.py` but have not yet implemented the `warm_cache()` function in `warm_cache.py`. (Before you add that call, the starter app never runs warming, so this line does not appear at all.)

**Fix:** Follow Part 1 in the README and paste in the implementation.

## Lock keys stay behind after a page load (stampede prevention)

**Symptom:** `docker compose exec valkey valkey-cli KEYS "lock:*"` still lists a key such as `lock:genre:fantasy` after the page has loaded.

**Cause:** The rebuild did not release its lock. The completed route releases it in a `finally` block, so this happens when your `genre_listing` route calls `cache.release_lock()` only after a successful query: if the query raises an error, the release is skipped.

**Fix:** Check the lock's remaining lifetime with `docker compose exec valkey valkey-cli TTL lock:genre:fantasy`. It should be 5 seconds or less, and the key disappears on its own when it reaches zero. Then compare your route with the version in Part 2 of the README, which wraps the query and `cache.set()` in `try` and calls `cache.release_lock()` in `finally`.

## Circuit breaker opens after only two or three page loads

**Symptom:** "Circuit breaker opened after 3 failures" appears after only two or three page loads.

**Cause:** Every failed cache call counts toward the threshold of 3, and pages make more than one. With Valkey unreachable, the home page and book pages each make two failing calls (a `get` and then a `set`), and a genre page makes one (`get_with_lock`). Loading the home page and then any other page is enough to reach three.

**Fix:** If Valkey is actually running, check the connection settings in `.env` (`VALKEY_HOST` and `VALKEY_PORT`). If you intentionally stopped Valkey for the Part 3 exercise, this is expected behavior.

## Circuit breaker never closes after restarting Valkey

**Symptom:** After `docker compose start valkey`, the circuit stays open and the app keeps skipping cache.

**Cause:** The cooldown period (default 30 seconds) has not elapsed since the circuit opened. The circuit only probes when a request arrives after the cooldown.

**Fix:** Wait 30 seconds, then make a request. Check the app logs for "Circuit breaker closed, Valkey recovered." If it does not appear, verify Valkey is actually accepting connections: `docker compose exec valkey valkey-cli PING`.

## `INFO stats` shows 0 hits and 0 misses

**Symptom:** The `/stats` endpoint returns `hit_rate: 0.0` even after browsing pages.

**Cause:** Valkey was restarted after the browsing, for example by the `docker compose stop valkey` and `docker compose start valkey` steps in Part 3, which resets the server-side counters. `keyspace_hits` and `keyspace_misses` are cumulative since the server started or since someone ran `CONFIG RESETSTAT`. `FLUSHALL` deletes keys but does not reset these counters.

**Fix:** Browse a few pages, then check `/stats` without restarting Valkey in between. If `/stats` returns `{"error": "Not implemented yet"}` instead, you have not completed Part 4 yet.

## `docker compose exec valkey valkey-cli MONITOR` shows nothing

**Symptom:** MONITOR runs but no commands appear.

**Cause:** No requests are hitting Valkey. Either the app is not running, or the circuit breaker is open (skipping all cache operations).

**Fix:** Start the app with `python app.py` and load a page in the browser while MONITOR is running. If the circuit is open, wait for cooldown or restart both Valkey and the app.

## Port 5000 already in use

**Symptom:** The app exits at startup with an "Address already in use" error for port 5000.

**Cause:** Another process (or a previous instance of the app) is using port 5000. On macOS, AirPlay Receiver listens on this port whenever it is enabled.

**Fix:** Stop the existing process (`lsof -i :5000` to find it, then `kill <PID>`), or on macOS turn off AirPlay Receiver in System Settings under General, then AirDrop & Handoff. Keep the app on port 5000 if you can: `load_test.py` sends its requests to `http://localhost:5000`, so moving the app means changing `BASE_URL` at the top of `load_test.py` too.

## load_test.py says "Cannot connect to the app"

**Symptom:** `python load_test.py` prints `ERROR: Cannot connect to the app. Is Flask running on port 5000?`

**Fix:** Start the app with `python app.py` in another terminal and leave it running while the load test runs. If you moved the app to another port, update `BASE_URL` at the top of `load_test.py` to match.

## psycopg connection error on seed_db.py

**Symptom:** `python seed_db.py` prints `ERROR: Could not connect to the database. Is PostgreSQL running?` followed by the driver's error, which includes `connection to server at "localhost"` and `port 5432 failed`.

**Cause:** PostgreSQL is not yet accepting connections. Docker health checks pass when `pg_isready` succeeds, but there can be a brief window between container start and readiness.

**Fix:** Wait a few seconds and retry. Check `docker compose ps` to confirm postgres is healthy.
