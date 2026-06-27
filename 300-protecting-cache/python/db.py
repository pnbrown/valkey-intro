"""
Database module - provides access to the PostgreSQL bookstore database.

This is the completed version from the 200-level workshop. No TODOs here.
The 300-level focuses on cache layer improvements, not database changes.
"""

import os

import psycopg
from psycopg.rows import dict_row


def get_connection():
    """Create and return a new database connection."""
    return psycopg.connect(os.environ["DATABASE_URL"])


def get_books_by_genre(genre):
    """Fetch all books in a given genre, joined with their author name."""
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("""
                SELECT b.id, b.title, a.name AS author_name,
                       b.published_year, b.description
                FROM books b
                JOIN authors a ON b.author_id = a.id
                WHERE b.genre = %s
                ORDER BY b.published_year DESC
            """, (genre,))
            return [dict(row) for row in cur.fetchall()]


def get_book_detail(book_id):
    """Fetch a single book by ID, joined with author information."""
    with get_connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("""
                SELECT b.id, b.title, a.name AS author_name, a.bio AS author_bio,
                       b.genre, b.published_year, b.description
                FROM books b
                JOIN authors a ON b.author_id = a.id
                WHERE b.id = %s
            """, (book_id,))
            row = cur.fetchone()
            return dict(row) if row else None


def get_all_genres():
    """Fetch a sorted list of distinct genres from the books table."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT genre FROM books ORDER BY genre")
            return [row[0] for row in cur.fetchall()]


def update_book_description(book_id, new_description):
    """Update the description of a book by ID. Returns True if a row was updated."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE books SET description = %s WHERE id = %s",
                (new_description, book_id)
            )
            rowcount = cur.rowcount
        conn.commit()
        return rowcount > 0
