# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

from typing import List, Optional
import os
import yaml
from pydantic import BaseModel
from pathlib import Path


class DocumentsConfig(BaseModel):
    folder_path: str
    supported_extensions: List[str]
    chunk_size: int = 1000
    chunk_overlap: int = 200
    ignored_directories: List[str] = [
        ".obsidian",
        ".git",
        "__pycache__",
        "node_modules",
    ]
    ignored_file_patterns: List[str] = [
        ".DS_Store",
        "Thumbs.db",
        ".last_incremental_run",
    ]
    additional_folders: List[str] = []
    ignore_hidden_files: bool = True


class OllamaEmbeddingConfig(BaseModel):
    model: str = "nomic-embed-text"
    base_url: str = "http://localhost:11434"


class GeminiEmbeddingConfig(BaseModel):
    api_key: str = ""
    model: str = "text-embedding-004"


class SentenceTransformersConfig(BaseModel):
    model: str = "all-MiniLM-L6-v2"
    device: str = "cpu"


class OllamaLLMConfig(BaseModel):
    model: str = "llama3.2"
    base_url: str = "http://localhost:11434"


class GeminiLLMConfig(BaseModel):
    api_key: str = ""
    model: str = "gemini-2.5-flash"


class SpladeConfig(BaseModel):
    model: str = "naver/splade-cocondenser-ensembledistil"
    device: str = "cpu"  # "cpu", "cuda", "mps" (for Apple Silicon)


class SparseEmbeddingConfig(BaseModel):
    provider: str = "splade"  # Currently only "splade" supported, future: "bm25", etc.
    splade: Optional[SpladeConfig] = None


class EmbeddingConfig(BaseModel):
    provider: str = "ollama"
    timeout: int = 60
    ollama: OllamaEmbeddingConfig = OllamaEmbeddingConfig()
    gemini: GeminiEmbeddingConfig = GeminiEmbeddingConfig()
    sentence_transformers: SentenceTransformersConfig = SentenceTransformersConfig()


class LLMConfig(BaseModel):
    enabled: bool = True
    provider: str = "ollama"
    timeout: int = 120
    content_max_chars: int = 8000
    auto_detect_context_limit: bool = True
    context_utilization: float = 0.25
    ollama: OllamaLLMConfig = OllamaLLMConfig()
    gemini: GeminiLLMConfig = GeminiLLMConfig()
    metadata_extraction_prompt: str = """You are a metadata extraction assistant. Your task is to analyze the provided document and extract specific metadata fields.

Return a valid JSON object with these exact fields:

{{
  "author": "string or null",
  "title": "string",
  "publication_date": "YYYY-MM-DD or null",
  "tags": ["topic1", "topic2", "topic3"]
}}

Guidelines:
- Author: Look for "By [Name]", "Author: [Name]", "[Name] writes", or extract from URL paths like "/authors/name/" or "/john-doe/"
- Title: Extract from content headers/titles, or clean filename (remove dates, convert dashes to spaces)
- Date: Find "Published", "Posted", dates like "Jan 2025", "2025-01-20", "January 20, 2025", or YYYY-MM-DD in filename
- Tags: Extract 3-7 relevant keywords/topics from the actual content
- Return valid JSON only, no other text

Document to analyze:
SOURCE URL: {source_url}
FILENAME: {filename}
CONTENT: {content}"""
    max_retries: int = 3
    requests_per_minute: int = 0


class VectorDBConfig(BaseModel):
    provider: str = "qdrant"
    # Local Qdrant settings
    host: str = "localhost"
    port: int = 6333
    # Cloud Qdrant settings (takes precedence if provided)
    url: Optional[str] = None
    api_key: Optional[str] = None
    # Common settings
    collection_name: str = "documents"
    distance_metric: str = "cosine"


class LoggingConfig(BaseModel):
    level: str = "INFO"


