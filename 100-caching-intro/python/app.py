"""
Flask application for the Valkey Caching Workshop.

This is the starter version (Part 2): no caching, just the slow data source.
You will add caching in Part 4.
"""

import os
import time

from dotenv import load_dotenv
from flask import Flask, flash, redirect, render_template, request, url_for

from data_source import get_facts

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")


@app.route("/")
def home():
    """Render the home page with the topic input form."""
    return render_template("index.html")


@app.route("/lookup")
def lookup():
    """
    Fetch facts for a topic, measure response time, and display results.

    This route should:
    1. Get the "topic" query parameter from the request
    2. Normalize it (strip whitespace, lowercase)
    3. Redirect to home with a flash message if empty
    4. Measure how long the data fetch takes using time.perf_counter()
    5. Call get_facts(topic) to retrieve the data
    6. Render the template with the results and timing info
    """
    topic = request.args.get("topic", "").strip().lower()

    if not topic:
        flash("Please enter a topic to look up.")
        return redirect(url_for("home"))

    # TODO: Record the start time using time.perf_counter()

    # TODO: Call get_facts(topic) and store the result

    # TODO: Record the end time and calculate elapsed milliseconds
    # Hint: round((end - start) * 1000)

    # TODO: Return render_template with these variables:
    #   topic, facts, elapsed_ms, cache_status="DISABLED",
    #   fetched_at, cache_warning=None
    # Hint: The result from get_facts() is a dict with keys
    #   "topic", "facts", and "fetched_at"

    # Remove this placeholder once you complete the TODOs above
    return redirect(url_for("home"))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
