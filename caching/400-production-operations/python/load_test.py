"""
Simple concurrent load test for the 400-level workshop.

Fires parallel requests at the bookstore to verify:
- Connection pooling handles concurrent load
- Cluster client routes correctly under pressure
- Circuit breaker absorbs node failures during the test

Usage:
    python load_test.py

The app must be running on localhost:5000.
"""

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import urlopen
from urllib.error import URLError


BASE_URL = "http://localhost:5000"
ENDPOINTS = [
    "/",
    "/genre/computing",
    "/genre/science%20fiction",
    "/genre/non-fiction",
    "/genre/engineering",
    "/genre/networking",
    "/book/1",
    "/book/3",
    "/book/5",
    "/book/10",
    "/health",
    "/stats",
]

NUM_WORKERS = 10
REQUESTS_PER_ENDPOINT = 5


def fetch(url):
    """Fetch a URL and return (url, status_code, elapsed_ms)."""
    start = time.perf_counter()
    try:
        response = urlopen(url, timeout=10)
        status = response.status
    except URLError as exc:
        status = getattr(exc, "code", 0) or 0
    elapsed = round((time.perf_counter() - start) * 1000)
    return (url, status, elapsed)


def main():
    urls = []
    for endpoint in ENDPOINTS:
        for _ in range(REQUESTS_PER_ENDPOINT):
            urls.append(f"{BASE_URL}{endpoint}")

    print(f"Firing {len(urls)} requests across {NUM_WORKERS} threads...\n")

    results = []
    start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
        futures = [executor.submit(fetch, url) for url in urls]
        for future in as_completed(futures):
            results.append(future.result())

    total_time = round((time.perf_counter() - start) * 1000)

    # Summarize
    successes = [r for r in results if 200 <= r[1] < 400]
    failures = [r for r in results if r[1] == 0 or r[1] >= 400]
    latencies = [r[2] for r in results if r[1] != 0]

    print(f"Total requests: {len(results)}")
    print(f"Successes: {len(successes)}")
    print(f"Failures: {len(failures)}")
    if latencies:
        print(f"Avg latency: {sum(latencies) // len(latencies)}ms")
        print(f"Max latency: {max(latencies)}ms")
        print(f"Min latency: {min(latencies)}ms")
    print(f"Total wall time: {total_time}ms")

    if failures:
        print(f"\nFailed requests:")
        for url, status, elapsed in failures[:10]:
            print(f"  {status} {url} ({elapsed}ms)")


if __name__ == "__main__":
    main()
