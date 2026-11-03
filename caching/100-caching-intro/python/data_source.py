"""
Data Source module - simulates a slow external data provider.

Introduces artificial latency to represent an expensive operation (like a
remote API call or complex database query). Provides deterministic output
for a given input so you can verify cache correctness.

You will complete this module in Part 2 of the workshop.
"""

import os
import time
from datetime import datetime, timezone


_FACTS_DATABASE = {}  # See Part 2 in the README


def get_facts(topic):
    """Fetch facts about a topic from the slow source. See Part 2 in the README."""
    normalized_topic = topic.strip().lower()

    # Part 2: Add the artificial delay and database lookup here.
    pass

    return {
        "topic": normalized_topic,
        "facts": [],
        "fetched_at": "",
    }
