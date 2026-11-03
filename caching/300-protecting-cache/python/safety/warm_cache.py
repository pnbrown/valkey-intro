"""
Cache warming module for the 300-level workshop.
(Completed reference version)
"""

import json
import logging
import time

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s: %(message)s"))
    logger.addHandler(_handler)


def warm_cache(cache):
    """
    Pre-populate the cache with genre listings and the genre list.
    Uses a Valkey pipeline to batch all writes into one network round-trip.
    """
    from db import get_all_genres, get_books_by_genre

    start = time.perf_counter()

    try:
        genres = get_all_genres()
        pipe = cache.pipeline()

        # Queue the genre list
        pipe.set("genres", json.dumps(genres), ex=cache.ttl_seconds)
        keys_queued = 1

        # Queue each genre's book listing
        for genre in genres:
            books = get_books_by_genre(genre)
            pipe.set(f"genre:{genre}", json.dumps(books), ex=cache.ttl_seconds)
            keys_queued += 1

        # Execute all SET commands in one round-trip
        pipe.execute()

        elapsed_ms = round((time.perf_counter() - start) * 1000)
        logger.info("Cache warmed: %d keys in %d ms", keys_queued, elapsed_ms)

    except Exception as exc:
        elapsed_ms = round((time.perf_counter() - start) * 1000)
        logger.warning("Cache warming failed after %d ms: %s", elapsed_ms, exc)
