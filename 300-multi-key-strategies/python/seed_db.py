"""
Seed script - populates the PostgreSQL database with sample data.

Run this once after starting the PostgreSQL container:
    python seed_db.py

Safe to run multiple times. Existing data is truncated before inserting.

It reads seed/init.sql and executes it against the database configured
in your .env file (DATABASE_URL).
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import psycopg

load_dotenv()


def main():
    sql_path = Path(__file__).parent / "seed" / "init.sql"
    sql = sql_path.read_text()

    try:
        conn = psycopg.connect(os.environ["DATABASE_URL"])
    except KeyError:
        print("ERROR: DATABASE_URL is not set. Copy .env.example to .env and check the value.")
        sys.exit(1)
    except psycopg.OperationalError as exc:
        print(f"ERROR: Could not connect to the database. Is PostgreSQL running?\n{exc}")
        sys.exit(1)

    try:
        with conn:
            conn.execute(sql)
        print("Database seeded successfully.")
    except psycopg.Error as exc:
        print(f"ERROR: Seeding failed.\n{exc}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
