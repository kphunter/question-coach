# Question Coach

> Opinionated and customized version of [able-wong/doc-embeddings-pipeline](https://github.com/able-wong/doc-embeddings-pipeline/).

A Python-based chat application to help undergraduate students develop and refine research questions.

## Features:

- ingestion and vector storage based on [Qdrant](https://qdrant.tech/documentation/overview/)
- request contextualization and transformation using [doc-embeddings-pipeline](https://github.com/able-wong/doc-embeddings-pipeline/)
- agent personalization and prompt parameterization
- basic frontend that guides students through a QFT-based discussion

## Prerequisites

- Docker Desktop
- Git
- Documents (".md", ".txt", ".docx", ".rtf", ".pdf") in /inputs/docs
- Gemini API key (get one free at https://ai.google.dev/) OR Ollama configuration (coming soon).

## Quick Start

### 1. Configure
```bash
cp .env.example .env
# Edit .env and add GEMINI_API_KEY
```

### 2. Start
`docker compose up -d --build`

##### Access

- Frontend: http://localhost:3000
- API: http://localhost:8000/docs
- Qdrant: http://localhost:6333/dashboard

## Ingestion

```bash
# Index all documents in inputs/docs/
./bin/ingest reindex-all

# Index new/changed documents only
./bin/ingest process-new

# Fetch a web article (saved to inputs/fetched for incremental ingestion)
./bin/fetch-ingest https://example.com/article

# Search the knowledge base
./bin/ingest search "query"

# Clear all indexed documents
./bin/ingest clear-all

# List indexed documents
./bin/ingest list-documents

# Show collection stats
./bin/ingest stats

# Show search capabilities
./bin/ingest search-capabilities
```


## Folder Structure

```
inputs/
├── docs/       # Markdown documents to index
├── fetched/    # Articles fetched from URLs
```

Place documents in `inputs/docs/` or fetch new articles into `inputs/fetched/` (included via `documents.additional_folders`) and then run `./bin/ingest reindex-all`.




## Using Ollama

Uncomment `ollama` service in `docker-compose.yml`, then:

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull nomic-embed-text
docker compose exec ollama ollama pull llama3.2
```

Update `.env`:
```bash
EMBEDDING_PROVIDER=ollama
LLM_PROVIDER=ollama
```
