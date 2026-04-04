# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Integration tests directory
# These tests make real API calls to external services and require:
# - Valid API keys/configurations
# - Network connectivity
# - Running services (e.g., local Qdrant, Ollama)
#
# Use pytest markers to run specific test types:
# pytest tests/                              # Unit tests only
# pytest tests/integration/                  # Integration tests only
# pytest -m integration                      # Integration tests only (if marked)
