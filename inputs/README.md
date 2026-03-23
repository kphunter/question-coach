# Inputs Directory

All source material for vectorization goes here.

## Structure

```
inputs/
├── docs/       # Markdown and text documents
└── fetched/    # Articles fetched from URLs (JSON/HTML)
```

## Usage

**Add documents**: Place files in `docs/` subdirectory
**Fetch articles**: Use `./bin/fetch-ingest <url>`
**Index content**: Run `./bin/ingest reindex-all`

All subdirectories are indexed together into the vector database.
