"""
Simple concurrent load test for the 300-level workshop (Part 5).

Sends concurrent requests to the genre listing endpoint to demonstrate:
- Cache warming eliminates cold start misses
- Mutex lock prevents duplicate database queries under concurrency
- Circuit breaker eliminates timeout latency during Valkey outage
- Hit rate stays above 90% under sustained load

Usage:
    python load_test.py

Requires the Flask app to be running on localhost:5000.
"""

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import urlopen
from urllib.error import URLError


BASE_URL = "http://localhost:5000"
GENRES = ["fantasy", "computing", "science fiction", "non-fiction", "fiction",
          "childrens", "philosophy", "engineering", "networking"]


def fetch(url):
    """Fetch a URL and return (url, status_code, elapsed_ms)."""
    start = time.perf_counter()
    try:
        response = urlopen(url)
        elapsed = round((time.perf_counter() - start) * 1000)
        return (url, response.status, elapsed)
    except URLError as exc:
        elapsed = round((time.perf_counter() - start) * 1000)
        return (url, 0, elapsed)


def run_load_test(concurrency=20, rounds=3):
    """Run concurrent requests against genre endpoints."""
    print(f"Load test: {concurrency} concurrent requests, {rounds} rounds")
    print(f"Target: {BASE_URL}")
    print("-" * 60)

    # Check that the app is running
    try:
        urlopen(f"{BASE_URL}/")
    except URLError:
        print("ERROR: Cannot connect to the app. Is Flask running on port 5000?")
        sys.exit(1)

    all_results = []

    for round_num in range(1, rounds + 1):
        urls = [f"{BASE_URL}/genre/{genre}" for genre in GENRES]
        # Repeat URLs to create more concurrent requests than unique keys
        urls = urls * (concurrency // len(urls) + 1)
        urls = urls[:concurrency]

        start = time.perf_counter()

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(fetch, url) for url in urls]
            results = [f.result() for f in as_completed(futures)]

        round_elapsed = round((time.perf_counter() - start) * 1000)

        successes = sum(1 for _, status, _ in results if status == 200)
        failures = sum(1 for _, status, _ in results if status != 200)
        avg_latency = round(sum(ms for _, _, ms in results) / len(results))
        max_latency = max(ms for _, _, ms in results)

        print(f"\nRound {round_num}:")
        print(f"  Requests: {len(results)} ({successes} ok, {failures} failed)")
        print(f"  Wall time: {round_elapsed} ms")
        print(f"  Avg latency: {avg_latency} ms")
        print(f"  Max latency: {max_latency} ms")

        all_results.extend(results)

        # Brief pause between rounds
        time.sleep(0.5)

    # Summary
    print("\n" + "=" * 60)
    total = len(all_results)
    total_success = sum(1 for _, status, _ in all_results if status == 200)
    total_avg = round(sum(ms for _, _, ms in all_results) / total)
    print(f"Total requests: {total}")
    print(f"Success rate: {total_success}/{total} ({round(total_success/total*100, 1)}%)")
    print(f"Average latency: {total_avg} ms")
    print("\nNow check /stats to see the hit rate.")
    print(f"  curl {BASE_URL}/stats | python -m json.tool")


if __name__ == "__main__":
    run_load_test()
