.PHONY: dev web-build build-linux build-windows build-all clean

dev:
	cd web && npm run dev

web-build:
	cd web && npm ci
	cd web && npm run build
	rm -rf server/dist
	mkdir -p server/dist
	cp -R web/dist/. server/dist/

build-linux: web-build
	mkdir -p dist
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/audio-relay-linux ./server

build-windows: web-build
	mkdir -p dist
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/audio-relay.exe ./server

build-all: build-linux build-windows

clean:
	rm -rf dist web/node_modules web/dist server/dist
