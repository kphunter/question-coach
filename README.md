# Question Coach

A chat application that guides undergraduate students through the [Question Formulation Technique (QFT)](https://rightquestion.org/what-is-the-qft/) — a six-stage process for developing and refining research questions.

Built on a RAG pipeline backed by [Qdrant](https://qdrant.tech/) and [Ollama](https://ollama.com/), with [Gemini](https://ai.google.dev/) for chat generation.

## How it works

| Concern | Tool |
|---|---|
| Embeddings (ingestion + search) | Ollama · `nomic-embed-text` (local, auto-pulled) |
| Chat generation | Gemini API |
| Vector store | Qdrant |
| Frontend | React + Vite, served via Nginx |

## Prerequisites

- Docker Desktop
- A [Gemini API key](https://ai.google.dev/) (free tier is sufficient)
- Documents to index in `inputs/docs/` (`.md` or `.html`)

## Quick start

### 1. Clone and export your API key

```bash
git clone <repo-url>
cd question-coach
export GEMINI_API_KEY=your-key-here
```

Docker Compose reads the key directly from your shell — no `.env` file needed.
Add the export to your shell profile (`~/.zshrc`, `~/.bashrc`) to make it permanent.

### 2. Start services

```bash
docker compose up --build -d
```

This starts Qdrant, Ollama, the API, and the frontend. On the first run Docker pulls the `ollama/ollama` image (~2–3 GB, cached after that). Once Ollama is up, a one-shot `ollama-pull` container downloads `nomic-embed-text` (~274 MB) and exits — subsequent starts skip the download because the model is stored in a named volume.

Watch progress:

```bash
docker compose logs -f ollama ollama-pull
```

### 3. Index your documents

Place `.md` or `.html` files in `inputs/docs/`, then:

```bash
./bin/ingest reindex-all
```

The script waits for Qdrant and Ollama to be ready before running, so it is safe to call immediately after `docker compose up`.

### 4. Open the app

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| API docs | http://localhost:8000/docs |
| Qdrant dashboard | http://localhost:6333/dashboard |

---

## Ingestion commands

All commands run inside Docker via `./bin/ingest <command>`.

```bash
# Index everything in inputs/docs/ and inputs/fetched/
./bin/ingest reindex-all

# Index only new or changed documents
./bin/ingest process-new

# Fetch a web article and ingest it
./bin/fetch-ingest 'https://example.com/article'

# Search the knowledge base
./bin/ingest search "your query"

# Remove all indexed documents
./bin/ingest clear-all

# List indexed documents
./bin/ingest list-documents

# Show collection stats
./bin/ingest stats

# Save a snapshot of the vector index
./bin/ingest snapshot                          # auto-named to inputs/snapshots/
./bin/ingest snapshot path/to/my-backup.snapshot

# Restore the vector index from a snapshot
./bin/ingest restore path/to/my-backup.snapshot
```

Snapshots are saved inside the container at the path you specify (relative to `/app`). Because the `inputs/` directory is mounted as a volume, saving to `inputs/snapshots/` (the default) writes directly to your local filesystem.

---

## Changing the embedding model

The active model is set in `ingestion-config.yaml`:

```yaml
embedding:
  ollama:
    model: "nomic-embed-text"   # default — 768 dims, ~274 MB
    # mxbai-embed-large         — 1024 dims, ~670 MB, stronger MTEB scores
    # gemma3:2b                 — 2048 dims, ~1.7 GB
```

To add a model to the auto-pull list, update the `entrypoint` of the `ollama-pull` service in `docker-compose.yml`.

**Switching models changes vector dimensions.** Clear the old collection first:

```bash
./bin/ingest clear-all
# update model in ingestion-config.yaml and collection_name in vector_db section
./bin/ingest reindex-all
```

---

## Folder structure

```
inputs/
├── docs/        # Source documents to index (.md, .html)
├── fetched/     # Articles saved by ./bin/fetch-ingest
agents/
├── prompts/     # System prompt components and per-stage instructions
├── CONFIG.json  # Agent tone and guardrail settings
src/             # Ingestion pipeline (embeddings, chunking, vector store)
api/             # FastAPI server
frontend-react/  # React + Vite frontend
```

## Customising the agent

The system prompt is assembled from files in `agents/prompts/`. See [`agents/prompts/SYSTEM_PROMPT.md`](agents/prompts/SYSTEM_PROMPT.md) for the full assembly order, including how Qdrant context is injected at request time.

| To change … | Edit |
|---|---|
| Agent role and rules | `agents/QC-AGENT.md` |
| Persona and tone | `agents/IDENTITY.md`, `agents/SOUL.md` |
| Per-stage instructions | `agents/prompts/stages/stage-*.md` |
| Guardrails | `agents/POLICIES.md` |
| Audience context | `agents/USER.md` |
