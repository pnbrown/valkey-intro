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


# Pre-defined dictionary of facts for known topics.
# Output is deterministic: same topic always returns the same facts.
_FACTS_DATABASE = {
    "valkey": [
        "Valkey is an open source high-performance key/value datastore.",
        "Valkey supports strings, hashes, lists, sets, and sorted sets.",
        "Valkey was created as a community-driven fork in 2024.",
        "Valkey is licensed under the BSD 3-Clause license.",
        "Valkey maintains backward compatibility with existing clients and protocols.",
    ],
    "python": [
        "Python was created by Guido van Rossum and first released in 1991.",
        "Python uses indentation to define code blocks instead of curly braces.",
        "Python supports multiple programming paradigms including procedural, object-oriented, and functional.",
        "The Python Package Index (PyPI) hosts hundreds of thousands of packages.",
        "Python is dynamically typed and garbage-collected.",
    ],
    "docker": [
        "Docker packages applications into containers using operating system-level virtualization.",
        "Docker containers share the host system kernel, making them lighter than virtual machines.",
        "A Dockerfile defines the steps to build a container image.",
        "Docker Hub is a public registry for sharing container images.",
        "Docker Compose allows defining multi-container applications in a single YAML file.",
    ],
    "caching": [
        "Caching stores copies of data in a high-speed storage layer for faster retrieval.",
        "Cache invalidation is one of the two hard problems in computer science.",
        "A cache hit occurs when requested data is found in the cache.",
        "A cache miss occurs when requested data is not in the cache and must be fetched from the source.",
        "Time-to-live (TTL) determines how long a cached entry remains valid before expiring.",
    ],
}


def get_facts(topic: str) -> dict:
    """
    Simulates fetching facts about a topic from a slow external source.

    Introduces a configurable artificial delay (via SLOW_DELAY_SECONDS environment
    variable, default 2.5 seconds) before returning results, simulating the latency
    of an expensive external operation.

    Args:
        topic: The lookup key (e.g., "python", "valkey", "docker")

    Returns:
        dict with keys:
            - "topic": the normalized topic string
            - "facts": list of fact strings (empty list for unknown topics)
            - "fetched_at": ISO 8601 timestamp of when the data was fetched
    """
    # Normalize input: strip whitespace and lowercase
    normalized_topic = topic.strip().lower()

    # Apply configurable artificial delay
    delay = float(os.environ.get("SLOW_DELAY_SECONDS", "2.5"))
    time.sleep(delay)

    # Look up facts (unknown topics get an empty list)
    facts = _FACTS_DATABASE.get(normalized_topic, [])

    return {
        "topic": normalized_topic,
        "facts": facts,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
