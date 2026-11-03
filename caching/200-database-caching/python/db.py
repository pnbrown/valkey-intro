"""
Database module - provides access to the PostgreSQL bookstore database.

Handles connection management and exposes query functions for the
bookstore application. You will complete this module in Part 2 of the workshop.
"""

import os

import psycopg
from psycopg.rows import dict_row


def get_connection():
    """Create and return a new database connection."""
    return psycopg.connect(os.environ["DATABASE_URL"])


def get_books_by_genre(genre):
    """Fetch all books in a genre with author name. See Part 2 in the README."""
    return []


def get_book_detail(book_id):
    """Fetch a single book by ID with author info. Returns None if not found.
    See Part 2 in the README."""
    return None


def get_all_genres():
    """Fetch a sorted list of distinct genres. See Part 2 in the README."""
    return []


def update_book_description(book_id, new_description):
    """Update a book's description. Returns True if updated. See Part 4 in the README."""
    return False
