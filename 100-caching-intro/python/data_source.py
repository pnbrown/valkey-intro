"""
Data Source module - simulates a slow external data provider.

This module represents an expensive operation (like a remote API call or complex
database query) by introducing artificial latency. It provides deterministic output
for a given input so participants can verify cache correctness by comparing cached
responses to fresh responses.
"""

import os
import time
from datetime import datetime, timezone


# TODO: Paste the _FACTS_DATABASE dictionary here.
# This is a dictionary where each key is a topic name (string) and each value
# is a list of fact strings about that topic.
# Topics to include: "valkey", "python", "docker", "caching"
_FACTS_DATABASE = {}


def get_facts(topic):
    """
    Simulates fetching facts about a topic from a slow external source.

    This function should:
    1. Normalize the topic (strip whitespace, lowercase)
    2. Sleep for SLOW_DELAY_SECONDS (default 2.5) to simulate latency
    3. Look up facts from _FACTS_DATABASE
    4. Return a dict with keys: "topic", "facts", "fetched_at"
    """
    # Normalize input: strip whitespace and lowercase
    normalized_topic = topic.strip().lower()

    # TODO: Read the delay from the SLOW_DELAY_SECONDS environment variable
    # (default to 2.5 seconds) and sleep for that duration.
    # Hint: os.environ.get() and time.sleep()

    # TODO: Look up facts for the normalized topic from _FACTS_DATABASE.
    # If the topic is not found, use an empty list.
    # Hint: dict.get(key, default)
    facts = []

    # TODO: Return a dictionary with three keys:
    #   "topic" - the normalized topic string
    #   "facts" - the list of facts (or empty list)
    #   "fetched_at" - current UTC time as ISO format string
    # Hint: datetime.now(timezone.utc).isoformat()
    return {
        "topic": normalized_topic,
        "facts": facts,
        "fetched_at": "",
    }
