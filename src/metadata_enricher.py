import logging
import time
from pathlib import Path
from typing import List

from .config import LLMConfig
from .document_processor import DocumentChunk


class MetadataEnricher:
    def __init__(self, provider, config: LLMConfig | None):
        self.provider = provider
        self.config = config
        self.logger = logging.getLogger(__name__)
        self._last_request_ts = 0.0
        self._disabled_for_run = False

    def enrich_chunks(self, file_path: Path, chunks: List[DocumentChunk]) -> List[DocumentChunk]:
        if not chunks or not self.provider or not self.config or not self.config.enabled:
            return chunks
        if self._disabled_for_run:
            return chunks

        metadata = chunks[0].metadata
        if metadata.title and metadata.author and metadata.tags:
            return chunks

        try:
            self._throttle()
            self.logger.info(f"Extracting metadata using LLM for {file_path.name}")
            llm_metadata = self.provider.extract_metadata(
                file_path.name, chunks[0].original_text, metadata.source_url
            )

            metadata.title = metadata.title or llm_metadata.get("title")
            metadata.author = metadata.author or llm_metadata.get("author")
            metadata.notes = metadata.notes or llm_metadata.get("notes")
            metadata.tags = metadata.tags or llm_metadata.get("tags", [])

            if not metadata.publication_date and llm_metadata.get("publication_date"):
                try:
                    from datetime import datetime as dt
                    metadata.publication_date = dt.fromisoformat(llm_metadata["publication_date"])
                except (ValueError, TypeError) as exc:
                    self.logger.warning(
                        f"Failed to parse LLM publication_date '{llm_metadata['publication_date']}': {exc}"
                    )

            self._last_request_ts = time.time()
        except Exception as exc:
            msg = str(exc)
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                self._disabled_for_run = True
                self.logger.warning(
                    "Disabling LLM metadata extraction for the rest of this run after rate limit exhaustion"
                )
            else:
                self.logger.error(f"LLM metadata extraction failed for {file_path.name}: {exc}")

        return chunks

    def _throttle(self) -> None:
        rpm = getattr(self.config, "requests_per_minute", 0) or 0
        if rpm <= 0:
            return
        min_interval = 60.0 / rpm
        elapsed = time.time() - self._last_request_ts
        if self._last_request_ts and elapsed < min_interval:
            time.sleep(min_interval - elapsed)
