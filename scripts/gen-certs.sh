#!/usr/bin/env bash
set -e
mkdir -p src/nginx/certs
if [ ! -f src/nginx/certs/nginx.crt ]; then
  openssl req -x509 -nodes -days 3650 -newkey rsa:4096 \
    -keyout src/nginx/certs/nginx.key \
    -out    src/nginx/certs/nginx.crt \
    -subj "/CN=localhost/O=WIMS-BFP/C=PH" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  echo "Self-signed cert generated at src/nginx/certs/"
else
  echo "Cert already exists, skipping."
fi