class Config(BaseModel):
    documents: DocumentsConfig
    embedding: EmbeddingConfig
    sparse_embedding: Optional[SparseEmbeddingConfig] = None
    llm: Optional[LLMConfig] = None
    vector_db: VectorDBConfig
    logging: LoggingConfig

    @classmethod
    def from_env(cls) -> "Config":
        """Create configuration from environment variables."""
        return cls(
            documents=DocumentsConfig(
                folder_path=os.getenv("DOCUMENTS_FOLDER", "./documents"),
                supported_extensions=[".txt", ".docx", ".pdf", ".md", ".html"],
                chunk_size=int(os.getenv("CHUNK_SIZE", "1000")),
                chunk_overlap=int(os.getenv("CHUNK_OVERLAP", "200")),
                ignored_directories=[
                    d.strip()
                    for d in os.getenv(
                        "IGNORED_DIRECTORIES",
                        ".obsidian,.git,__pycache__,node_modules",
                    ).split(",")
                    if d.strip()
                ],
                ignored_file_patterns=[
                    p.strip()
                    for p in os.getenv(
                        "IGNORED_FILE_PATTERNS",
                        ".DS_Store,Thumbs.db,.last_incremental_run",
                    ).split(",")
                    if p.strip()
                ],
                additional_folders=[
                    path.strip()
                    for path in os.getenv(
                        "DOCUMENTS_ADDITIONAL_FOLDERS", ""
                    ).split(",")
                    if path.strip()
                ],
                ignore_hidden_files=os.getenv("IGNORE_HIDDEN_FILES", "true").lower()
                == "true",
            ),
            embedding=EmbeddingConfig(
                provider=os.getenv("EMBEDDING_PROVIDER", "ollama"),
                timeout=int(os.getenv("EMBEDDING_TIMEOUT", "60")),
                ollama=OllamaEmbeddingConfig(
                    model=os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text"),
                    base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
                ),
                gemini=GeminiEmbeddingConfig(
                    api_key=os.getenv("GEMINI_API_KEY", ""),
                    model=os.getenv("GEMINI_EMBEDDING_MODEL", "text-embedding-004"),
                ),
                sentence_transformers=SentenceTransformersConfig(
                    model=os.getenv("SENTENCE_TRANSFORMERS_MODEL", "all-MiniLM-L6-v2"),
                    device=os.getenv("SENTENCE_TRANSFORMERS_DEVICE", "cpu"),
                ),
            ),
            sparse_embedding=SparseEmbeddingConfig(
                provider=os.getenv("SPARSE_EMBEDDING_PROVIDER", "splade"),
                splade=SpladeConfig(
                    model=os.getenv(
                        "SPLADE_MODEL", "naver/splade-cocondenser-ensembledistil"
                    ),
                    device=os.getenv("SPLADE_DEVICE", "cpu"),
                )
                if os.getenv("SPARSE_EMBEDDING_PROVIDER", "splade") == "splade"
                else None,
            )
            if os.getenv("SPARSE_EMBEDDING_PROVIDER")
            else None,
            llm=LLMConfig(
                enabled=os.getenv("LLM_ENABLED", "true").lower() == "true",
                provider=os.getenv("LLM_PROVIDER", "ollama"),
                timeout=int(os.getenv("LLM_TIMEOUT", "120")),
                content_max_chars=int(os.getenv("LLM_CONTENT_MAX_CHARS", "8000")),
                auto_detect_context_limit=os.getenv("LLM_AUTO_DETECT_CONTEXT", "true").lower() == "true",
                context_utilization=float(os.getenv("LLM_CONTEXT_UTILIZATION", "0.25")),
                ollama=OllamaLLMConfig(
                    model=os.getenv("OLLAMA_LLM_MODEL", "llama3.2"),
                    base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
                ),
                gemini=GeminiLLMConfig(
                    api_key=os.getenv("GEMINI_API_KEY", ""),
                    model=os.getenv("GEMINI_LLM_MODEL", "gemini-2.5-flash"),
                ),
                max_retries=int(os.getenv("LLM_MAX_RETRIES", "3")),
                requests_per_minute=int(os.getenv("LLM_REQUESTS_PER_MINUTE", "0")),
            ),
            vector_db=VectorDBConfig(
                provider=os.getenv("VECTOR_DB_PROVIDER", "qdrant"),
                host=os.getenv("QDRANT_HOST", "localhost"),
                port=int(os.getenv("QDRANT_PORT", "6333")),
                url=os.getenv("QDRANT_URL"),
                api_key=os.getenv("QDRANT_API_KEY"),
                collection_name=os.getenv("COLLECTION_NAME", "documents"),
                distance_metric=os.getenv("DISTANCE_METRIC", "cosine"),
            ),
            logging=LoggingConfig(level=os.getenv("LOG_LEVEL", "INFO")),
        )


