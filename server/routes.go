package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net"
	"net/http"
	"strings"
)

//go:embed all:dist
var embeddedWeb embed.FS

func registerRoutes(server *Server, caPEM, caDER, iosProfile []byte, fingerprint, httpsPort string, addresses []localAddress) http.Handler {
	webRoot, err := fs.Sub(embeddedWeb, "dist")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(webRoot))
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.handleWebSocket)
	mux.HandleFunc("/ca.crt", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Método não permitido", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/x-x509-ca-cert")
		w.Header().Set("Content-Disposition", `attachment; filename="audio-relay-local-ca.crt"`)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(caPEM)
	})
	mux.HandleFunc("/ca.cer", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Método não permitido", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/pkix-cert")
		w.Header().Set("Content-Disposition", `attachment; filename="audio-relay-local-ca.cer"`)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(caDER)
	})
	mux.HandleFunc("/ca.mobileconfig", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Método não permitido", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/x-apple-aspen-config")
		w.Header().Set("Content-Disposition", `attachment; filename="audio-relay-local-ca.mobileconfig"`)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(iosProfile)
	})
	mux.HandleFunc("/setup-info", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Método não permitido", http.StatusMethodNotAllowed)
			return
		}
		host := r.URL.Hostname()
		if host == "" {
			host = r.Host
			if parsedHost, _, err := net.SplitHostPort(host); err == nil {
				host = parsedHost
			}
			host = strings.Trim(host, "[]")
		}
		if !isLocalSetupHost(host, addresses) {
			http.Error(w, "Acesse esta página pelo endereço IP local mostrado no terminal do servidor", http.StatusBadRequest)
			return
		}
		response := struct {
			HTTPSURL    string `json:"httpsUrl"`
			Fingerprint string `json:"fingerprint"`
		}{
			HTTPSURL:    "https://" + net.JoinHostPort(host, httpsPort) + "/",
			Fingerprint: fingerprint,
		}
		if host == "localhost" {
			response.HTTPSURL = "https://localhost:" + httpsPort + "/"
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Printf("[HTTP] Falha ao enviar informações de configuração: %v", err)
		}
	})
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[HTTP] %s %s remoto=%s", r.Method, r.URL.Path, r.RemoteAddr)
		if r.URL.Path != "/" {
			if _, err := fs.Stat(webRoot, r.URL.Path[1:]); err == nil {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	}))
	return mux
}

func isLocalSetupHost(host string, addresses []localAddress) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.IsLoopback() {
		return false
	}
	for _, address := range addresses {
		if ip.Equal(net.ParseIP(address.ip)) {
			return true
		}
	}
	return false
}
