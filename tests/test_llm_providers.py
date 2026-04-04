# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Tests for LLM providers."""

import json
import sys
import types
from contextlib import contextmanager
from unittest.mock import Mock, patch

import pytest

from src.config import GeminiLLMConfig, LLMConfig
from src.llm_providers import GeminiLLMProvider, OllamaLLMProvider, create_llm_provider


@contextmanager
def _temporary_modules(modules):
    saved = {}
    try:
        for name, module in modules.items():
            if name in sys.modules:
                saved[name] = sys.modules[name]
            sys.modules[name] = module
        yield
    finally:
        for name in modules:
            sys.modules.pop(name, None)
        for name, module in saved.items():
            sys.modules[name] = module


@contextmanager
def _stubbed_gemini_modules():
    google_package = types.ModuleType("google")
    google_package.__path__ = []  # Mark as package for submodule imports
    genai_module = types.ModuleType("google.generativeai")
    configure_mock = Mock()
    generative_model_mock = Mock()
    setattr(genai_module, "configure", configure_mock)
    setattr(
        genai_module,
        "GenerativeModel",
        Mock(return_value=generative_model_mock),
    )
    setattr(google_package, "generativeai", genai_module)

    with _temporary_modules(
        {
            "google": google_package,
            "google.generativeai": genai_module,
        }
    ):
        yield genai_module, generative_model_mock


@contextmanager
def _stubbed_gemini_provider():
    config = LLMConfig(
        provider="gemini",
        gemini=GeminiLLMConfig(api_key="test_key", model="gemini-1.5-flash"),
    )

    generate_content_mock = Mock()

    with _stubbed_gemini_modules():
        provider = GeminiLLMProvider(config)
        provider.model.generate_content = generate_content_mock
        yield provider, generate_content_mock


@pytest.fixture
def stubbed_gemini_provider(request):
    context = _stubbed_gemini_provider()
    provider, generate_content_mock = context.__enter__()

    def finalize():
        context.__exit__(None, None, None)

    request.addfinalizer(finalize)
    return provider, generate_content_mock


def test_gemini_extract_metadata_handles_unterminated_code_block(
    stubbed_gemini_provider,
):
    provider, generate_content_mock = stubbed_gemini_provider
    response = """```json
{
  "author": null,
  "title": "Example",
  "publication_date": null,
  "tags": ["example"]
}
"""
    generate_content_mock.return_value = Mock(text=response)
    metadata = provider.extract_metadata("sample.txt", "Sample content for testing.")
    assert metadata["title"] == "Example"
    assert metadata["tags"] == ["example"]
    assert metadata["author"] is None
    generate_content_mock.assert_called_once()


def test_gemini_parse_json_handles_plain_json(stubbed_gemini_provider):
    provider, _ = stubbed_gemini_provider
    response = (
        '{"author": null, "title": "Plain", "publication_date": null, "tags": []}'
    )
    result = provider.parse_json(response)
    assert result["title"] == "Plain"
    assert result["tags"] == []


@pytest.fixture
def ollama_config():
    """Create a test Ollama LLM configuration."""
    return LLMConfig(
        provider="ollama",
        model="llama3.2:3b",
        base_url="http://localhost:11434",
        timeout=120,
        content_max_chars=8000,
        auto_detect_context_limit=True,
        max_retries=3,
    )


@pytest.fixture
def gemini_config():
    """Create a test Gemini LLM configuration."""
    return LLMConfig(
        provider="gemini",
        gemini=GeminiLLMConfig(api_key="test-key", model="gemini-1.5-flash"),
        content_max_chars=8000,
        auto_detect_context_limit=True,
        max_retries=3,
    )


def test_create_llm_provider_ollama(ollama_config):
    """Test creating an Ollama LLM provider."""
    provider = create_llm_provider(ollama_config)
    assert isinstance(provider, OllamaLLMProvider)


def test_create_llm_provider_gemini(gemini_config):
    """Test creating a Gemini LLM provider."""
    with patch("google.generativeai.configure"):
        with patch("google.generativeai.GenerativeModel"):
            provider = create_llm_provider(gemini_config)
            assert isinstance(provider, GeminiLLMProvider)


def test_create_llm_provider_unknown():
    """Test creating an unknown LLM provider."""
    config = LLMConfig(provider="unknown")

    with pytest.raises(ValueError, match="Unknown LLM provider"):
        create_llm_provider(config)


