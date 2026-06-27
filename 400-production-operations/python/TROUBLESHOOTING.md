# Troubleshooting: Production Operations with Valkey Cluster

## Cluster will not form (cluster-init keeps failing)

**Symptom:** `docker compose logs cluster-init` shows connection refused or timeout errors.

**Cause:** The Valkey nodes have not finished starting when cluster-init runs. The `depends_on: condition: service_healthy` should prevent this, but Docker health checks have polling intervals.

**Fix:** Wait 10-15 seconds after `docker compose up -d` and run `docker compose restart cluster-init`. Check again with `docker compose logs cluster-init`.

## "All 16384 slots covered" but cluster_state is not ok

**Symptom:** `valkey-cli cluster info` shows `cluster_state:ok` but individual nodes show `cluster_state:fail`.

**Cause:** You are likely querying a node that has lost contact with the rest of the cluster (network partition in Docker).

**Fix:** Run `docker compose down -v && docker compose up -d` to start fresh. The volumes store cluster config; removing them forces a clean cluster creation.

## MOVED errors in the application logs

**Symptom:** Warnings like "Valkey connection error on get('genre:fantasy'): MOVED 12345 172.30.0.12:6379"

**Cause:** The application is using the single-node `Valkey()` client instead of `ValkeyCluster`. The single-node client does not follow MOVED redirects.

**Fix:** Complete Part A2 in the README. Replace the client initialization with `ValkeyCluster`.

## CrossSlotError when running cache warming with pipeline

**Symptom:** `valkey.exceptions.CrossSlotError: Keys in request don't hash to the same slot`

**Cause:** The 300-level cache warming used a pipeline to SET multiple keys in one round-trip. In cluster mode, a pipeline can only contain keys that hash to the same slot.

**Fix:** Replace the pipeline with individual `cache.set()` calls as described in Part A2's hash tags section. Each SET routes to the correct node independently.

## psycopg_pool import error

**Symptom:** `ModuleNotFoundError: No module named 'psycopg_pool'`

**Cause:** The `psycopg_pool` package is separate from `psycopg`. It needs to be installed explicitly.

**Fix:** Run `pip install -r requirements.txt` again. The requirements file includes `psycopg_pool>=3.2`.

## ConnectionPool fails to open at startup

**Symptom:** `psycopg.OperationalError: connection to server at "localhost" port 5432 failed`

**Cause:** PostgreSQL is not running or not yet accepting connections when the app starts.

**Fix:** Verify PostgreSQL is healthy: `docker compose ps`. If it shows "starting," wait and try again. You can also check directly: `docker compose exec postgres pg_isready -U workshop`.

## "Connection refused" when connecting to Valkey on port 7001

**Symptom:** The app cannot connect to `localhost:7001`.

**Cause:** The Docker port mapping exposes Valkey nodes on ports 7001-7006. If Docker Compose has not finished starting, or if ports conflict with another process, the connection fails.

**Fix:** Check `docker compose ps` for healthy status on all valkey nodes. Check for port conflicts: `lsof -i :7001`.

## Eviction not happening despite filling memory

**Symptom:** `debug populate` runs but `evicted_keys` stays at 0.

**Cause:** The `maxmemory` setting is not applied, or you are checking a different node than the one you populated.

**Fix:** Verify the config: `docker compose exec valkey-1 valkey-cli config get maxmemory`. It should show `16777216` (16 MB). Run `debug populate` and `info memory` on the same node.

## Node failover takes longer than expected

**Symptom:** After `docker compose stop valkey-1`, the cluster takes 15-20 seconds to promote a replica.

**Cause:** `cluster-node-timeout` is set to 5000ms, but the actual failover involves detection (timeout period), voting (another round of communication), and promotion. Total time is typically 1.5-2x the timeout value.

**Fix:** This is expected behavior. The cluster prioritizes consistency (ensuring only one primary per slot range) over speed. In production, a 10-second failover window is normal and acceptable for a caching layer.

## Docker Desktop running out of memory

**Symptom:** Containers crash or become unresponsive. `docker compose ps` shows "Exited" or "Restarting."

**Cause:** 9 containers (6 Valkey, 1 init, 1 PostgreSQL, plus your app) require meaningful RAM allocation in Docker Desktop.

**Fix:** Open Docker Desktop settings and allocate at least 4 GB of memory. On macOS, this is under Settings > Resources > Memory.

## App returns 503 on /health after stopping a Valkey node

**Symptom:** `/health` returns `{"valkey": "error: ping failed", "postgres": "ok"}` with status 503.

**Cause:** The `ValkeyCluster` client's `ping()` failed because the cluster is mid-failover. During the 5-10 second failover window, the client cannot reach the downed node's slots.

**Fix:** Wait for failover to complete (10-15 seconds), then check `/health` again. It should return 200 once the promoted replica begins serving. If you need the health check to tolerate brief failover windows, consider only failing after multiple consecutive probe failures.
