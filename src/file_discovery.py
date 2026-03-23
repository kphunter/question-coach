from pathlib import Path
from typing import List

from .config import DocumentsConfig


class FileDiscovery:
    def __init__(self, config: DocumentsConfig):
        self.config = config

    def get_supported_files(self) -> List[Path]:
        folder_path = Path(self.config.folder_path)
        if not folder_path.exists():
            raise FileNotFoundError(f"Documents folder not found: {folder_path}")

        supported_files = []
        for ext in self.config.supported_extensions:
            for file_path in folder_path.glob(f"**/*{ext}"):
                if self._should_include(file_path, folder_path):
                    supported_files.append(file_path)

        return sorted(set(supported_files))

    def _should_include(self, file_path: Path, base_folder: Path) -> bool:
        relative_parts = file_path.relative_to(base_folder).parts

        if any(part in set(self.config.ignored_directories) for part in relative_parts[:-1]):
            return False

        if self.config.ignore_hidden_files and any(part.startswith('.') for part in relative_parts):
            return False

        filename = file_path.name
        if filename in set(self.config.ignored_file_patterns):
            return False

        return True
