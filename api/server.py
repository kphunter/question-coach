"""
FastAPI server for Document Embeddings Pipeline.

This server provides REST API endpoints to interact with the RAG pipeline,
enabling search queries with context-enhanced responses using Gemini.
"""

import os
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime
import json

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import logging
import yaml

# Add parent directory to path to import pipeline modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config import Config, load_config
from src.pipeline import IngestionPipeline


# Request/Response Models
class SearchRequest(BaseModel):
    query: str = Field(..., description="The search query text")
    limit: int = Field(default=5, ge=1, le=20, description="Maximum number of results")
    threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="Minimum score threshold")
    strategy: str = Field(default="auto", description="Search strategy: auto, semantic, exact, hybrid_rrf, hybrid_weighted")
    dense_weight: float = Field(default=0.7, ge=0.0, le=1.0, description="Dense weight for hybrid_weighted strategy")


class SearchResult(BaseModel):
    score: float
    chunk_text: str
    source_url: str
    chunk_index: int
    title: Optional[str] = None
    author: Optional[str] = None
    publication_date: Optional[str] = None
    tags: List[str] = []


class SearchResponse(BaseModel):
    query: str
    strategy: str
    results: List[SearchResult]
    context: str
    sources: List[Dict[str, Any]]


class ChatRequest(BaseModel):
    message: str = Field(..., description="User message/question")
    search_limit: int = Field(default=5, ge=1, le=20, description="Number of context chunks to retrieve")
    search_strategy: str = Field(default="auto", description="Search strategy for context retrieval")
    use_gemini: bool = Field(default=True, description="Whether to use Gemini for response generation")
    gemini_model: str = Field(default="gemini-1.5-flash", description="Gemini model to use")
    system_prompt: Optional[str] = Field(default=None, description="System prompt to prepend to the LLM request")


class ChatResponse(BaseModel):
    message: str
    response: str
    context_used: str
    sources: List[Dict[str, Any]]
    timestamp: str


class HealthResponse(BaseModel):
    status: str
    services: Dict[str, bool]
    collection_exists: bool
    collection_count: Optional[int] = None


class CapabilitiesResponse(BaseModel):
    semantic_search: bool
    exact_phrase_search: bool
    hybrid_search: bool
    native_fusion: bool
    sparse_vectors_enabled: bool


