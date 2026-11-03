"""
Flask application for the Valkey Caching Workshop.

Starter version: no caching, just the slow data source.
You will complete the /lookup route in Part 2 and add caching in Part 4.
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
    """Fetch facts for a topic, measure response time, and display results.
    See Part 2 in the README."""
    topic = request.args.get("topic", "").strip().lower()

    if not topic:
        flash("Please enter a topic to look up.")
        return redirect(url_for("home"))

    # Part 2: Measure timing, call get_facts(), render template.
    # See the README for the complete implementation.
    return redirect(url_for("home"))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
