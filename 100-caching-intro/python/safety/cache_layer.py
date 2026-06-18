"""
Cache Layer module - wraps Valkey operations for the workshop application.

This module provides a simple interface for caching data in Valkey. It handles
connection management, JSON serialization, TTL-based expiration, and graceful
degradation when Valkey is unavailable.
"""

from __future__ import annotations

import json
import logging

import valkey

logger = logging.getLogger(__name__)


class CacheLayer:
    """Wraps Valkey operations and provides a simple caching interface.

    All methods handle connection failures gracefully: get returns (None, False),
    set and invalidate become no-ops with logged warnings. Exceptions are never
    raised to the caller.
    """

    def __init__(self, host: str = "localhost", port: int = 6379, ttl_seconds: int = 30):
        """Initialize connection to Valkey with configurable TTL.

        Args:
            host: Valkey server hostname.
            port: Valkey server port.
            ttl_seconds: Default time-to-live for cached entries in seconds.
        """
        self._ttl_seconds = ttl_seconds
        self._client = valkey.Valkey(host=host, port=port, decode_responses=True)

    def get(self, key: str) -> tuple[dict | None, bool]:
        """Attempt to retrieve a cached entry.

        Args:
            key: The cache key to look up.

        Returns:
            Tuple of (data_or_None, is_cache_hit). Returns (None, False) on
            cache miss or connection failure.
        """
        try:
            raw = self._client.get(key)
            if raw is None:
                return (None, False)
            data = json.loads(raw)
            return (data, True)
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on get('%s'): %s", key, exc)
            return (None, False)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Deserialization error on get('%s'): %s", key, exc)
            return (None, False)

    def set(self, key: str, data: dict) -> None:
        """Store data in cache with the configured TTL.

        Args:
            key: The cache key to store under.
            data: The dictionary to serialize and cache.
        """
        try:
            raw = json.dumps(data)
            self._client.set(key, raw, ex=self._ttl_seconds)
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on set('%s'): %s", key, exc)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Serialization error on set('%s'): %s", key, exc)

    def invalidate(self, key: str) -> bool:
        """Remove a specific key from cache.

        Args:
            key: The cache key to remove.

        Returns:
            True if the key existed and was removed, False otherwise.
        """
        try:
            result = self._client.delete(key)
            return result > 0
        except (valkey.ConnectionError, valkey.TimeoutError) as exc:
            logger.warning("Valkey connection error on invalidate('%s'): %s", key, exc)
            return False

    @property
    def is_connected(self) -> bool:
        """Check if the Valkey connection is healthy using PING."""
        try:
            return self._client.ping()
        except (valkey.ConnectionError, valkey.TimeoutError):
            return False
