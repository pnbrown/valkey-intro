# Valkey Workshops

Hands-on workshops that teach you to build with [Valkey](https://valkey.io/), an open source in-memory datastore. The workshops are organized into tracks. Each track focuses on one way applications use Valkey and runs from a 100-level introduction to a 400-level production workshop, with each level building on the one before it.

## Tracks

| Track | Status | What you'll learn |
|-------|--------|-------------------|
| [Caching](caching/) | Complete | Speeding up an application by storing the results of expensive work |
| [Session storage](FUTURE.md#session-storage-track-planned) | Planned | Keeping track of who a user is and what they're doing across requests |

The tracks are independent, but we recommend starting with the caching track. It introduces the Valkey fundamentals on which the other tracks build.

## Caching track

| Level | Title | What you'll learn |
|-------|-------|-------------------|
| 100 | [Introduction to Caching](caching/100-caching-intro/) | Cache-aside pattern, TTL expiration, manual invalidation |
| 200 | [Database-Backed Caching](caching/200-database-caching/) | Caching real database queries, write-through invalidation |
| 300 | [Protecting the Caching Layer](caching/300-protecting-cache/) | Cache warming, stampede prevention, circuit breaker, observability |
| 400 | [Production Operations](caching/400-production-operations/) | Valkey Cluster, hot shards, eviction policies, failover |

## Prerequisites

To complete these workshops, you need:

- Python 3.9 or later (other languages coming soon)
- Docker running on your machine
- A text editor
- A terminal

No prior experience with Valkey is required. The 100-level workshop of the caching track starts from scratch.

## Platform notes

The walkthroughs show commands for a macOS or Linux shell. Each level has been tested on macOS with Docker Desktop by building the app from the starter files exactly as its walkthrough describes, then exercising the finished app. Each level has also been run end to end on Linux (Amazon Linux 2023 on Arm64, with Docker Engine 25 and Python 3.9). Windows has not been tested yet. The notes below cover the differences we know about on those platforms. If you run into one we missed, please [open an issue](https://github.com/pnbrown/valkey-intro/issues).

### Linux

If your system has no `python` command, create the virtual environment with `python3 -m venv .venv` instead. On Debian and Ubuntu, if that fails with "ensurepip is not available," install the venv package first with `sudo apt install python3-venv`, as the error message suggests. Once the virtual environment is active, `python` points to its interpreter, and the rest of the commands work as written.

Docker Engine needs the Compose plugin, which provides `docker compose` (with a space). Some distributions do not install it with Docker; on Amazon Linux 2023, for example, the `docker` package includes only the buildx plugin, and `docker compose` fails with `docker: 'compose' is not a docker command`. Docker's [Compose plugin installation guide](https://docs.docker.com/compose/install/linux/) covers installing it. If you install Compose as a standalone `docker-compose` binary instead, `docker compose` still fails until Docker can find the binary in a CLI plugins directory; linking it there fixes that: `mkdir -p ~/.docker/cli-plugins && ln -s "$(command -v docker-compose)" ~/.docker/cli-plugins/docker-compose`. Run `docker compose version` to confirm. If Docker commands fail with "permission denied while trying to connect to the Docker daemon socket," either run them with `sudo` or add your user to the `docker` group as described in Docker's [Linux post-installation steps](https://docs.docker.com/engine/install/linux-postinstall/). Membership in that group grants root-level privileges on the machine, which the same page explains, so choose with that in mind.

In the 400-level workshop, the cache layer maps each cluster node's Docker network address to its published port on `localhost`. Docker Desktop needs that mapping because it does not route traffic from your machine into its bridge networks. Docker Engine on Linux does, so the mapping is not required there, but it does no harm: it reaches the same nodes through their published ports.

### Windows

Install Docker Desktop with the WSL 2 engine and keep it in Linux containers mode. From there, you have two ways to run the walkthroughs.

The simpler path is WSL 2. Install Ubuntu in WSL, turn on Docker Desktop's integration for it under Settings > Resources > WSL Integration (see Docker's [WSL 2 guide](https://docs.docker.com/desktop/features/wsl/)), clone this repository inside your Ubuntu home directory, and follow the Linux notes above. Every command in the walkthroughs then works as written. Use this path on Windows on Arm devices: the 200-level and 300-level workshops pin `psycopg[binary]==3.2.13`, and that release publishes no Windows Arm64 wheel (see the [psycopg-binary file list on PyPI](https://pypi.org/simple/psycopg-binary/)), so `pip install` cannot find a matching package in native Windows on those machines.

To work in PowerShell instead, translate these commands as you go:

| Walkthrough command | PowerShell equivalent |
|---|---|
| `source .venv/bin/activate` | `.venv\Scripts\Activate.ps1` |
| `cp .env.example .env` | `Copy-Item .env.example .env` |
| `curl -X POST ...` | `curl.exe -X POST ...` (same options) |
| `lsof -i :5432` | `netstat -ano \| findstr :5432` |
| `... \| grep evicted_keys` | `... \| Select-String evicted_keys` |

Install Python with the Python install manager, which provides the `python` command the walkthroughs use; if `python` does not work, [Using Python on Windows](https://docs.python.org/3/using/windows.html) has a troubleshooting section. Windows PowerShell 5.1 defines `curl` as an alias for `Invoke-WebRequest`, which rejects curl's options, so call `curl.exe` explicitly, as Microsoft's [curl on Windows](https://learn.microsoft.com/en-au/windows/curl/) page recommends. If PowerShell refuses to run `Activate.ps1` because running scripts is disabled, the [Python venv documentation](https://docs.python.org/3/library/venv.html) gives the fix: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`. That changes a security setting for your Windows account. If you would rather leave it alone, open Command Prompt and activate with `.venv\Scripts\activate.bat` instead.

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

Start with the [caching track's 100-level workshop](caching/100-caching-intro/). Clone this repository, open `caching/100-caching-intro/python/README.md`, and follow the walkthrough. Its first step changes into the workshop directory from the root of your clone:

```bash
cd caching/100-caching-intro/python
```

## Contributing

We welcome contributions, particularly new language implementations. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Roadmap

See [FUTURE.md](FUTURE.md) for planned tracks and their scope.

## License

[WTFPL](LICENSE)
