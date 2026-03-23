FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements files
COPY requirements.txt /app/pipeline-requirements.txt
COPY api/requirements.txt /app/api-requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r pipeline-requirements.txt
RUN pip install --no-cache-dir -r api-requirements.txt

# Copy application code
COPY src/ /app/src/
COPY api/server.py /app/api/server.py
COPY ingestion-config.yaml.example /app/ingestion-config.yaml

# Create necessary directories
RUN mkdir -p /app/documents /app/qdrant_storage

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the application
CMD ["python", "-m", "uvicorn", "api.server:app", "--host", "0.0.0.0", "--port", "8000"]
