package main

import (
	"crypto/tls"
	"net/http/httptest"
	"testing"
)

func TestWebSocketOriginRequiresTLSExceptLoopback(t *testing.T) {
	tests := []struct {
		name   string
		host   string
		origin string
		tls    bool
		want   bool
	}{
		{name: "https same origin", host: "192.168.10.25:8443", origin: "https://192.168.10.25:8443", tls: true, want: true},
		{name: "http LAN rejected", host: "192.168.10.25:8080", origin: "http://192.168.10.25:8080", want: false},
		{name: "http localhost allowed", host: "localhost:8080", origin: "http://localhost:8080", want: true},
		{name: "other origin rejected", host: "192.168.10.25:8443", origin: "https://example.com", tls: true, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/ws", nil)
			request.Host = test.host
			request.Header.Set("Origin", test.origin)
			if test.tls {
				request.TLS = &tls.ConnectionState{}
			}
			if got := upgrader.CheckOrigin(request); got != test.want {
				t.Fatalf("CheckOrigin() = %t, want %t", got, test.want)
			}
		})
	}
}
