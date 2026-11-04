# Troubleshooting: Production Operations with Valkey Cluster

Commands below are written for a macOS or Linux shell. On Windows, or on a Linux system without a `python` command, see the [platform notes](../../../README.md#platform-notes) for equivalents of `lsof`, `grep`-style filtering, `source .venv/bin/activate`, and `cp`.

## "port is already allocated" when starting Docker Compose

**Symptom:** `docker compose up -d` fails with `Bind for 127.0.0.1:5432 failed: port is already allocated`, or the same message for one of ports 7001 to 7006.

**Cause:** The 200, 300, and 400 levels all publish PostgreSQL on port 5432, so a stack from an earlier level is still running. A conflict on 7001 to 7006 means another program on your machine is using that port.

**Fix:** Stop the earlier stack from its own directory, for example `docker compose down` in `300-protecting-cache`, then run `docker compose up -d` here again. `docker ps` lists every running container if you are not sure which level is still up. For ports 7001 to 7006, `lsof -i :7001` shows which program holds the port.

## Docker is not running

**Symptom:** `docker compose up -d` fails with `Cannot connect to the Docker daemon`.

**Fix:** Start Docker Desktop (or, on Linux, the Docker Engine service) and wait for it to finish starting, then retry. On Linux, a "permission denied" error instead means your user cannot reach the Docker socket; see the [platform notes](../../../README.md#platform-notes).

## Port 5000 already in use

**Symptom:** The app exits at startup with an "Address already in use" error for port 5000.

**Cause:** Another process (or an earlier instance of the app) is using port 5000. On macOS, AirPlay Receiver listens on this port whenever it is enabled.

**Fix:** Stop the other process (`lsof -i :5000` to find it), or on macOS turn off AirPlay Receiver in System Settings under General, then AirDrop & Handoff. Keep the app on port 5000 if you can: `load_test.py` sends its requests to `http://localhost:5000`, so moving the app means changing `BASE_URL` at the top of `load_test.py` too.

## Cluster will not form (cluster-init keeps failing)

**Symptom:** `docker compose logs cluster-init` shows connection refused or timeout errors.

**Cause:** The Valkey nodes have not finished starting when cluster-init runs. The `depends_on: condition: service_healthy` should prevent this, but Docker health checks have polling intervals.

**Fix:** Wait 10-15 seconds after `docker compose up -d` and run `docker compose restart cluster-init`. Check again with `docker compose logs cluster-init`.

## cluster-init logs show "not found" errors

**Symptom:** `docker compose logs cluster-init` shows lines such as `sh: 11: --cluster-replicas: not found` or `sh: 5: 172.30.0.11:6379: not found`, and `valkey-cli cluster info` reports `cluster_state:fail` with `cluster_known_nodes:1`.

**Cause:** The shell received the `valkey-cli --cluster create` command broken across several lines, so it ran `valkey-cli` with no node list and then tried to run each node address as a command of its own. This happens when the `cluster-init` command in `docker-compose.yml` is written as a folded string (`command: >` with `sh -c "..."`). Docker Compose keeps the line breaks on the indented lines and removes the backslashes that would have joined them.

**Fix:** Keep the command in list form with a literal block, as the workshop's `docker-compose.yml` ships it (`command:`, then `- sh`, `- -c`, `- |`). Docker Compose passes a literal block to the shell unchanged, so the backslash line continuations work. If you edited the file (for example, to try the add-node commands from the Part B4 demonstration), compare your version with that structure, then run `docker compose down && docker compose up -d`.

## "All 16384 slots covered" but cluster_state is not ok

**Symptom:** `docker compose logs cluster-init` reports `All 16384 slots covered`, but `docker compose exec valkey-1 valkey-cli cluster info` shows `cluster_state:fail`.

**Cause:** The most common cause is timing. Right after `cluster-init` finishes, the nodes are still exchanging the new configuration, and `cluster_state` can read `fail` for a few seconds before it turns `ok`. If it stays `fail`, one node has lost contact with the others; run the same command against `valkey-2` through `valkey-6` to find it.

**Fix:** Wait about 10 seconds and check again. If the state does not change, run `docker compose down && docker compose up -d` to start fresh. Each node keeps its cluster configuration in a `nodes.conf` file inside its own container, so removing the containers forces a clean cluster creation. Adding `-v` also deletes the PostgreSQL volume; if you do that, run `python seed_db.py` again.

## App cannot connect to the cluster: "Timeout connecting to server"

**Symptom:** The app logs `Valkey Cluster unavailable at startup, serving from PostgreSQL only`, `/health` returns 200 with `"valkey": "degraded: not connected at startup (...)"`, and the message inside the parentheses reads `Valkey Cluster cannot be connected. Please provide at least one reachable node: Timeout connecting to server`. The cluster itself is healthy: `docker compose exec valkey-1 valkey-cli cluster info` shows `cluster_state:ok`.

**Cause:** The client reached the seed node on `localhost:7001`, asked for the cluster topology, and got back each node's Docker network address (`172.30.0.11` through `172.30.0.16`). Docker Desktop does not route traffic from your machine into its bridge networks, so every connection to those addresses times out.

**Fix:** Pass `address_remap=to_host_address` to `ValkeyCluster` and add the `to_host_address` function to `cache_layer.py`, as shown in "Advertised addresses versus reachable addresses" in Part A2 of the README. Saving `cache_layer.py` makes Flask's debug mode restart the app automatically; if the app was not running, start it with `python app.py`. The app connects to the cluster once, at startup, so the new code takes effect on that restart.

## "DEBUG command not allowed" when filling memory

**Symptom:** `docker compose exec valkey-1 valkey-cli debug populate 100000 dummy 1024` returns `ERR DEBUG command not allowed. If the enable-debug-command option is set to "local", you can run it from a local connection...`

**Cause:** Valkey disables `DEBUG` by default (`enable-debug-command no`). The workshop's `docker-compose.yml` sets `--enable-debug-command local` on every node, which allows `DEBUG` only from connections made inside the container. Without that flag, or from a client on your machine connecting through port 7001, the command is refused.

**Fix:** Run the command through `docker compose exec`, exactly as written in Part B2, so `valkey-cli` connects from inside the container. If you see the error that way too, check that `--enable-debug-command local` is still in the shared node command at the top of `docker-compose.yml`, then run `docker compose down && docker compose up -d`.

## MOVED errors in the application logs

**Symptom:** Warnings like `Valkey connection error on get('genres'): MOVED 6681 172.30.0.12:6379`, and a startup line like `Cache warming failed after 87 ms: Command # 1 (SET genres [...] EX 300) of pipeline caused error: MOVED 6681 172.30.0.12:6379`. If three of those failures happen in a row, `Circuit breaker opened after 3 failures` follows. Pages still load.

**Cause:** The application is using the single-node `Valkey()` client instead of `ValkeyCluster`. The single-node client does not follow MOVED redirects, so every key owned by another node fails, while keys that happen to live on `valkey-1` work. `CacheLayer` treats each failure like a connection error and falls back to PostgreSQL. Whether the circuit breaker opens depends on the order of your clicks, because each success on a `valkey-1` key resets the failure count. All of this is expected in Setup step 5, before Part A2.

**Fix:** Complete Part A2 in the README. Replace the client initialization with `ValkeyCluster`. Saving `cache_layer.py` restarts the app in debug mode, which also resets the circuit breaker.

## "all keys must map to the same key slot" or CROSSSLOT errors

**Symptom:** `valkey.exceptions.ValkeyClusterException: MSET - all keys must map to the same key slot` from the app, or `CROSSSLOT Keys in request don't hash to the same slot` from `valkey-cli`.

**Cause:** A single command named several keys that hash to different slots. Multi-key commands such as `MSET` and `MGET` only work when every key lands on the same slot. Two things are not affected: pipelines, because `ValkeyCluster` splits a pipeline by node, and `DEL` with several keys, which valkey-py splits by slot for you.

**Fix:** Send one command per key (or a pipeline of single-key commands), or give related keys a shared hash tag such as `genre:{computing}:books` and `genre:{computing}:count`, as described in Part A2's hash tags section.

## seed_db.py or the app reports that DATABASE_URL is not set

**Symptom:** `python seed_db.py` prints `ERROR: DATABASE_URL is not set. Copy .env.example to .env and check the value.`, or the app fails with `KeyError: 'DATABASE_URL'`.

**Fix:** Run `cp .env.example .env` in the `python/` directory. The example file already has the right value: `postgresql://workshop:workshop@localhost:5432/bookstore`.

## psycopg_pool import error

**Symptom:** `ModuleNotFoundError: No module named 'psycopg_pool'`

**Cause:** The `psycopg_pool` package is separate from `psycopg`. It needs to be installed explicitly.

**Fix:** Run `pip install -r requirements.txt` again. The requirements file pins `psycopg-pool==3.2.8`, which provides the `psycopg_pool` module.

## The app takes a minute to start, or pages fail with "couldn't get a connection"

**Symptom:** After Part A1, `python app.py` takes far longer than usual to start serving, the log shows `Cache warming failed after 30005 ms: couldn't get a connection after 30.00 sec`, and pages that need the database fail after about 30 seconds. Before Part A1, there is no pool to wait on, so the same problem fails fast instead: warming logs `Cache warming failed`, and pages fail with `psycopg.OperationalError: connection to server at "localhost" ... port 5432 failed`.

**Cause:** PostgreSQL is not running or not yet accepting connections. The connection pool does not crash the app when it cannot connect; anything that needs a connection waits up to 30 seconds for one and then gives up. Cache warming is the first thing that needs one, so startup stalls first. In debug mode the app is loaded twice (once by Flask's reloader), so expect the stall twice.

**Fix:** Verify PostgreSQL is healthy: `docker compose ps`. If it shows "starting," wait and try again. You can also check directly: `docker compose exec postgres pg_isready -U workshop`. Once it is healthy, restart the app.

## Pages fail for a moment after PostgreSQL restarts

**Symptom:** After `docker compose restart postgres` (or stopping and starting it), the first one or two page loads return an Internal Server Error, then everything works again.

**Cause:** The connection pool keeps `DB_POOL_MIN_SIZE` connections (2 by default) open between requests. A PostgreSQL restart closes them on the server side, and the pool hands each stale connection to one request before it notices and replaces it.

**Fix:** Reload the page. To make the pool test each connection before handing it out, pass `check=ConnectionPool.check_connection` to `ConnectionPool(...)` in `db.py`; the [psycopg pool documentation](https://www.psycopg.org/psycopg3/docs/advanced/pool.html) describes this option and its cost.

## "Connection refused" when connecting to Valkey on port 7001

**Symptom:** The app logs `Valkey Cluster unavailable at startup, serving from PostgreSQL only`, and `/health` returns 200 with `"valkey": "degraded: not connected at startup (...)"` and `Connection refused` inside the parentheses. Pages load, but every page shows `Cache: DISABLED`.

**Cause:** The cluster was not running, or had not finished forming, when the app started. The app connects to the cluster once, at startup. If that fails, it keeps serving from PostgreSQL and does not retry, so the cache stays off even after the cluster comes up.

**Fix:** Check that every node is healthy with `docker compose ps` and that `docker compose exec valkey-1 valkey-cli cluster info` shows `cluster_state:ok`. Then restart the app (press Ctrl+C and run `python app.py` again).

## Eviction not happening despite filling memory

**Symptom:** `debug populate` runs but `evicted_keys` stays at 0.

**Cause:** One of four things:
- You are reading `info memory`, which does not include `evicted_keys`. The counter is in `info stats`.
- You are checking a different node than the one you populated.
- The node you populated is a replica. Replicas ignore `maxmemory` by default (`replica-ignore-maxmemory yes`); a key disappears from a replica only when its primary evicts the key and replicates the deletion. After the failover exercise in Part B3, `valkey-1` stays a replica until it is promoted again.
- The `maxmemory` setting is not applied.

**Fix:** Check the role first: `docker compose exec valkey-1 valkey-cli role`. A primary prints `master` on the first line and a replica prints `slave` (legacy terms in the command output; see the terminology note in Part B1 of the README). If `valkey-1` is a replica, make it the primary again with `docker compose exec valkey-1 valkey-cli cluster failover`, or start fresh with `docker compose down && docker compose up -d`. Then verify the config: `docker compose exec valkey-1 valkey-cli config get maxmemory` should show `16777216` (16 MB). Run `debug populate` and `info stats | grep evicted_keys` on the same node, and run the `info` command twice, because Valkey evicts while it processes later commands.

## Node failover takes longer than expected

**Symptom:** After `docker compose stop valkey-1`, `docker compose exec valkey-2 valkey-cli cluster nodes` still shows no new primary after a few seconds.

**Cause:** Failover cannot start until the other nodes have gone `cluster-node-timeout` (5000 ms) without hearing from `valkey-1`. After that, its replica waits a short, partly random delay (500 to 1000 ms) and asks the remaining primaries for votes. In a test on this workshop's cluster, the replica was promoted about 7 seconds after the stop.

**Fix:** Wait 10 seconds and check again; that is expected behavior, and it matches the 5 to 10 seconds Part B3 suggests. The cluster prioritizes consistency (ensuring only one primary per slot range) over speed. If no replica is promoted after 20 seconds, check that `cluster info` on `valkey-2` reports `cluster_state:ok` and that `cluster nodes` shows `valkey-1`'s replica as connected.

## Docker Desktop running out of memory

**Symptom:** Containers crash or become unresponsive. `docker compose ps` shows "Exited" or "Restarting."

**Cause:** 8 containers (6 Valkey nodes, 1 cluster initializer, 1 PostgreSQL) require meaningful RAM allocation in Docker Desktop.

**Fix:** On macOS, open Docker Desktop and allocate at least 4 GB of memory under Settings > Resources > Memory. On Windows with the WSL 2 engine, Docker Desktop's memory is allocated dynamically by WSL (see Docker's [WSL 2 guide](https://docs.docker.com/desktop/features/wsl/)), so close other memory-heavy programs instead. On Linux, Docker Engine uses the host's memory directly.

## /health shows "degraded" or returns 503

**Symptom:** `/health` returns `"valkey": "degraded: ..."`, or it returns status 503.

**Cause:** A 503 always means PostgreSQL is unreachable; the `"postgres"` entry contains the error. `"degraded"` means the cache has a problem but the app is still serving every page from PostgreSQL, so the status stays 200. `degraded: 1 of 3 primaries unreachable` is expected while you have a node stopped in Part B3, and `degraded: not connected at startup (...)` means the cluster was unavailable when the app started.

**Fix:** For a 503, check PostgreSQL with `docker compose ps` and `docker compose exec postgres pg_isready -U workshop`. For `primaries unreachable`, start the stopped node again or wait for failover to finish, then reload `/health`. For `not connected at startup`, restart the app once `docker compose exec valkey-1 valkey-cli cluster info` shows `cluster_state:ok`.
