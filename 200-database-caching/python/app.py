"""
Flask application for the 200-level Valkey Caching Workshop.

This app serves a bookstore catalog backed by PostgreSQL. Without caching,
every page load queries the database. With caching enabled, repeated reads
are served from Valkey. When data is updated, the relevant cache entries
are invalidated so users always see fresh data.

You will build this up across Parts 2-4 of the workshop.
"""

import os
import time

from dotenv import load_dotenv
from flask import Flask, flash, redirect, render_template, request, url_for

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")

# Cache configuration (you will enable this in Part 3)
CACHE_ENABLED = os.environ.get("CACHE_ENABLED", "false").lower() == "true"
cache = None

if CACHE_ENABLED:
    from cache_layer import CacheLayer
    cache = CacheLayer(
        host=os.environ.get("VALKEY_HOST", "localhost"),
        port=int(os.environ.get("VALKEY_PORT", "6379")),
        ttl_seconds=int(os.environ.get("CACHE_TTL_SECONDS", "300")),
    )


@app.route("/")
def home():
    """Display the list of genres."""
    # TODO (Part 2): Import db and call db.get_all_genres()
    # TODO (Part 3): Add caching around the genre list query
    genres = []
    return render_template("index.html", genres=genres)


@app.route("/genre/<genre>")
def genre_listing(genre):
    """
    Display all books in a genre.

    This route should:
    1. Measure query time with time.perf_counter()
    2. Fetch books from the database (or cache)
    3. Display the books with timing and cache status
    """
    # TODO (Part 2): Query db.get_books_by_genre(genre)
    # TODO (Part 3): Add cache-aside logic with key "genre:{genre}"
    books = []
    elapsed_ms = 0
    cache_status = "DISABLED"

    return render_template("genre.html",
        genre=genre,
        books=books,
        elapsed_ms=elapsed_ms,
        cache_status=cache_status,
    )


@app.route("/book/<int:book_id>")
def book_detail(book_id):
    """
    Display details for a single book.

    This route should:
    1. Measure query time
    2. Fetch the book from database (or cache)
    3. Return 404 if not found
    4. Display the book with timing and cache status
    """
    # TODO (Part 2): Query db.get_book_detail(book_id)
    # TODO (Part 3): Add cache-aside logic with key "book:{book_id}"
    book = None
    elapsed_ms = 0
    cache_status = "DISABLED"

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
    """
    Edit a book's description and invalidate related cache entries.

    GET: Display the edit form.
    POST: Update the description, invalidate cache, redirect to book detail.

    This is where write-through invalidation happens:
    1. Update the database
    2. Invalidate the specific book cache entry
    3. Invalidate the genre listing (since the book appears there)
    4. Redirect with code=303 (tells the client to follow with GET, not POST)
    """
    # TODO (Part 4): Implement edit form and write-through invalidation
    flash("Edit functionality not implemented yet.")
    return redirect(url_for("book_detail", book_id=book_id))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
