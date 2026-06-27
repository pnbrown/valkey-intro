"""
Cache Layer module - wraps Valkey operations for the bookstore application.
(Completed reference version)
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
        try:
            self._client.set(key, json.dumps(data), ex=self._ttl_seconds)
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on set('%s'): %s", key, exc)
        except (TypeError) as exc:
            logger.warning("Serialization error on set('%s'): %s", key, exc)

    def invalidate(self, key):
        try:
            return self._client.delete(key) > 0
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on invalidate('%s'): %s", key, exc)
            return False

    def invalidate_pattern(self, pattern):
        try:
            count = 0
            for key in self._client.scan_iter(match=pattern):
                self._client.delete(key)
                count += 1
            return count
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on invalidate_pattern('%s'): %s", pattern, exc)
            return 0

    @property
    def is_connected(self):
        try:
            return self._client.ping()
        except (valkey.ConnectionError, valkey.TimeoutError):
            return False
