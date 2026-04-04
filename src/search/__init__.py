# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Search service layer for high-level search operations."""

from .search_service import SearchService, create_search_service

__all__ = ["SearchService", "create_search_service"]
