from pathlib import Path
from typing import List, Optional

from .config import DocumentsConfig


class FileDiscovery:
    def __init__(self, config: DocumentsConfig):
        self.config = config
        self.ignored_directories = set(config.ignored_directories or [])
        self.ignored_file_patterns = set(config.ignored_file_patterns or [])

    def get_supported_files(self) -> List[Path]:
        primary_folder = Path(self.config.folder_path)
        if not primary_folder.exists():
            raise FileNotFoundError(f"Documents folder not found: {primary_folder}")

        search_folders = self._get_search_folders(primary_folder)

        supported_files = []
        for base_folder in search_folders:
            for ext in self.config.supported_extensions:
                for file_path in base_folder.glob(f"**/*{ext}"):
                    if self._should_include(file_path, base_folder):
                        supported_files.append(file_path)

        return sorted(set(supported_files))

    def _get_search_folders(self, primary_folder: Path) -> List[Path]:
        search_folders = [primary_folder]
        additional_folders = getattr(self.config, "additional_folders", [])

        for extra in additional_folders:
            resolved = self._resolve_additional_folder(extra, primary_folder)
            if (
                resolved
                and resolved not in search_folders
                and self._should_scan_folder(resolved)
            ):
                search_folders.append(resolved)

        return search_folders

    def _resolve_additional_folder(
        self, folder: str, primary_folder: Path
    ) -> Optional[Path]:
        extra_path = Path(folder)

        if extra_path.is_absolute():
            candidates = [extra_path]
        else:
            candidates = [
                primary_folder / extra_path,
                primary_folder.parent / extra_path,
                Path.cwd() / extra_path,
            ]

        for candidate in candidates:
            if candidate.exists():
                return candidate

        return None

    def get_source_path(self, file_path: Path) -> str:
        primary_folder = Path(self.config.folder_path)
        for base_folder in self._get_search_folders(primary_folder):
            try:
                return file_path.relative_to(base_folder).as_posix()
            except ValueError:
                continue
        return file_path.name

    def _should_scan_folder(self, folder: Path) -> bool:
        name = folder.name
        if self.config.ignore_hidden_files and name.startswith('.'):
            return False
        if name in self.ignored_directories:
            return False
        return True

    def _should_include(self, file_path: Path, base_folder: Path) -> bool:
        relative_parts = file_path.relative_to(base_folder).parts

        if any(part in self.ignored_directories for part in relative_parts[:-1]):
            return False

        if self.config.ignore_hidden_files and any(part.startswith('.') for part in relative_parts):
            return False

        filename = file_path.name
        if filename in self.ignored_file_patterns:
            return False

        return True