class TestOllamaLLMProvider:
    """Test cases for OllamaLLMProvider."""

    def test_get_content_limit_auto_detect(self, ollama_config):
        """Test intelligent content limit detection for llama3.2."""
        provider = OllamaLLMProvider(ollama_config)
        # Should detect llama3.2 has 128k tokens and use 128k chars (128000 * 0.25 * 4)
        limit = provider._get_content_limit()
        assert limit == 128000

    def test_get_content_limit_disabled(self, ollama_config):
        """Test content limit when auto-detection is disabled."""
        ollama_config.auto_detect_context_limit = False
        provider = OllamaLLMProvider(ollama_config)

        limit = provider._get_content_limit()
        assert limit == ollama_config.content_max_chars

    def test_get_content_limit_unknown_model(self, ollama_config):
        """Test content limit for unknown model."""
        ollama_config.model = "unknown-model"
        provider = OllamaLLMProvider(ollama_config)

        limit = provider._get_content_limit()
        assert limit == ollama_config.content_max_chars

    @patch("requests.post")
    def test_extract_metadata_success(self, mock_post, ollama_config):
        """Test successful metadata extraction."""
        # Mock successful response
        metadata_response = {
            "author": "John Doe",
            "title": "Test Article",
            "publication_date": "2025-01-30",
            "tags": ["test", "article", "example"],
        }

        mock_response = Mock()
        mock_response.json.return_value = {"response": json.dumps(metadata_response)}
        mock_response.raise_for_status.return_value = None
        mock_post.return_value = mock_response

        provider = OllamaLLMProvider(ollama_config)
        result = provider.extract_metadata(
            "test.txt", "This is a test article by John Doe.", "file:test.txt"
        )

        assert result["author"] == "John Doe"
        assert result["title"] == "Test Article"
        assert result["publication_date"] == "2025-01-30"
        assert result["tags"] == ["test", "article", "example"]

    @patch("requests.post")
    def test_extract_metadata_json_error(self, mock_post, ollama_config):
        """Test metadata extraction with JSON parsing error."""
        # Mock response with invalid JSON
        mock_response = Mock()
        mock_response.json.return_value = {"response": "invalid json"}
        mock_response.raise_for_status.return_value = None
        mock_post.return_value = mock_response

        provider = OllamaLLMProvider(ollama_config)
        result = provider.extract_metadata("test.txt", "Test content", "file:test.txt")

        # Should return fallback metadata
        assert result["author"] is None
        assert result["title"] == "Test"  # Cleaned filename
        assert result["publication_date"] is None
        assert result["tags"] == []

    @patch("requests.post")
    def test_extract_metadata_request_error(self, mock_post, ollama_config):
        """Test metadata extraction with request error."""
        mock_post.side_effect = Exception("Connection error")

        provider = OllamaLLMProvider(ollama_config)
        result = provider.extract_metadata("test.txt", "Test content", "file:test.txt")

        # Should return fallback metadata
        assert result["author"] is None
        assert result["title"] == "Test"
        assert result["publication_date"] is None
        assert result["tags"] == []

    @patch("requests.get")
    @patch("requests.post")
    def test_test_connection_success(self, mock_post, mock_get, ollama_config):
        """Test successful connection test."""
        # Mock models list response
        mock_get_response = Mock()
        mock_get_response.json.return_value = {
            "models": [{"name": "llama3.2:3b"}, {"name": "other-model:latest"}]
        }
        mock_get_response.raise_for_status.return_value = None
        mock_get.return_value = mock_get_response

        # Mock metadata extraction response
        mock_post_response = Mock()
        mock_post_response.json.return_value = {
            "response": '{"author": null, "title": "test", "publication_date": null, "tags": []}'
        }
        mock_post_response.raise_for_status.return_value = None
        mock_post.return_value = mock_post_response

        provider = OllamaLLMProvider(ollama_config)
        result = provider.test_connection()

        assert result is True

    @patch("requests.get")
    def test_test_connection_model_not_found(self, mock_get, ollama_config):
        """Test connection test when model is not found."""
        mock_response = Mock()
        mock_response.json.return_value = {"models": [{"name": "other-model:latest"}]}
        mock_response.raise_for_status.return_value = None
        mock_get.return_value = mock_response

        provider = OllamaLLMProvider(ollama_config)
        result = provider.test_connection()

        assert result is False


class TestGeminiLLMProvider:
    """Test cases for GeminiLLMProvider."""

    def test_get_content_limit_auto_detect(self, gemini_config):
        """Test intelligent content limit detection for Gemini."""
        with patch("google.generativeai.configure"):
            with patch("google.generativeai.GenerativeModel"):
                provider = GeminiLLMProvider(gemini_config)
                # Should detect gemini-1.5-flash has 1M tokens and use 1M chars (1000000 * 0.25 * 4)
                limit = provider._get_content_limit()
                assert limit == 1000000

    @patch("google.generativeai.configure")
    @patch("google.generativeai.GenerativeModel")
    def test_extract_metadata_success(
        self, mock_model_class, mock_configure, gemini_config
    ):
        """Test successful Gemini metadata extraction."""
        metadata_response = {
            "author": "Jane Smith",
            "title": "Gemini Test",
            "publication_date": "2025-01-30",
            "tags": ["AI", "gemini", "test"],
        }

        mock_model = Mock()
        mock_response = Mock()
        mock_response.text = json.dumps(metadata_response)
        mock_model.generate_content.return_value = mock_response
        mock_model_class.return_value = mock_model

        provider = GeminiLLMProvider(gemini_config)
        result = provider.extract_metadata(
            "test.txt", "This is a test by Jane Smith.", "file:test.txt"
        )

        assert result["author"] == "Jane Smith"
        assert result["title"] == "Gemini Test"
        assert result["publication_date"] == "2025-01-30"
        assert result["tags"] == ["AI", "gemini", "test"]

    @patch("google.generativeai.configure")
    @patch("google.generativeai.GenerativeModel")
    def test_test_connection_success(
        self, mock_model_class, mock_configure, gemini_config
    ):
        """Test successful Gemini connection test."""
        mock_model = Mock()
        mock_response = Mock()
        mock_response.text = (
            '{"author": null, "title": "test", "publication_date": null, "tags": []}'
        )
        mock_model.generate_content.return_value = mock_response
        mock_model_class.return_value = mock_model

        provider = GeminiLLMProvider(gemini_config)
        result = provider.test_connection()

        assert result is True

    def test_missing_gemini_config(self):
        """Test Gemini provider initialization with missing config."""
        config = LLMConfig(provider="gemini")  # No gemini config

        with pytest.raises(ValueError, match="Gemini configuration is required"):
            GeminiLLMProvider(config)
