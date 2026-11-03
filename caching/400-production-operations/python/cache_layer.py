"""
Cache Layer module for the 400-level workshop.

Starts as a single-node client (carried from 300-level).
You will replace it with a cluster-aware client in Part A2
and add custom serialization in Part A4.
"""

import json
import logging
import os
import time as _time

import valkey

logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s: %(message)s"))
    logger.addHandler(_handler)


class CacheLayer:
    """Wraps Valkey operations with JSON serialization, graceful degradation,
    and circuit breaker. See Part A2 in the README for the cluster version."""

    def __init__(self, circuit_threshold=3, circuit_cooldown=30, ttl_seconds=300):
        self._ttl_seconds = ttl_seconds

        # Part A2: Replace this single-node client with ValkeyCluster.
        # See the README for the implementation.
        host = os.environ.get("VALKEY_HOST", "localhost")
        port = int(os.environ.get("VALKEY_PORT", "7001"))
        self._client = valkey.Valkey(host=host, port=port, decode_responses=True)

        # Circuit breaker state (carried from 300-level)
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
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on get('%s'): %s", key, exc)
            self._record_failure()
            return (None, False)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Deserialization error on get('%s'): %s", key, exc)
            return (None, False)

    def set(self, key, data):
        """Store data in cache with the configured TTL.
        See Part A4 in the README for custom serialization."""
        if self._circuit_is_open():
            return
        try:
            self._client.set(key, json.dumps(data), ex=self._ttl_seconds)
            self._record_success()
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
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
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on invalidate('%s'): %s", key, exc)
            self._record_failure()
            return False

    def invalidate_pattern(self, pattern):
        """Remove all keys matching a glob pattern."""
        if self._circuit_is_open():
            return 0
        try:
            count = 0
            for key in self._client.scan_iter(match=pattern):
                self._client.delete(key)
                count += 1
            self._record_success()
            return count
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on invalidate_pattern('%s'): %s", pattern, exc)
            self._record_failure()
            return 0

    def get_stats(self):
        """Retrieve cache statistics. See Part 4 of the 300-level for implementation."""
        if self._circuit_is_open():
            return None
        try:
            stats = self._client.info("stats")
            memory = self._client.info("memory")
            clients = self._client.info("clients")
            total_keys = self._client.dbsize()
            hits = stats.get("keyspace_hits", 0)
            misses = stats.get("keyspace_misses", 0)
            total = hits + misses
            hit_rate = hits / total if total > 0 else 0.0
            self._record_success()
            return {
                "hit_rate": round(hit_rate, 4),
                "keyspace_hits": hits,
                "keyspace_misses": misses,
                "used_memory_human": memory.get("used_memory_human", "unknown"),
                "connected_clients": clients.get("connected_clients", 0),
                "total_keys": total_keys,
            }
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on get_stats(): %s", exc)
            self._record_failure()
            return None

    @property
    def ttl_seconds(self):
        return self._ttl_seconds

    @property
    def is_connected(self):
        """Check if the Valkey connection is healthy."""
        try:
            return self._client.ping()
        except (valkey.ConnectionError, valkey.TimeoutError):
            return False
