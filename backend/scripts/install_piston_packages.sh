#!/bin/bash
set -u

HOST="${1:-http://localhost:2000}"
BASE="$HOST/api/v2/packages"

PACKAGES=(
  "python:3.10.0"
  "node:18.15.0"
  "typescript:5.0.3"
  "java:15.0.2"
  "gcc:10.2.0"
  "go:1.16.2"
  "ruby:3.0.1"
  "rust:1.68.2"
  "mono:6.12.0"
  "dotnet:5.0.201"
  "kotlin:1.8.20"
  "swift:5.3.3"
  "scala:3.2.2"
  "perl:5.36.0"
  "php:8.2.3"
  "haskell:9.0.1"
  "rscript:4.1.1"
  "dart:2.19.6"
  "lua:5.4.4"
  "elixir:1.11.3"
  "erlang:23.0.0"
  "clojure:1.10.3"
  "groovy:3.0.7"
  "pascal:3.2.2"
  "bash:5.2.0"
  "ocaml:4.12.0"
  "octave:8.1.0"
  "cobol:3.1.2"
  "freebasic:1.9.0"
  "nasm:2.15.5"
  "prolog:8.2.4"
  "lisp:2.1.2"
  "sqlite3:3.36.0"
)

echo "Installing ${#PACKAGES[@]} packages against $HOST ..."
FAILED=()
for pkg in "${PACKAGES[@]}"; do
  name="${pkg%%:*}"
  version="${pkg##*:}"
  echo "=== $name@$version ==="
  resp=$(curl -s -w '\nHTTP_STATUS:%{http_code}' -X POST "$BASE" \
    -H 'Content-Type: application/json' \
    -d "{\"language\":\"$name\",\"version\":\"$version\"}")
  echo "$resp"
  status=$(echo "$resp" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
  if [ "$status" != "200" ]; then
    FAILED+=("$name@$version (HTTP $status)")
  fi
done

echo ""
echo "=== DONE ==="
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "All packages installed successfully."
else
  echo "FAILED (${#FAILED[@]}):"
  printf '  %s\n' "${FAILED[@]}"
fi
