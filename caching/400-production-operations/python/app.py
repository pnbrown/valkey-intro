"""
Flask application for the 400-level Valkey Caching Workshop.

Carries forward the 300-level bookstore with caching enabled by default.
You will add a health check endpoint in Part A3 and wire the cluster
client from cache_layer.py.
"""

import os
import time

from dotenv import load_dotenv
from flask import Flask, flash, jsonify, redirect, render_template, request, url_for

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

# Cache configuration
CACHE_ENABLED = os.environ.get("CACHE_ENABLED", "true").lower() == "true"
cache = None
cache_startup_error = None

if CACHE_ENABLED:
    from cache_layer import CacheLayer
    try:
        cache = CacheLayer(
            circuit_threshold=int(os.environ.get("CIRCUIT_BREAKER_THRESHOLD", "3")),
            circuit_cooldown=int(os.environ.get("CIRCUIT_BREAKER_COOLDOWN", "30")),
            ttl_seconds=int(os.environ.get("CACHE_TTL_SECONDS", "300")),
        )
    except Exception as exc:
        # ValkeyCluster connects while it is constructed. If the cluster is
        # unreachable, keep serving from PostgreSQL instead of crashing, and
        # let /health report the problem. Restart the app once Valkey is up.
        cache_startup_error = str(exc)
        app.logger.warning("Valkey Cluster unavailable at startup, serving from PostgreSQL only: %s", exc)

# Cache warming at startup (carried forward from the 300-level)
if cache is not None:
    from warm_cache import warm_cache
    warm_cache(cache)


@app.route("/")
def home():
    from db import get_all_genres

    if CACHE_ENABLED and cache is not None:
        cached_data, is_hit = cache.get("genres")
        if is_hit:
            genres = cached_data
        else:
            genres = get_all_genres()
            cache.set("genres", genres)
    else:
        genres = get_all_genres()

    return render_template("index.html", genres=genres)


@app.route("/genre/<genre>")
def genre_listing(genre):
    from db import get_books_by_genre

    cache_status = "DISABLED"
    cache_key = f"genre:{genre}"

    start = time.perf_counter()

    if CACHE_ENABLED and cache is not None:
        # Stampede protection, carried forward from the 300-level
        data, is_hit, is_rebuilder = cache.get_with_lock(cache_key)
        if is_hit:
            books = data
            cache_status = "HIT"
        elif is_rebuilder:
            # Release the lock even if the query fails, so the next request can
            # rebuild right away instead of waiting out the lock's 5-second TTL.
            try:
                books = get_books_by_genre(genre)
                cache.set(cache_key, books)
            finally:
                cache.release_lock(cache_key)
            cache_status = "MISS"
        else:
            # Retries exhausted or error. Fall through to DB.
            books = get_books_by_genre(genre)
            cache_status = "MISS"
    else:
        books = get_books_by_genre(genre)

    end = time.perf_counter()
    elapsed_ms = round((end - start) * 1000)

    return render_template("genre.html",
        genre=genre,
        books=books,
        elapsed_ms=elapsed_ms,
        cache_status=cache_status,
    )


@app.route("/book/<int:book_id>")
def book_detail(book_id):
    from db import get_book_detail

    cache_status = "DISABLED"
    cache_key = f"book:{book_id}"

    start = time.perf_counter()

    if CACHE_ENABLED and cache is not None:
        cached_data, is_hit = cache.get(cache_key)
        if is_hit:
            book = cached_data
            cache_status = "HIT"
        else:
            book = get_book_detail(book_id)
            if book is not None:
                cache.set(cache_key, book)
            cache_status = "MISS"
    else:
        book = get_book_detail(book_id)

    end = time.perf_counter()
    elapsed_ms = round((end - start) * 1000)

    if book is None:
        flash("Book not found.")
        return redirect(url_for("home"))

    return render_template("book.html",
        book=book,
        elapsed_ms=elapsed_ms,
        cache_status=cache_status,
    )


@app.route("/book/<int:book_id>/edit", methods=["GET", "POST"])
def edit_book(book_id):
    from db import get_book_detail, update_book_description

    book = get_book_detail(book_id)
    if book is None:
        flash("Book not found.")
        return redirect(url_for("home"))

    if request.method == "GET":
        return render_template("edit.html", book=book)

    new_description = request.form.get("description", "").strip()
    if not new_description:
        flash("Description cannot be empty.")
        return render_template("edit.html", book=book)

    update_book_description(book_id, new_description)

    if CACHE_ENABLED and cache is not None:
        cache.invalidate(f"book:{book_id}")
        cache.invalidate_pattern("genre:*")
        cache.invalidate("genres")

    flash(f"Description updated for '{book['title']}'.")
    return redirect(url_for("book_detail", book_id=book_id), code=303)


@app.route("/stats")
def stats():
    """Return cache statistics as JSON."""
    if not CACHE_ENABLED:
        return jsonify({"error": "Cache is disabled"}), 503
    if cache is None:
        return jsonify({"error": f"Cache unavailable: not connected at startup ({cache_startup_error})"}), 503

    data = cache.get_stats()
    if data is None:
        return jsonify({"error": "Could not retrieve stats from Valkey"}), 503

    return jsonify(data)


# Part A3: Add the /health endpoint here. See the README.


if __name__ == "__main__":
    app.run(debug=True, port=5000)
