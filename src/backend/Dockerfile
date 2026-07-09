FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev postgresql-client bash \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash appuser

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .
COPY wait-for-db.sh /app/wait-for-db.sh
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/wait-for-db.sh /app/entrypoint.sh && chown -R appuser:appuser /app && \
    mkdir -p /app/storage/exports && chown -R appuser:appuser /app/storage

USER appuser

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "3", "--limit-concurrency", "200", "--timeout-keep-alive", "5", \
     "--lifespan", "off"]
