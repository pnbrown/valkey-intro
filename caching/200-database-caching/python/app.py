"""
Flask application for the 200-level Valkey Caching Workshop.

Serves a bookstore catalog backed by PostgreSQL. You will add database
queries in Part 2, caching in Part 3, and write-through invalidation in Part 4.
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
    """Display the list of genres. See Parts 2-3 in the README."""
    genres = []
    return render_template("index.html", genres=genres)


@app.route("/genre/<genre>")
def genre_listing(genre):
    """Display all books in a genre. See Parts 2-3 in the README."""
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
    """Display details for a single book. See Parts 2-3 in the README."""
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
    """Edit a book's description with write-through invalidation.
    See Part 4 in the README."""
    flash("Edit functionality not implemented yet.")
    return redirect(url_for("book_detail", book_id=book_id))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
