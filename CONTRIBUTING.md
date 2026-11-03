# Contributing

We welcome contributions, particularly new language implementations and improvements to existing workshop content.

## Adding a new language implementation

Each workshop level can have multiple language implementations. Cache-aside, TTL, and invalidation are language-agnostic concepts; only the implementation differs.

A new language implementation should:

1. Live in its own directory within the relevant level (e.g., `caching/100-caching-intro/node/`, `caching/200-database-caching/go/`)
2. Include starter files with minimal placeholders that point to the matching step in the walkthrough, so the walkthrough is the single source of truth for implementation code
3. Include a `safety/` subdirectory with completed reference files
4. Follow the same progression as the existing Python implementation for that level
5. Include a language-specific `requirements.txt`, `package.json`, `go.mod`, or equivalent dependency file
6. Include a `.env.example` with the same environment variables

A shared `docker-compose.yml` at the level directory handles Valkey (and PostgreSQL, for 200+) containers. Language implementations should not duplicate this.

## Adding a new workshop level

New levels live inside their track directory and follow the existing structure:

```
caching/
└── NNN-descriptive-name/
    ├── docker-compose.yml     (shared infrastructure)
    ├── README.md              (short overview and language implementation table)
    └── python/                (or node/, go/, etc.)
        ├── README.md          (concepts, architecture, walkthrough)
        ├── FAQ.md             (design decisions, deeper explanations)
        ├── TROUBLESHOOTING.md (common issues and fixes)
        ├── .env.example
        ├── starter files with placeholders
        └── safety/
            └── completed reference files
```

Each level should assume completion of the previous level. The level README gives a short overview and lists the available language implementations. The full walkthrough lives in each language directory.

## Improving existing content

If you find errors, unclear instructions, or missing troubleshooting entries, open an issue or submit a fix directly. Keep in mind that our audience is developers who may be new to caching but are not new to programming.

## Style guidelines

Workshop content follows these conventions:

- Narrative prose over bullet points (except where a list genuinely makes sense)
- Direct language without hedging ("this does X" not "this might help with X")
- All code blocks should be complete and copy-pasteable
- Cite sources when referencing external documentation
- "Open source" is always two words, never hyphenated

## License

Contributions are released under the same [WTFPL](LICENSE) license as the rest of the repository.
