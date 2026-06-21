"""
Cache Layer module - wraps Valkey operations for the bookstore application.

This builds on the cache layer from the 100-level workshop. The core operations
(get, set, invalidate) are the same, with the addition of pattern-based
invalidation for clearing multiple related keys at once.

You will fill in the new method in Part 3 of the workshop.
"""

import json
import logging

import valkey

logger = logging.getLogger(__name__)
logger.setLevel(logging.WARNING)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s: %(message)s"))
    logger.addHandler(_handler)


class CacheLayer:
    """Wraps Valkey operations with JSON serialization and graceful degradation."""

    def __init__(self, host="localhost", port=6379, ttl_seconds=60):
        self._ttl_seconds = ttl_seconds
        self._client = valkey.Valkey(host=host, port=port, decode_responses=True)

    def get(self, key):
        """Retrieve a cached entry. Returns (data, True) on hit, (None, False) on miss."""
        try:
            raw = self._client.get(key)
            if raw is None:
                return (None, False)
            return (json.loads(raw), True)
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on get('%s'): %s", key, exc)
            return (None, False)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Deserialization error on get('%s'): %s", key, exc)
            return (None, False)

    def set(self, key, data):
        """Store data in cache with the configured TTL."""
        try:
            self._client.set(key, json.dumps(data), ex=self._ttl_seconds)
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on set('%s'): %s", key, exc)
        except (TypeError) as exc:
            logger.warning("Serialization error on set('%s'): %s", key, exc)

    def invalidate(self, key):
        """Remove a specific key from cache. Returns True if the key existed."""
        try:
            return self._client.delete(key) > 0
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on invalidate('%s'): %s", key, exc)
            return False

    def invalidate_pattern(self, pattern):
        """
        Remove all keys matching a glob pattern.

        This is useful for invalidating all cached entries related to a
        particular entity (e.g., all genre listings after a book update).

        Should return the number of keys removed.

        Steps:
        1. Use self._client.scan_iter(match=pattern) to find matching keys
        2. Delete each matching key
        3. Return the total count of deleted keys
        4. Catch connection errors and return 0

        Note: SCAN is preferred over KEYS in production because it does not
        block the server. For this workshop's small dataset, either works.
        """
        # TODO: Implement pattern-based invalidation here
        return 0

    @property
    def is_connected(self):
        """Check if the Valkey connection is healthy using PING."""
        try:
            return self._client.ping()
        except (valkey.ConnectionError, valkey.TimeoutError):
            return False
