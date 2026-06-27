# Troubleshooting: Multi-Key Strategies and Cache Stampedes

## Valkey is not running

**Symptom:** Connection refused errors when starting the app or running `valkey-cli`.

**Fix:** Ensure Docker Compose is running from the `300-multi-key-strategies` directory:
```bash
docker compose up -d
docker compose ps
```
Both `valkey` and `postgres` should show "healthy."

## "Database seeded successfully" but no data appears in the app

**Symptom:** The genre list is empty or book pages show "not found."

**Cause:** The app might be connecting to a different database than the one you seeded, or the `.env` file is missing.

**Fix:** Verify `.env` exists in the `python/` directory and that `DATABASE_URL` matches your Docker Compose configuration (`postgresql://workshop:workshop@localhost:5432/bookstore`). Re-run `python seed_db.py` if needed.

## Cache warming logs "not implemented yet"

**Symptom:** App starts but `INFO:warm_cache: Cache warming not implemented yet.` appears in the console.

**Cause:** You have not yet implemented the `warm_cache()` function in `warm_cache.py`.

**Fix:** Follow Part 1 in the README and paste in the implementation.

## Lock key never disappears (stampede prevention)

**Symptom:** `valkey-cli KEYS "lock:*"` shows lock keys that persist longer than 5 seconds.

**Cause:** The rebuilder crashed or returned without calling `cache.release_lock()`. The lock has a 5-second TTL safety net but if the app throws an unhandled exception between acquiring the lock and releasing it, the lock persists until TTL expires.

**Fix:** This is actually working as designed. The 5-second EX on the lock is the safety net. If you see locks persisting beyond 5 seconds, check that your Valkey time is correct: `docker compose exec valkey valkey-cli TIME`.

## Circuit breaker opens immediately on first request

**Symptom:** "Circuit breaker opened after 3 failures" appears after only one page load.

**Cause:** Each page load triggers multiple cache operations (the home route, the genre route). If Valkey is unreachable, three operations can fail in rapid succession during a single request flow.

**Fix:** If Valkey is actually running, check the connection settings in `.env` (`VALKEY_HOST` and `VALKEY_PORT`). If you intentionally stopped Valkey for the Part 3 exercise, this is expected behavior.

## Circuit breaker never closes after restarting Valkey

**Symptom:** After `docker compose start valkey`, the circuit stays open and the app keeps skipping cache.

**Cause:** The cooldown period (default 30 seconds) has not elapsed since the circuit opened. The circuit only probes when a request arrives after the cooldown.

**Fix:** Wait 30 seconds, then make a request. Check the app logs for "Circuit breaker closed, Valkey recovered." If it does not appear, verify Valkey is actually accepting connections: `docker compose exec valkey valkey-cli PING`.

## `INFO stats` shows 0 hits and 0 misses

**Symptom:** The `/stats` endpoint returns `hit_rate: 0.0` even after browsing pages.

**Cause:** Valkey was restarted (or `FLUSHALL` was run) after the browsing, resetting the server-side counters. The `keyspace_hits` and `keyspace_misses` counters are cumulative since the last server restart.

**Fix:** Browse a few pages, then check `/stats` without restarting Valkey in between.

## `docker compose exec valkey valkey-cli MONITOR` shows nothing

**Symptom:** MONITOR runs but no commands appear.

**Cause:** No requests are hitting Valkey. Either the app is not running, or the circuit breaker is open (skipping all cache operations).

**Fix:** Start the app with `python app.py` and load a page in the browser while MONITOR is running. If the circuit is open, wait for cooldown or restart both Valkey and the app.

## Port 5000 already in use

**Symptom:** `OSError: [Errno 48] Address already in use` when starting the app.

**Cause:** Another process (or a previous instance of the app) is using port 5000. On macOS, AirPlay Receiver sometimes claims this port.

**Fix:** Stop the existing process (`lsof -i :5000` to find it, then `kill <PID>`). Or start the app on a different port: `flask run --port 5001`.

## psycopg connection error on seed_db.py

**Symptom:** `psycopg.OperationalError: connection to server at "localhost" port 5432 failed`

**Cause:** PostgreSQL is not yet accepting connections. Docker health checks pass when `pg_isready` succeeds, but there can be a brief window between container start and readiness.

**Fix:** Wait a few seconds and retry. Check `docker compose ps` to confirm postgres is healthy.