# Initialize FastAPI app
app = FastAPI(
    title="Document Embeddings RAG API",
    description="REST API for document search and RAG-enhanced chat using embeddings pipeline",
    version="1.0.0",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize pipeline
config_path = Path(__file__).parent.parent / "ingestion-config.yaml"
if not config_path.exists():
    raise RuntimeError(f"Configuration file not found: {config_path}")

config = load_config(str(config_path))
pipeline = IngestionPipeline(config)

AGENTS_DIR = Path(__file__).parent.parent / "agents"
PROMPTS_DIR = AGENTS_DIR / "prompts"
STAGES_DIR = PROMPTS_DIR / "stages"
GLOBAL_PROMPT_FILES = [
    "QC-AGENT.md",
    "IDENTITY.md",
    "POLICIES.md",
    "USER.md",
]
EXAMPLES_FILE = PROMPTS_DIR / "EXAMPLES.md"
AGENT_CONFIG_FILE = AGENTS_DIR / "CONFIG.json"


def _read_agent_file(path: Path) -> Optional[str]:
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return None


def _load_agent_config(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    raw = path.read_text(encoding="utf-8")
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end < start:
        return {}
    try:
        return json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return {}


_global_prompt_parts = [
    _read_agent_file(AGENTS_DIR / filename) for filename in GLOBAL_PROMPT_FILES
]
_global_prompt_parts = [part for part in _global_prompt_parts if part]

AGENT_CONFIG = _load_agent_config(AGENT_CONFIG_FILE) or {}
if not isinstance(AGENT_CONFIG, dict):
    AGENT_CONFIG = {}

tone_defaults = AGENT_CONFIG.get("tone_defaults")
if isinstance(tone_defaults, dict) and tone_defaults:
    tone_lines = [
        "Tone Defaults:",
        *[
            f"- {key.replace('_', ' ').title()}: {value}"
            for key, value in tone_defaults.items()
        ],
    ]
    _global_prompt_parts.append("\n".join(tone_lines))

GLOBAL_AGENT_PROMPT = "\n\n".join(_global_prompt_parts).strip()
EXAMPLES_PROMPT = _read_agent_file(EXAMPLES_FILE)
if EXAMPLES_PROMPT:
    EXAMPLES_PROMPT = EXAMPLES_PROMPT.strip()


def build_system_prompt(stage_prompt: Optional[str]) -> Optional[str]:
    parts = []
    if GLOBAL_AGENT_PROMPT:
        parts.append(GLOBAL_AGENT_PROMPT)
    if stage_prompt:
        parts.append(stage_prompt.strip())
    if EXAMPLES_PROMPT:
        parts.append(EXAMPLES_PROMPT)
    combined = "\n\n".join(parts).strip()
    return combined or None

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def format_sources(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Format search results into source citations."""
    sources = []
    for i, result in enumerate(results, 1):
        payload = result.get("payload", {})
        source = {
            "index": i,
            "title": payload.get("title") or extract_filename(payload.get("source_url", "")),
            "url": payload.get("source_url", ""),
            "score": result.get("score", 0.0),
            "author": payload.get("author"),
            "publication_date": payload.get("publication_date"),
            "tags": payload.get("tags", []),
        }
        sources.append(source)
    return sources


def extract_filename(source_url: str) -> str:
    """Extract readable filename from source URL."""
    if not source_url:
        return "Unknown"

    # Handle file:// URLs
    if source_url.startswith("file://"):
        return Path(source_url.replace("file://", "")).name

    # Handle http(s):// URLs
    if source_url.startswith("http"):
        parts = source_url.rstrip("/").split("/")
        return parts[-1] if parts[-1] else "Web Document"

    # Fallback to path handling
    return Path(source_url).name


async def generate_gemini_response(
    user_message: str,
    context: str,
    sources: List[Dict[str, Any]],
    model: str = "gemini-1.5-flash",
    system_prompt: Optional[str] = None,
) -> str:
    """Generate response using Gemini with retrieved context."""
    try:
        import google.generativeai as genai
    except ImportError:
        logger.warning("google-generativeai not available, using fallback response")
        return f"Context retrieved successfully. {len(sources)} relevant sources found."

    # Get API key
    api_key = os.getenv("GEMINI_API_KEY") or config.llm.gemini.api_key if hasattr(config.llm, "gemini") else None
    if not api_key:
        logger.warning("Gemini API key not found, using fallback response")
        return f"Context retrieved successfully. {len(sources)} relevant sources found. (Gemini API key required for enhanced responses)"

    try:
        genai.configure(api_key=api_key)

        # Use system_prompt for Gemini's system_instruction if provided
        model_kwargs = {}
        if system_prompt:
            model_kwargs["system_instruction"] = system_prompt

        model_instance = genai.GenerativeModel(model, **model_kwargs)

        # Build prompt with context
        source_list = "\n".join([f"[{s['index']}] {s['title']}" for s in sources])

        if context:
            prompt = f"""CONTEXT FROM KNOWLEDGE BASE:
{context}

SOURCES:
{source_list}

USER MESSAGE:
{user_message}

Use the context above to inform your response where relevant. Cite sources using [1], [2], etc. when referencing retrieved content."""
        else:
            prompt = user_message

        response = model_instance.generate_content(prompt)
        return response.text

    except Exception as e:
        logger.error(f"Error generating Gemini response: {e}")
        return f"I found relevant context in the knowledge base, but encountered an error generating the response: {str(e)}"


@app.get("/", response_model=Dict[str, str])
async def root():
    """Root endpoint with API information."""
    return {
        "message": "Document Embeddings RAG API",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check health status of all services."""
    try:
        # Test connections
        services = pipeline.test_connections()

        # Check collection
        collection_info = pipeline.check_collection()
        collection_exists = collection_info.get("exists", False)
        collection_count = collection_info.get("vectors_count")

        status_str = "healthy" if all(services.values()) and collection_exists else "degraded"

        return HealthResponse(
            status=status_str,
            services=services,
            collection_exists=collection_exists,
            collection_count=collection_count,
        )
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Health check failed: {str(e)}",
        )


@app.get("/capabilities", response_model=CapabilitiesResponse)
async def get_capabilities():
    """Get search capabilities of the current setup."""
    try:
        caps = pipeline.search_service.get_capabilities()
        return CapabilitiesResponse(**caps)
    except Exception as e:
        logger.error(f"Failed to get capabilities: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get capabilities: {str(e)}",
        )


@app.get("/stages", response_model=List[Dict[str, Any]])
async def get_stages():
    """Return per-stage configuration from agents/prompts/stages/manifest.yaml."""
    manifest_path = STAGES_DIR / "manifest.yaml"
    if not manifest_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="stages manifest not found",
        )
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = yaml.safe_load(f) or {}

        stages = []
        for entry in manifest.get("stages", []):
            prompt_file = STAGES_DIR / entry["prompt_file"]
            system_prompt = _read_agent_file(prompt_file)
            stages.append({
                "id": entry["id"],
                "name": entry["name"],
                "system_prompt": system_prompt,
            })
        return stages
    except Exception as e:
        logger.error(f"Failed to load stages: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load stages configuration: {str(e)}",
        )


@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """
    Search the knowledge base with the given query.

    Returns relevant document chunks with scores and metadata.
    """
    try:
        logger.info(f"Search request: query='{request.query}', strategy={request.strategy}, limit={request.limit}")

        # Get capabilities to validate strategy
        capabilities = pipeline.search_service.get_capabilities()

        # Execute search based on strategy
        if request.strategy == "auto":
            if not capabilities.get("semantic_search"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Auto search not available (semantic search required)",
                )
            results = pipeline.search_service.search_auto(
                request.query, request.limit, score_threshold=request.threshold
            )
        elif request.strategy == "semantic":
            if not capabilities.get("semantic_search"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Semantic search not available",
                )
            results = pipeline.search_service.search_semantic(
                request.query, request.limit, score_threshold=request.threshold
            )
        elif request.strategy == "exact":
            if not capabilities.get("exact_phrase_search"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Exact phrase search not available (requires sparse vectors)",
                )
            results = pipeline.search_service.search_exact(
                request.query, request.limit, score_threshold=request.threshold
            )
        elif request.strategy in ["hybrid_rrf", "hybrid_weighted"]:
            if not capabilities.get("hybrid_search"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Hybrid search not available (requires sparse vectors)",
                )
            fusion = "rrf" if request.strategy == "hybrid_rrf" else "weighted"
            results = pipeline.search_service.search_hybrid(
                request.query,
                fusion,
                request.limit,
                score_threshold=request.threshold,
                dense_weight=request.dense_weight if fusion == "weighted" else None,
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown search strategy: {request.strategy}",
            )

        # Format results
        search_results = []
        for result in results:
            payload = result.get("payload", {})
            search_results.append(SearchResult(
                score=result.get("score", 0.0),
                chunk_text=payload.get("chunk_text", ""),
                source_url=payload.get("source_url", ""),
                chunk_index=payload.get("chunk_index", 0),
                title=payload.get("title"),
                author=payload.get("author"),
                publication_date=payload.get("publication_date"),
                tags=payload.get("tags", []),
            ))

        # Build context string
        context = "\n\n".join([r.chunk_text for r in search_results])

        # Format sources
        sources = format_sources(results)

        logger.info(f"Search completed: {len(search_results)} results found")

        return SearchResponse(
            query=request.query,
            strategy=request.strategy,
            results=search_results,
            context=context,
            sources=sources,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}",
        )


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Chat endpoint that retrieves context and generates enhanced responses.

    This endpoint:
    1. Searches the knowledge base for relevant context
    2. Optionally uses Gemini to generate a context-aware response
    3. Returns the response with sources
    """
    max_input_length = AGENT_CONFIG.get("max_input_length")
    max_len_value: Optional[int] = None
    if max_input_length is not None:
        try:
            max_len_value = int(max_input_length)
        except (TypeError, ValueError):
            max_len_value = None
    if max_len_value and len(request.message) > max_len_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Input exceeds maximum allowed length of {max_len_value} characters.",
        )

    system_prompt = build_system_prompt(request.system_prompt)

    try:
        logger.info(f"Chat request: message='{request.message[:100]}...', use_gemini={request.use_gemini}")

        # Search for relevant context
        results = pipeline.search_service.search_auto(
            request.message,
            request.search_limit,
            score_threshold=None,
        )

        # Build context
        context_parts = []
        for result in results:
            payload = result.get("payload", {})
            context_parts.append(payload.get("chunk_text", ""))

        context = "\n\n".join(context_parts)
        sources = format_sources(results)

        # Generate response
        if request.use_gemini and context:
            response_text = await generate_gemini_response(
                request.message,
                context,
                sources,
                request.gemini_model,
                system_prompt=system_prompt,
            )
        else:
            # Simple fallback response
            if context:
                response_text = f"I found {len(results)} relevant sources in the knowledge base. Here's what I found:\n\n{context[:500]}..."
            else:
                response_text = "I couldn't find relevant information in the knowledge base to answer your question."

        logger.info(f"Chat completed: {len(results)} context chunks used")

        return ChatResponse(
            message=request.message,
            response=response_text,
            context_used=context,
            sources=sources,
            timestamp=datetime.utcnow().isoformat(),
        )

    except Exception as e:
        logger.error(f"Chat failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Chat failed: {str(e)}",
        )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("API_PORT", "8000"))
    host = os.getenv("API_HOST", "0.0.0.0")

    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run(app, host=host, port=port)
