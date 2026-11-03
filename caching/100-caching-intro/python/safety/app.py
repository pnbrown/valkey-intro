"""
Flask application for the Valkey Caching Workshop.

This app fetches data from the Data Source and optionally caches responses
in Valkey. When CACHE_ENABLED=true, the app checks the cache before calling
the Data Source, storing results on cache misses and returning cached data
on cache hits. Timing information is always displayed so participants can
observe the performance difference.
"""

import os
import time

from dotenv import load_dotenv
from flask import Flask, flash, redirect, render_template, request, url_for

from data_source import get_facts

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

# Cache Layer: initialized conditionally based on CACHE_ENABLED environment variable.
CACHE_ENABLED = os.environ.get("CACHE_ENABLED", "false").lower() == "true"
cache = None

if CACHE_ENABLED:
    from cache_layer import CacheLayer

    cache = CacheLayer(
        host=os.environ.get("VALKEY_HOST", "localhost"),
        port=int(os.environ.get("VALKEY_PORT", "6379")),
        ttl_seconds=int(os.environ.get("CACHE_TTL_SECONDS", "30")),
    )


@app.route("/")
def home():
    """Render the home page with the topic input form."""
    return render_template("index.html")


@app.route("/lookup")
def lookup():
    """Fetch facts for a topic, measure response time, and display results."""
    topic = request.args.get("topic", "")

    # Normalize input: strip whitespace and lowercase
    topic = topic.strip().lower()

    # Redirect to home if input is empty after normalization
    if not topic:
        flash("Please enter a topic to look up.")
        return redirect(url_for("home"))

    cache_status = "DISABLED"
    cache_warning = None
    result = None

    # Measure the entire data retrieval flow (cache or Data Source)
    start = time.perf_counter()

    if CACHE_ENABLED and cache is not None:
        if cache.is_connected:
            # Try to get data from cache
            cached_data, is_hit = cache.get(f"facts:{topic}")

            if is_hit:
                # Cache hit: use cached data
                result = cached_data
                cache_status = "HIT"
            else:
                # Cache miss: fetch from Data Source and store in cache
                result = get_facts(topic)
                cache.set(f"facts:{topic}", result)
                cache_status = "MISS"
        else:
            # Valkey unreachable: fetch directly from Data Source
            cache_warning = (
                "Valkey is not reachable. Caching is disabled. "
                "Data is being fetched directly from the source."
            )
            result = get_facts(topic)
            cache_status = "MISS"
    else:
        # Caching disabled: fetch from Data Source directly
        result = get_facts(topic)

    end = time.perf_counter()
    elapsed_ms = round((end - start) * 1000)

    # Build template context
    context = {
        "topic": result["topic"],
        "facts": result["facts"],
        "elapsed_ms": elapsed_ms,
        "cache_status": cache_status,
        "fetched_at": result["fetched_at"],
        "cache_warning": cache_warning,
    }

    return render_template("index.html", **context)


@app.route("/invalidate", methods=["POST"])
def invalidate():
    """Clear the cache for a specific topic."""
    topic = request.form.get("topic", "")

    # Normalize input: strip whitespace and lowercase
    topic = topic.strip().lower()

    if not topic:
        flash("Please provide a topic to invalidate.")
        return redirect(url_for("home"))

    key = f"facts:{topic}"

    if CACHE_ENABLED and cache is not None:
        removed = cache.invalidate(key)
        if removed:
            flash(f"Cache entry for '{topic}' has been invalidated.")
        else:
            flash(f"No cache entry found for '{topic}'.")
    else:
        flash("Caching is not enabled.")

    return redirect(url_for("home"))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
