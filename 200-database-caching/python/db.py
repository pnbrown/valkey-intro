"""
Database module - provides access to the PostgreSQL bookstore database.

This module handles connection management and exposes query functions that
the application uses to fetch data. In the 100-level workshop, this role
was played by a simulated delay. Here, the latency is real: network round-trips
to PostgreSQL and query execution time.

You will fill in the query functions in Part 2 of the workshop.
"""

import os

import psycopg
from psycopg.rows import dict_row


def get_connection():
    """Create and return a new database connection."""
    return psycopg.connect(os.environ["DATABASE_URL"])


def get_books_by_genre(genre):
    """
    Fetch all books in a given genre, joined with their author name.

    Should return a list of dictionaries, each with keys:
    id, title, author_name, published_year, description

    Steps:
    1. Open a connection with get_connection()
    2. Open a cursor with row_factory=dict_row
    3. Execute a SELECT joining books and authors, filtered by genre
    4. Fetch all results and return them as a list of dicts
    5. Use a with block on the connection so it closes automatically
    """
    # TODO: Implement database query here
    return []


def get_book_detail(book_id):
    """
    Fetch a single book by ID, joined with author information.

    Should return a dictionary with keys:
    id, title, author_name, author_bio, genre, published_year, description

    Returns None if the book is not found.

    Steps:
    1. Open a connection with get_connection()
    2. Open a cursor with row_factory=dict_row
    3. Execute a SELECT joining books and authors, filtered by book ID
    4. Fetch one result and return it (or None if not found)
    5. Use a with block on the connection so it closes automatically
    """
    # TODO: Implement database query here
    return None


def get_all_genres():
    """
    Fetch a sorted list of distinct genres from the books table.

    Should return a list of genre strings.

    Steps:
    1. Open a connection with get_connection()
    2. Execute: SELECT DISTINCT genre FROM books ORDER BY genre
    3. Return a flat list of genre strings
    4. Use a with block on the connection so it closes automatically
    """
    # TODO: Implement database query here
    return []


def update_book_description(book_id, new_description):
    """
    Update the description of a book by ID.

    Should return True if a row was updated, False otherwise.

    Steps:
    1. Open a connection with get_connection()
    2. Execute an UPDATE statement setting description = new_description WHERE id = book_id
    3. Capture cur.rowcount before leaving the cursor block
    4. Commit the transaction
    5. Return whether rowcount > 0
    6. Use a with block on the connection so it closes automatically
    """
    # TODO: Implement database update here
    return False
