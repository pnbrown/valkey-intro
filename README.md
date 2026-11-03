# Valkey Caching Workshops

A progressive series of hands-on workshops that teach caching patterns using [Valkey](https://valkey.io/), an open source in-memory datastore. Each workshop builds on the previous one, introducing new concepts and increasing complexity.

## Workshops

| Level | Title | What you'll learn |
|-------|-------|-------------------|
| 100 | [Introduction to Caching](caching/100-caching-intro/) | Cache-aside pattern, TTL expiration, manual invalidation |
| 200 | [Database-Backed Caching](caching/200-database-caching/) | Caching real database queries, write-through invalidation |
| 300 | [Protecting the Caching Layer](caching/300-protecting-cache/) | Cache warming, stampede prevention, circuit breaker, observability |
| 400 | [Production Operations](caching/400-production-operations/) | Valkey Cluster, eviction policies, observability |

## Prerequisites

To complete these workshops, you need:

- Python 3.9 or later (other languages coming soon)
- Docker running on your machine
- A text editor
- A terminal

No prior experience with Valkey or caching is required. We start from scratch in the 100-level workshop.

## How the workshops are organized

The workshops live in the `caching/` directory, one directory per level (e.g., `caching/100-caching-intro/`). Each level contains:

- A `README.md` with a short overview and a table of available language implementations
- A `docker-compose.yml` for the infrastructure (Valkey, and PostgreSQL for 200+)
- A directory for each language implementation (e.g., `python/`)

Each language directory contains:

- A `README.md` with the full walkthrough (concepts, architecture, step-by-step implementation)
- An `FAQ.md` covering design decisions and deeper explanations
- A `TROUBLESHOOTING.md` for common issues
- Starter files with placeholders that point to the matching step in the walkthrough
- A `safety/` subdirectory with completed reference files if you get stuck

## Getting started

Start with the [100-level workshop](caching/100-caching-intro/). Clone this repository, open `caching/100-caching-intro/python/README.md`, and follow the walkthrough.

## Contributing

We welcome contributions, particularly new language implementations. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Roadmap

See [FUTURE.md](FUTURE.md) for planned workshops and their scope.

## License

[WTFPL](LICENSE)
