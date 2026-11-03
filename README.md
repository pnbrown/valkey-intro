# Valkey Workshops

Hands-on workshops that teach you to build with [Valkey](https://valkey.io/), an open source in-memory datastore. The workshops are organized into tracks. Each track focuses on one way applications use Valkey and runs from a 100-level introduction to a 400-level production workshop, with each level building on the one before it.

## Tracks

| Track | Status | What you'll learn |
|-------|--------|-------------------|
| [Caching](caching/) | Complete | Speeding up an application by storing the results of expensive work |
| [Session storage](FUTURE.md#session-storage-track-planned) | Planned | Keeping track of who a user is and what they're doing across requests |

The tracks are independent, but we recommend starting with the caching track. It introduces the Valkey fundamentals the other tracks build on.

## Caching track

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

No prior experience with Valkey is required. The 100-level workshop of the caching track starts from scratch.

## How the workshops are organized

Each track lives in its own top-level directory (e.g., `caching/`), with one directory per level inside it (e.g., `caching/100-caching-intro/`). Each level contains:

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

Start with the [caching track's 100-level workshop](caching/100-caching-intro/). Clone this repository, open `caching/100-caching-intro/python/README.md`, and follow the walkthrough.

## Contributing

We welcome contributions, particularly new language implementations. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Roadmap

See [FUTURE.md](FUTURE.md) for planned tracks and their scope.

## License

[WTFPL](LICENSE)