def load_config(config_path: str = "ai-config.yaml") -> Config:
    """Load configuration from YAML, with env vars overlaid for secrets and provider selection."""
    config_file = Path(config_path)

    config_data: dict = {}
    if config_file.exists():
        with open(config_file, "r") as f:
            config_data = yaml.safe_load(f) or {}

    docs = config_data.setdefault("documents", {})
    if os.getenv("DOCUMENTS_FOLDER"):
        docs["folder_path"] = os.getenv("DOCUMENTS_FOLDER")
    if os.getenv("DOCUMENTS_ADDITIONAL_FOLDERS"):
        docs["additional_folders"] = [
            path.strip()
            for path in os.getenv(
                "DOCUMENTS_ADDITIONAL_FOLDERS", ""
            ).split(",")
            if path.strip()
        ]

    # Overlay env vars for fields that belong in .env
    emb = config_data.setdefault("embedding", {})
    if os.getenv("EMBEDDING_PROVIDER"):
        emb["provider"] = os.getenv("EMBEDDING_PROVIDER")
    if os.getenv("OLLAMA_BASE_URL") or os.getenv("OLLAMA_EMBEDDING_MODEL"):
        ol = emb.setdefault("ollama", {})
        if os.getenv("OLLAMA_BASE_URL"):
            ol["base_url"] = os.getenv("OLLAMA_BASE_URL")
        if os.getenv("OLLAMA_EMBEDDING_MODEL"):
            ol["model"] = os.getenv("OLLAMA_EMBEDDING_MODEL")
    if os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_EMBEDDING_MODEL"):
        gem = emb.setdefault("gemini", {})
        if os.getenv("GEMINI_API_KEY"):
            gem["api_key"] = os.getenv("GEMINI_API_KEY")
        if os.getenv("GEMINI_EMBEDDING_MODEL"):
            gem["model"] = os.getenv("GEMINI_EMBEDDING_MODEL")

    llm = config_data.setdefault("llm", {})
    if os.getenv("LLM_PROVIDER"):
        llm["provider"] = os.getenv("LLM_PROVIDER")
    if os.getenv("OLLAMA_BASE_URL") or os.getenv("OLLAMA_LLM_MODEL"):
        ol = llm.setdefault("ollama", {})
        if os.getenv("OLLAMA_BASE_URL"):
            ol["base_url"] = os.getenv("OLLAMA_BASE_URL")
        if os.getenv("OLLAMA_LLM_MODEL"):
            ol["model"] = os.getenv("OLLAMA_LLM_MODEL")
    if os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_LLM_MODEL"):
        gem = llm.setdefault("gemini", {})
        if os.getenv("GEMINI_API_KEY"):
            gem["api_key"] = os.getenv("GEMINI_API_KEY")
        if os.getenv("GEMINI_LLM_MODEL"):
            gem["model"] = os.getenv("GEMINI_LLM_MODEL")

    vdb = config_data.setdefault("vector_db", {})
    if os.getenv("QDRANT_HOST"):
        vdb["host"] = os.getenv("QDRANT_HOST")
    if os.getenv("QDRANT_PORT"):
        vdb["port"] = int(os.getenv("QDRANT_PORT"))
    if os.getenv("QDRANT_URL"):
        vdb["url"] = os.getenv("QDRANT_URL")
    if os.getenv("QDRANT_API_KEY"):
        vdb["api_key"] = os.getenv("QDRANT_API_KEY")
    if os.getenv("COLLECTION_NAME"):
        vdb["collection_name"] = os.getenv("COLLECTION_NAME")

    if os.getenv("LOG_LEVEL"):
        config_data.setdefault("logging", {})["level"] = os.getenv("LOG_LEVEL")

    return Config(**config_data)
