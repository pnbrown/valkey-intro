"""
Cache Layer module for the 300-level workshop.
(Completed reference version)
"""

import json
import logging
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
    stampede prevention, and circuit breaker."""

    def __init__(self, host="localhost", port=6379, ttl_seconds=300,
                 circuit_threshold=3, circuit_cooldown=30):
        self._ttl_seconds = ttl_seconds
        self._client = valkey.Valkey(host=host, port=port, decode_responses=True)

        # Circuit breaker state
        self._circuit_threshold = circuit_threshold
        self._circuit_cooldown = circuit_cooldown
        self._failure_count = 0
        self._circuit_opened_at = None

    # ------------------------------------------------------------------
    # Circuit breaker helpers
    # ------------------------------------------------------------------

    def _circuit_is_open(self):
        """Check if the circuit breaker is open."""
        if self._circuit_opened_at is None:
            return False
        elapsed = _time.time() - self._circuit_opened_at
        if elapsed >= self._circuit_cooldown:
            # Half-open: allow one probe
            return False
        return True

    def _record_failure(self):
        """Record a connection failure. Open the circuit if threshold is reached."""
        self._failure_count += 1
        if self._failure_count >= self._circuit_threshold:
            self._circuit_opened_at = _time.time()
            logger.warning(
                "Circuit breaker opened after %d failures", self._failure_count
            )

    def _record_success(self):
        """Record a successful operation. Close the circuit if it was open."""
        if self._circuit_opened_at is not None:
            logger.warning("Circuit breaker closed, Valkey recovered")
        self._failure_count = 0
        self._circuit_opened_at = None

    # ------------------------------------------------------------------
    # Core cache operations
    # ------------------------------------------------------------------

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
        """Store data in cache with the configured TTL."""
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
        """Remove a specific key from cache. Returns True if the key existed."""
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
        """Remove all keys matching a glob pattern. Returns count of deleted keys."""
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

    # ------------------------------------------------------------------
    # Stampede prevention
    # ------------------------------------------------------------------

    def get_with_lock(self, key, lock_ttl=5, wait_time=0.1, max_retries=3):
        """
        Retrieve a cached entry with stampede prevention.

        Returns (data, is_hit, is_rebuilder).
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

        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
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
        except (valkey.ConnectionError, valkey.TimeoutError):
            pass

    # ------------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------------

    def get_stats(self):
        """Retrieve cache statistics from Valkey's INFO command."""
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

    # ------------------------------------------------------------------
    # Pipeline access (used by warm_cache)
    # ------------------------------------------------------------------

    def pipeline(self):
        """Return a Valkey pipeline for batching commands."""
        return self._client.pipeline()

    @property
    def ttl_seconds(self):
        """Expose the configured TTL for use by the warming function."""
        return self._ttl_seconds

    @property
    def is_connected(self):
        """Check if the Valkey connection is healthy using PING."""
        try:
            return self._client.ping()
        except (valkey.ConnectionError, valkey.TimeoutError):
            return False
