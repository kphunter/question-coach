# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import logging
import os
import time
from abc import ABC, abstractmethod
from typing import List

import requests

from .config import EmbeddingConfig


class EmbeddingProvider(ABC):
    """Abstract base class for embedding providers."""

    @abstractmethod
    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for a single text."""
        pass

    @abstractmethod
    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for multiple texts."""
        pass

    @abstractmethod
    def get_embedding_dimension(self) -> int:
        """Get the dimension of embeddings produced by this provider."""
        pass

    @abstractmethod
    def test_connection(self) -> bool:
        """Test if the provider is accessible."""
        pass


class OllamaEmbeddingProvider(EmbeddingProvider):
    """Ollama embedding provider.

    Uses the /api/embed endpoint (Ollama v0.1.26+), which supports native
    batching and is compatible with all current embedding models including
    Gemma3, nomic-embed-text, and mxbai-embed-large.
    """

    _BATCH_SIZE = 32  # max texts per /api/embed request

    def __init__(self, config: EmbeddingConfig):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self._embedding_dimension = None

    def _embed(self, input: "str | List[str]") -> List[List[float]]:
        """Call /api/embed and return a list of embedding vectors."""
        url = f"{self.config.ollama.base_url}/api/embed"
        payload = {"model": self.config.ollama.model, "input": input}
        try:
            response = requests.post(url, json=payload, timeout=self.config.timeout)
            response.raise_for_status()
        except requests.RequestException as e:
            self.logger.debug(f"Ollama /api/embed request failed: {e}")
            raise

        result = response.json()
        embeddings = result.get("embeddings")
        if not embeddings:
            raise ValueError(f"Ollama returned no embeddings for input: {input!r}")

        if self._embedding_dimension is None:
            self._embedding_dimension = len(embeddings[0])

        return embeddings

    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for a single text."""
        return self._embed(text)[0]

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for multiple texts using native batching."""
        all_embeddings: List[List[float]] = []
        total = len(texts)

        for start in range(0, total, self._BATCH_SIZE):
            batch = texts[start : start + self._BATCH_SIZE]
            try:
                batch_embeddings = self._embed(batch)
                all_embeddings.extend(batch_embeddings)
                self.logger.info(
                    f"Embedded {min(start + self._BATCH_SIZE, total)}/{total} texts"
                )
            except Exception as e:
                self.logger.error(
                    f"Batch embedding failed (texts {start}–{start + len(batch) - 1}): {e}"
                )
                raise

        return all_embeddings

    def get_embedding_dimension(self) -> int:
        """Get the dimension of embeddings."""
        if self._embedding_dimension is None:
            self.generate_embedding("test")
        return self._embedding_dimension

    def test_connection(self) -> bool:
        """Test if Ollama is accessible and the configured model is available."""
        try:
            response = requests.get(
                f"{self.config.ollama.base_url}/api/tags", timeout=10
            )
            response.raise_for_status()

            models = response.json().get("models", [])
            # Ollama returns names like "gemma3:2b"; normalise to base name for comparison
            installed = {m.get("name", "") for m in models}
            installed_bases = {n.split(":")[0] for n in installed}
            configured = self.config.ollama.model
            configured_base = configured.split(":")[0]

            if configured not in installed and configured_base not in installed_bases:
                self.logger.error(
                    f"Model '{configured}' not found in Ollama. "
                    f"Run: ollama pull {configured}\n"
                    f"Installed models: {sorted(installed)}"
                )
                return False

            test_embedding = self.generate_embedding("test connection")
            if not test_embedding:
                return False

            self.logger.info(
                f"Ollama connection OK — model: {configured}, "
                f"dimension: {len(test_embedding)}"
            )
            return True

        except Exception as e:
            self.logger.debug(f"Ollama connection test failed: {e}")
            return False


