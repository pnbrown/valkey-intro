"""
Cache Layer module - completed reference version with ValkeyCluster
and custom JSON serialization.
"""

import decimal
import json
import logging
import os
import time as _time
from datetime import datetime, date

import valkey
from valkey.cluster import ValkeyCluster, ClusterNode

logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s: %(message)s"))
    logger.addHandler(_handler)


class CacheEncoder(json.JSONEncoder):
    """Handle types that json.dumps rejects."""
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        return super().default(obj)


# Each node advertises its Docker network address (172.30.0.11-16, set in
# docker-compose.yml). Your machine can't reach those addresses, so map each
# one to the port Docker publishes for that node on localhost (7001-7006).
DOCKER_TO_HOST = {f"172.30.0.{10 + n}": 7000 + n for n in range(1, 7)}


def to_host_address(address):
    """Translate a node address the cluster advertises into one this machine can reach."""
    host, port = address
    if host in DOCKER_TO_HOST:
        return ("localhost", DOCKER_TO_HOST[host])
    return address


class CacheLayer:
    """Wraps Valkey Cluster operations with JSON serialization, graceful
    degradation, and circuit breaker."""

    def __init__(self, circuit_threshold=3, circuit_cooldown=30, ttl_seconds=300):
        self._ttl_seconds = ttl_seconds

        # Build startup nodes from environment
        nodes_str = os.environ.get("VALKEY_CLUSTER_NODES", "localhost:7001")
        startup_nodes = [
            ClusterNode(host, int(port))
            for host, port in [node.split(":") for node in nodes_str.split(",")]
        ]

        self._client = ValkeyCluster(
            startup_nodes=startup_nodes,
            decode_responses=True,
            skip_full_coverage_check=True,
            address_remap=to_host_address,
        )

        # Circuit breaker state
        self._circuit_threshold = circuit_threshold
        self._circuit_cooldown = circuit_cooldown
        self._failure_count = 0
        self._circuit_opened_at = None

    def _circuit_is_open(self):
        if self._circuit_opened_at is None:
            return False
        elapsed = _time.time() - self._circuit_opened_at
        if elapsed >= self._circuit_cooldown:
            return False
        return True

    def _record_failure(self):
        self._failure_count += 1
        if self._failure_count >= self._circuit_threshold:
            self._circuit_opened_at = _time.time()
            logger.warning("Circuit breaker opened after %d failures", self._failure_count)

    def _record_success(self):
        if self._circuit_opened_at is not None:
            logger.warning("Circuit breaker closed, Valkey recovered")
        self._failure_count = 0
        self._circuit_opened_at = None

    def get(self, key):
        """Retrieve a cached entry. Returns (data, True) on hit, (None, False) on miss."""
        if self._circuit_is_open():
            return (None, False)
        try:
            raw = self._client.get(key)
            if raw is None:
                self._record_success()
                return (None, False)
            self._record_success()
            return (json.loads(raw), True)
        except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError) as exc:
            logger.warning("Valkey connection error on get('%s'): %s", key, exc)
            self._record_failure()
            return (None, False)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Deserialization error on get('%s'): %s", key, exc)
            return (None, False)

    def set(self, key, data):
        """Store data in cache with the configured TTL using custom encoder."""
        if self._circuit_is_open():
            return
        try:
            self._client.set(key, json.dumps(data, cls=CacheEncoder), ex=self._ttl_seconds)
            self._record_success()
        except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError) as exc:
            logger.warning("Valkey connection error on set('%s'): %s", key, exc)
            self._record_failure()
        except (TypeError) as exc:
            logger.warning("Serialization error on set('%s'): %s", key, exc)

    def invalidate(self, key):
        """Remove a specific key from cache."""
        if self._circuit_is_open():
            return False
        try:
            result = self._client.delete(key) > 0
            self._record_success()
            return result
        except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError) as exc:
            logger.warning("Valkey connection error on invalidate('%s'): %s", key, exc)
            self._record_failure()
            return False

    def invalidate_pattern(self, pattern):
        """Remove all keys matching a glob pattern (scans all nodes)."""
        if self._circuit_is_open():
            return 0
        try:
            count = 0
            for key in self._client.scan_iter(match=pattern):
                self._client.delete(key)
                count += 1
            self._record_success()
            return count
        except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError) as exc:
            logger.warning("Valkey connection error on invalidate_pattern('%s'): %s", pattern, exc)
            self._record_failure()
            return 0

    def get_with_lock(self, key, lock_ttl=5, wait_time=0.1, max_retries=3):
        """
        Retrieve a cached entry with stampede prevention (carried forward from
        the 300-level). Returns (data, is_hit, is_rebuilder).

        In a cluster, the lock key (lock:genre:...) and the data key
        (genre:...) usually hash to different slots. That is fine: every
        command below names a single key, so each one routes to its own node.
        """
        if self._circuit_is_open():
            return (None, False, False)

        try:
            # Check cache first
            raw = self._client.get(key)
            if raw is not None:
                self._record_success()
                return (json.loads(raw), True, False)

            # Cache miss. Try to acquire the lock.
            lock_key = f"lock:{key}"
            acquired = self._client.set(lock_key, "1", nx=True, ex=lock_ttl)

            if acquired:
                self._record_success()
                return (None, False, True)

            # Lock not acquired. Another request is rebuilding. Wait and retry.
            for _ in range(max_retries):
                _time.sleep(wait_time)
                raw = self._client.get(key)
                if raw is not None:
                    self._record_success()
                    return (json.loads(raw), True, False)

            # Retries exhausted. Fall through to database.
            self._record_success()
            return (None, False, False)

        except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError) as exc:
            logger.warning("Valkey connection error on get_with_lock('%s'): %s", key, exc)
            self._record_failure()
            return (None, False, False)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Deserialization error on get_with_lock('%s'): %s", key, exc)
            return (None, False, False)

    def release_lock(self, key):
        """Delete the lock key after rebuilding. Best-effort, ignore errors."""
        try:
            self._client.delete(f"lock:{key}")
        except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError):
            pass

    def get_stats(self):
        """Cluster-wide cache statistics, plus one entry per primary.

        In cluster mode, INFO and DBSIZE run on a single node unless you name
        the nodes yourself, so this asks each primary separately and adds the
        numbers up. Replicas are left out: they hold copies of their primary's
        keys and do not serve this app's reads.
        """
        if self._circuit_is_open():
            return None

        nodes = []
        hits_total = misses_total = keys_total = memory_total = clients_total = 0
        for node in self._client.get_primaries():
            try:
                stats = self._client.info("stats", target_nodes=node)
                memory = self._client.info("memory", target_nodes=node)
                clients = self._client.info("clients", target_nodes=node)
                keys = self._client.dbsize(target_nodes=node)
            except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError) as exc:
                logger.warning("Valkey connection error on get_stats() for %s: %s", node.name, exc)
                nodes.append({"node": node.name, "error": str(exc)})
                continue

            hits = stats.get("keyspace_hits", 0)
            misses = stats.get("keyspace_misses", 0)
            nodes.append({
                "node": node.name,
                "total_keys": keys,
                "keyspace_hits": hits,
                "keyspace_misses": misses,
                "hit_rate": round(hits / (hits + misses), 4) if hits + misses else 0.0,
                "used_memory_human": memory.get("used_memory_human", "unknown"),
            })
            hits_total += hits
            misses_total += misses
            keys_total += keys
            memory_total += memory.get("used_memory", 0)
            clients_total += clients.get("connected_clients", 0)

        if all("error" in n for n in nodes):
            self._record_failure()
            return None

        self._record_success()
        lookups = hits_total + misses_total
        return {
            "hit_rate": round(hits_total / lookups, 4) if lookups else 0.0,
            "keyspace_hits": hits_total,
            "keyspace_misses": misses_total,
            "used_memory_human": f"{memory_total / (1024 * 1024):.2f}M",
            "connected_clients": clients_total,
            "total_keys": keys_total,
            "nodes": sorted(nodes, key=lambda n: n["node"]),
        }

    def pipeline(self):
        """Return a pipeline for batching commands (used by warm_cache).
        With ValkeyCluster this is a cluster pipeline: it splits the queued
        commands by node and sends each node the commands for its keys."""
        return self._client.pipeline()

    def primaries_status(self):
        """Ping every primary separately. Returns (reachable, total).

        A plain ping() goes to a single node, so it cannot tell you that one
        primary out of three is down. Asking each primary can.
        """
        primaries = self._client.get_primaries()
        reachable = 0
        for node in primaries:
            try:
                if self._client.ping(target_nodes=node):
                    reachable += 1
            except (valkey.ConnectionError, valkey.TimeoutError, valkey.ResponseError):
                pass
        return reachable, len(primaries)

    @property
    def ttl_seconds(self):
        return self._ttl_seconds

    @property
    def is_connected(self):
        """Check if the Valkey cluster is reachable."""
        try:
            return self._client.ping()
        except (valkey.ConnectionError, valkey.TimeoutError):
            return False
