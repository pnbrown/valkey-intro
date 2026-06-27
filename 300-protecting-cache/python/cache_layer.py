"""
Cache Layer module for the 300-level workshop.

Builds on the 200-level cache layer with three new capabilities:
- get_with_lock(): stampede prevention (Part 2)
- Circuit breaker: stop attempting Valkey when it is down (Part 3)
- get_stats(): expose INFO stats for observability (Part 4)

The existing get/set/invalidate/invalidate_pattern methods are carried
forward from the 200-level and work as before.
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

        # Circuit breaker state (Part 3)
        self._circuit_threshold = circuit_threshold
        self._circuit_cooldown = circuit_cooldown
        self._failure_count = 0
        self._circuit_opened_at = None

    # ------------------------------------------------------------------
    # Circuit breaker helpers (Part 3)
    # ------------------------------------------------------------------

    def _circuit_is_open(self):
        """Check if the circuit breaker is open. See Part 3 in the README."""
        return False

    def _record_failure(self):
        """Record a failure. Open the circuit if threshold reached.
        See Part 3 in the README."""
        pass

    def _record_success(self):
        """Record a success. Close the circuit if it was open.
        See Part 3 in the README."""
        pass

    # ------------------------------------------------------------------
    # Core cache operations (carried from 200-level)
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
    # Stampede prevention (Part 2)
    # ------------------------------------------------------------------

    def get_with_lock(self, key, lock_ttl=5, wait_time=0.1, max_retries=3):
        """Retrieve a cached entry with stampede prevention.
        Returns (data, is_hit, is_rebuilder). See Part 2 in the README."""
        # Placeholder: falls through to basic behavior
        data, is_hit = self.get(key)
        return (data, is_hit, not is_hit)

    def release_lock(self, key):
        """Delete the lock key after rebuilding. Best-effort."""
        try:
            self._client.delete(f"lock:{key}")
        except (valkey.ConnectionError, valkey.TimeoutError):
            pass

    # ------------------------------------------------------------------
    # Observability (Part 4)
    # ------------------------------------------------------------------

    def get_stats(self):
        """Retrieve cache statistics from Valkey INFO. See Part 4 in the README."""
        return None

    # ------------------------------------------------------------------
    # Pipeline access (Part 1 - used by warm_cache)
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