class GeminiEmbeddingProvider(EmbeddingProvider):
    """Google Gemini embedding provider."""

    def __init__(self, config: EmbeddingConfig):
        self.config = config
        self.logger = logging.getLogger(__name__)
        self._embedding_dimension = None

        self.gemini_config = config.gemini
        self.model_name = self.gemini_config.model or "text-embedding-004"

        # Import and configure Gemini (prefer new google-genai SDK, fallback to google-generativeai)
        # Track which SDK we are using
        self._use_new_sdk = False
        try:
            # New SDK (preferred): google-genai
            from google import genai as genai_new  # type: ignore

            api_key = self.gemini_config.api_key or os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise ValueError(
                    "Gemini API key is required. Set it in ai-config.yaml or GEMINI_API_KEY environment variable"
                )

            self.genai_client = genai_new.Client(api_key=api_key)
            self._use_new_sdk = True
        except ImportError:
            # Fallback to the deprecated google-generativeai SDK
            try:
                import google.generativeai as genai_old  # type: ignore

                api_key = self.gemini_config.api_key or os.getenv("GEMINI_API_KEY")
                if not api_key:
                    raise ValueError(
                        "Gemini API key is required. Set it in ai-config.yaml or GEMINI_API_KEY environment variable"
                    )

                genai_old.configure(api_key=api_key)
                self.genai = genai_old
                self._use_new_sdk = False
            except ImportError:
                raise ImportError(
                    "Google Gemini embeddings require either google-genai (preferred) or google-generativeai. "
                    "Install with: pip install google-genai or pip install google-generativeai"
                )

    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for a single text using Gemini."""
        try:
            if getattr(self, "_use_new_sdk", False):
                # New SDK: client.models.embed_content(model="name", contents="text")
                model_name = self._get_new_sdk_model_name()
                result = self.genai_client.models.embed_content(
                    model=model_name,
                    contents=text,
                )
                embedding = list(result.embeddings[0].values)
            else:
                # Old SDK: genai.embed_content(model="models/name", content="text")
                legacy_model = self._get_legacy_model_name()
                response = self.genai.embed_content(
                    model=f"models/{legacy_model}",
                    content=text,
                    task_type="retrieval_document",
                )
                embedding = response["embedding"]

            # Cache dimension on first call
            if self._embedding_dimension is None:
                self._embedding_dimension = len(embedding)

            return embedding

        except Exception as e:
            self.logger.error(f"Error generating Gemini embedding: {e}")
            raise

    def _get_new_sdk_model_name(self) -> str:
        """Normalize model name for the google-genai SDK."""
        model_name = self.model_name
        if not model_name.startswith("models/"):
            model_name = f"models/{model_name}"
        return model_name

    def _get_legacy_model_name(self) -> str:
        """Normalize model name for the google-generativeai SDK."""
        model_name = self.model_name
        if model_name.startswith("models/"):
            model_name = model_name.split("/", 1)[1]
        if model_name == "text-embedding-004":
            return "textembedding-gecko"
        return model_name

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for multiple texts."""
        embeddings = []

        for i, text in enumerate(texts):
            try:
                embedding = self.generate_embedding(text)
                embeddings.append(embedding)

                # Log progress for large batches
                if (i + 1) % 10 == 0:
                    self.logger.info(
                        f"Generated embeddings for {i + 1}/{len(texts)} texts"
                    )

                # Small delay to respect rate limits
                time.sleep(0.1)

            except Exception as e:
                self.logger.error(f"Failed to generate embedding for text {i}: {e}")
                raise

        return embeddings

    def get_embedding_dimension(self) -> int:
        """Get the dimension of embeddings."""
        if self._embedding_dimension is None:
            # Generate a test embedding to determine dimension
            test_embedding = self.generate_embedding("test")
            self._embedding_dimension = len(test_embedding)

        return self._embedding_dimension

    def test_connection(self) -> bool:
        """Test if Gemini API is accessible."""
        try:
            # Test embedding generation
            test_embedding = self.generate_embedding("test connection")
            if len(test_embedding) == 0:
                return False

            self.logger.info(
                f"Gemini connection successful. Model: {self.model_name}, Dimension: {len(test_embedding)}"
            )
            return True

        except Exception as e:
            self.logger.error(f"Gemini connection test failed: {e}")
            return False


class SentenceTransformersEmbeddingProvider(EmbeddingProvider):
    """Sentence Transformers embedding provider."""

    def __init__(self, config: EmbeddingConfig):
        self.config = config
        self.logger = logging.getLogger(__name__)

        if not config.sentence_transformers:
            raise ValueError("Sentence Transformers config is required")

        self.st_config = config.sentence_transformers
        self._model = None
        self._embedding_dimension = None

    def _get_model(self):
        """Lazy load the sentence transformer model."""
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer

                self._model = SentenceTransformer(
                    self.st_config.model, device=self.st_config.device
                )
                self.logger.info(
                    f"Loaded Sentence Transformer model: {self.st_config.model} on {self.st_config.device}"
                )
            except ImportError:
                raise ImportError(
                    "sentence-transformers library is required. Install with: pip install sentence-transformers"
                )
            except Exception as e:
                self.logger.error(f"Failed to load Sentence Transformer model: {e}")
                raise
        return self._model

    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for a single text using Sentence Transformers."""
        try:
            model = self._get_model()
            # Generate embedding and convert to list
            embedding = model.encode(
                text, convert_to_tensor=False, normalize_embeddings=True
            )
            return embedding.tolist()

        except Exception as e:
            self.logger.error(f"Failed to generate embedding: {e}")
            raise

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for multiple texts using Sentence Transformers."""
        try:
            model = self._get_model()
            # Generate embeddings in batch for efficiency
            embeddings = model.encode(
                texts, convert_to_tensor=False, normalize_embeddings=True, batch_size=32
            )
            return embeddings.tolist()

        except Exception as e:
            self.logger.error(f"Failed to generate embeddings: {e}")
            raise

    def get_embedding_dimension(self) -> int:
        """Get the dimension of embeddings."""
        if self._embedding_dimension is None:
            # Get dimension from model configuration
            model = self._get_model()
            self._embedding_dimension = model.get_sentence_embedding_dimension()

        return self._embedding_dimension

    def test_connection(self) -> bool:
        """Test if Sentence Transformers model is accessible."""
        try:
            # Test embedding generation
            test_embedding = self.generate_embedding("test connection")
            if len(test_embedding) == 0:
                return False

            dimension = self.get_embedding_dimension()
            self.logger.info(
                f"Sentence Transformers connection successful. Model: {self.st_config.model}, Dimension: {dimension}, Device: {self.st_config.device}"
            )
            return True

        except Exception as e:
            self.logger.error(f"Sentence Transformers connection test failed: {e}")
            return False


def create_embedding_provider(config: EmbeddingConfig) -> EmbeddingProvider:
    """Factory function to create embedding provider based on config."""
    if config.provider.lower() == "ollama":
        return OllamaEmbeddingProvider(config)
    elif config.provider.lower() == "gemini":
        return GeminiEmbeddingProvider(config)
    elif config.provider.lower() == "sentence_transformers":
        return SentenceTransformersEmbeddingProvider(config)
    else:
        raise ValueError(f"Unknown embedding provider: {config.provider}")
