# Inputs Directory

All source material for the knowledge base lives under this directory.

## Structure

```
inputs/
├── docs/       # Markdown and other authored notes
├── fetched/    # Articles captured with ./bin/fetch-ingest
└── snapshots/  # Vector store snapshots (created via ./bin/ingest snapshot)
```

## Workflow

1. **Add handwritten notes**  
   Drop Markdown (or other supported formats) into `docs/`.

2. **Fetch web content**  
   Run `./bin/fetch-ingest <url>` to save structured JSON into `fetched/`.

3. **Incremental ingest**  
   Run `./bin/ingest process-new` to embed only the documents that are new or have changed.

4. **Full rebuild**  
   Run `./bin/ingest reindex-all` to wipe and reprocess everything from scratch.

## Incremental Marker

The ingestion pipeline records the timestamp of the last incremental run in `inputs/.last_incremental_run`.  
Leave this file in place—deleting it forces the next `process-new` run to assume every document is new.
