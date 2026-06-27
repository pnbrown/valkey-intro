# Contributing

We welcome contributions, particularly new language implementations and improvements to existing workshop content.

## Adding a new language implementation

Each workshop level can have multiple language implementations. Cache-aside, TTL, and invalidation are language-agnostic concepts; only the implementation differs.

A new language implementation should:

1. Live in its own directory within the relevant level (e.g., `100-caching-intro/node/`, `200-database-caching/go/`)
2. Include starter files with TODO placeholders that guide the participant
3. Include a `safety/` subdirectory with completed reference files
4. Follow the same five-part progression as the existing Python implementation
5. Include a language-specific `requirements.txt`, `package.json`, `go.mod`, or equivalent dependency file
6. Include a `.env.example` with the same environment variables

A shared `docker-compose.yml` at the level directory handles Valkey (and PostgreSQL, for 200+) containers. Language implementations should not duplicate this.

## Adding a new workshop level

New levels should follow the existing directory structure:

```
NNN-descriptive-name/
├── docker-compose.yml     (shared infrastructure)
├── README.md              (concepts, architecture, walkthrough)
├── FAQ.md                 (design decisions, deeper explanations)
├── TROUBLESHOOTING.md     (common issues and fixes)
└── python/                (or node/, go/, etc.)
    ├── starter files with TODOs
    ├── .env.example
    └── safety/
        └── completed reference files
```

Each level should assume completion of the previous level. We cover concepts once in the README, then direct participants into their chosen language directory for implementation.

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
