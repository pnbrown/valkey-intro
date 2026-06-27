"""
Cache warming module for the 300-level workshop.

Pre-populates the cache with known high-traffic keys at application startup
using Valkey pipelines. You will complete this module in Part 1 of the workshop.
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
    """Pre-populate the cache with genre listings at startup.
    See Part 1 in the README."""
    logger.info("Cache warming not implemented yet.")
