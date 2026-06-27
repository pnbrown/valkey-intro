# Valkey Caching Workshops

A progressive series of hands-on workshops that teach caching patterns using [Valkey](https://valkey.io/), an open source in-memory datastore. Each workshop builds on the previous one, introducing new concepts and increasing complexity.

## Workshops

| Level | Title | What you'll learn |
|-------|-------|-------------------|
| 100 | [Introduction to Caching](100-caching-intro/) | Cache-aside pattern, TTL expiration, manual invalidation |
| 200 | [Database-Backed Caching](200-database-caching/) | Caching real database queries, write-through invalidation |
| 300 | Multi-Key Strategies (planned) | Per-type TTL strategies, cache warming, stampede prevention |
| 400 | Production Operations (planned) | Valkey Cluster, eviction policies, observability |

## Prerequisites

To complete these workshops, you need:

- Python 3.9 or later (other languages coming soon)
- Docker running on your machine
- A text editor
- A terminal

No prior experience with Valkey or caching is required. We start from scratch in the 100-level workshop.

## How the workshops are organized

Each workshop lives in its own directory (e.g., `100-caching-intro/`). Inside, you'll find:

- A `README.md` with the full walkthrough (concepts, architecture, step-by-step implementation)
- A `docker-compose.yml` for the infrastructure (Valkey, and PostgreSQL for 200+)
- An `FAQ.md` covering design decisions and deeper explanations
- A `TROUBLESHOOTING.md` for common issues
- Language-specific subdirectories (e.g., `python/`) containing the starter code

Starter code ships with TODO placeholders. Each workshop README tells you what to paste in at each step. Completed reference files live in a `safety/` subdirectory if you get stuck.

## Getting started

Start with the [100-level workshop](100-caching-intro/). Clone this repository, navigate to that directory, and follow the README.

## Contributing

We welcome contributions, particularly new language implementations. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Roadmap

See [FUTURE.md](FUTURE.md) for planned workshops and their scope.

## License

[WTFPL](LICENSE)
