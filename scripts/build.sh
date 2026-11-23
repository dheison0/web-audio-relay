#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm --prefix web ci
npm --prefix web run build

rm -rf server/dist
mkdir -p server/dist
cp -R web/dist/. server/dist/

mkdir -p dist
go mod download
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/audio-relay-linux ./server
