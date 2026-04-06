# Inputs Directory

All source material for the knowledge base lives under this directory.

## Structure

```
inputs/
├── docs/        # Markdown and other authored notes
├── fetched/     # Articles captured with ./bin/fetch-ingest
├── links.txt    # URLs to fetch in bulk (one per line, # for comments)
└── snapshots/   # Vector store snapshots (created via ./bin/ingest snapshot)
```

## Workflow

1. **Add handwritten notes**  
   Drop Markdown (or other supported formats) into `docs/`.

2. **Fetch web content**  
   Pass URLs directly, or add them to `links.txt` and run with no arguments:
   ```
   ./bin/fetch-ingest 'https://example.com/article'   # single URL
   ./bin/fetch-ingest                                   # reads inputs/links.txt
   ```
   Fetched articles are saved as structured JSON into `fetched/`. Both forms
   automatically run `process-new` afterwards, so no separate ingest step is needed.

3. **Incremental ingest (manual)**  
   Run `./bin/ingest process-new` to embed only documents that are new or have changed,
   without re-fetching anything.

4. **Full rebuild**  
   Run `./bin/ingest reindex-all` to wipe and reprocess everything from scratch.

## Incremental Marker

The ingestion pipeline records the timestamp of the last incremental run in `inputs/.last_incremental_run`.  
Leave this file in place—deleting it forces the next `process-new` run to assume every document is new.
