"""
Flask application for the 400-level Valkey Caching Workshop.
(Completed reference version)
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

if CACHE_ENABLED:
    from cache_layer import CacheLayer
    cache = CacheLayer(
        circuit_threshold=int(os.environ.get("CIRCUIT_BREAKER_THRESHOLD", "3")),
        circuit_cooldown=int(os.environ.get("CIRCUIT_BREAKER_COOLDOWN", "30")),
        ttl_seconds=int(os.environ.get("CACHE_TTL_SECONDS", "300")),
    )


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
        cached_data, is_hit = cache.get(cache_key)
        if is_hit:
            books = cached_data
            cache_status = "HIT"
        else:
            books = get_books_by_genre(genre)
            cache.set(cache_key, books)
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
    if not CACHE_ENABLED or cache is None:
        return jsonify({"error": "Cache is disabled"}), 503

    data = cache.get_stats()
    if data is None:
        return jsonify({"error": "Could not retrieve stats from Valkey"}), 503

    return jsonify(data)


@app.route("/health")
def health():
    """Probe dependencies and report readiness."""
    from db import get_connection

    checks = {}

    # Check PostgreSQL
    try:
        with get_connection() as conn:
            conn.execute("SELECT 1")
        checks["postgres"] = "ok"
    except Exception as exc:
        checks["postgres"] = f"error: {exc}"

    # Check Valkey Cluster
    try:
        if cache is not None and cache.is_connected:
            checks["valkey"] = "ok"
        elif cache is not None:
            checks["valkey"] = "error: ping failed"
        else:
            checks["valkey"] = "disabled"
    except Exception as exc:
        checks["valkey"] = f"error: {exc}"

    status = 200 if all(v == "ok" or v == "disabled" for v in checks.values()) else 503
    return jsonify(checks), status


if __name__ == "__main__":
    app.run(debug=True, port=5000)
