#!/bin/bash
# Run FireIncident location tests via Docker (no compose, no DB required).
# From project root: ./run_fire_incident_tests.sh

set -e
cd "$(dirname "$0")"

docker run --rm \
  -v "$(pwd)/src:/workspace" \
  -w /workspace \
  python:3.11-slim \
  bash -c "pip install -q geoalchemy2 shapely sqlalchemy pytest && \
  PYTHONPATH=. pytest backend/tests/test_fire_incident_location.py -v"
