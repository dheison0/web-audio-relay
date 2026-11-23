package main

import (
	"crypto/tls"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

//go:embed all:dist
var embeddedWeb embed.FS

type Client struct {
	id               string
	name             string
	role             string
	conn             *websocket.Conn
	writeMu          sync.Mutex
	muted            bool
	noiseSuppression bool
}

type Server struct {
	mu      sync.RWMutex
	clients map[string]*Client
}

type Envelope struct {
	Type             string        `json:"type"`
	Id               string        `json:"id,omitempty"`
	Name             string        `json:"name,omitempty"`
	Role             string        `json:"role,omitempty"`
	Muted            bool          `json:"muted,omitempty"`
	NoiseSuppression bool          `json:"noiseSuppression"`
	Target           string        `json:"target,omitempty"`
	ReceiverId       string        `json:"receiverId,omitempty"`
	SenderId         string        `json:"senderId,omitempty"`
	Sdp              string        `json:"sdp,omitempty"`
	Candidate        any           `json:"candidate,omitempty"`
	Transmitters     []Transmitter `json:"transmitters,omitempty"`
}

type Transmitter struct {
	Id               string `json:"id"`
	Name             string `json:"name"`
	Muted            bool   `json:"muted"`
	NoiseSuppression bool   `json:"noiseSuppression"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin, err := url.Parse(r.Header.Get("Origin"))
		if err != nil || origin.Host == "" || origin.Host != r.Host ||
			origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
			return false
		}
		if r.TLS != nil {
			return origin.Scheme == "https"
		}
		host := strings.Trim(origin.Hostname(), "[]")
		ip := net.ParseIP(host)
		return origin.Scheme == "http" && (strings.EqualFold(host, "localhost") || ip != nil && ip.IsLoopback())
	},
}

func (s *Server) send(c *Client, message any) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.conn.WriteJSON(message); err != nil {
		log.Printf("[WS OUT] erro id=%q role=%q type=%T: %v", c.id, c.role, message, err)
	}
}

func (s *Server) broadcast(message any, roles ...string) {
	s.mu.RLock()
	clients := make([]*Client, 0, len(s.clients))
	for _, c := range s.clients {
		if len(roles) == 0 {
			clients = append(clients, c)
			continue
		}
		for _, role := range roles {
			if c.role == role {
				clients = append(clients, c)
				break
			}
		}
	}
	s.mu.RUnlock()

	for _, c := range clients {
		s.send(c, message)
	}
}

func (s *Server) transmitterList() []Transmitter {
	s.mu.RLock()
	defer s.mu.RUnlock()
	transmitters := make([]Transmitter, 0)
	for _, c := range s.clients {
		if c.role == "transmitter" {
			transmitters = append(transmitters, Transmitter{
				Id: c.id, Name: c.name, Muted: c.muted, NoiseSuppression: c.noiseSuppression,
			})
		}
	}
	return transmitters
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[HTTP] Falha ao abrir WebSocket remoto=%s: %v", r.RemoteAddr, err)
		return
	}
	log.Printf("[WS] Conexão aberta remoto=%s", r.RemoteAddr)

	c := &Client{conn: conn}
	defer func() {
		s.mu.Lock()
		if c.id != "" {
			delete(s.clients, c.id)
			wasTransmitter := c.role == "transmitter"
			s.mu.Unlock()
			log.Printf("[WS] Conexão fechada id=%q nome=%q role=%q", c.id, c.name, c.role)
			if wasTransmitter {
				s.broadcast(Envelope{Type: "transmitter_left", Id: c.id})
			}
		} else {
			s.mu.Unlock()
			log.Printf("[WS] Conexão fechada antes do registro remoto=%s", r.RemoteAddr)
		}
		_ = conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var message Envelope
		if err := json.Unmarshal(data, &message); err != nil {
			log.Printf("[WS IN] id=%q mensagem JSON inválida: %v", c.id, err)
			s.send(c, Envelope{Type: "error", Name: "Mensagem inválida"})
			continue
		}
		log.Printf("[WS IN] id=%q nome=%q role=%q type=%q target=%q sdp_bytes=%d",
			c.id, c.name, c.role, message.Type, message.Target, len(message.Sdp))

		switch message.Type {
		case "register":
			if message.Id == "" || message.Role == "" {
				log.Printf("[WS] Registro rejeitado: id ou role ausente remoto=%s", r.RemoteAddr)
				s.send(c, Envelope{Type: "error", Name: "Identificação inválida"})
				continue
			}
			c.id = message.Id
			c.name = message.Name
			c.role = message.Role
			c.noiseSuppression = true
			s.mu.Lock()
			s.clients[c.id] = c
			s.mu.Unlock()
			log.Printf("[WS] Registrado id=%q nome=%q role=%q", c.id, c.name, c.role)

			if c.role == "receiver" {
				transmitters := s.transmitterList()
				log.Printf("[WS] Presença enviada ao receptor id=%q transmissores=%d", c.id, len(transmitters))
				s.send(c, Envelope{Type: "presence", Transmitters: transmitters})
			} else {
				log.Printf("[WS] Transmissor entrou id=%q nome=%q", c.id, c.name)
				s.broadcast(Envelope{
					Type: "transmitter_joined", Id: c.id, Name: c.name, Muted: c.muted,
					NoiseSuppression: c.noiseSuppression,
				}, "receiver")
				s.broadcast(Envelope{Type: "presence", Transmitters: s.transmitterList()}, "receiver")
			}

		case "offer":
			s.mu.RLock()
			target := s.clients[message.Target]
			s.mu.RUnlock()
			if target != nil {
				log.Printf("[RTC] Offer encaminhada receiver=%q transmitter=%q sdp_bytes=%d", c.id, target.id, len(message.Sdp))
				s.send(target, Envelope{Type: "offer", ReceiverId: c.id, Sdp: message.Sdp})
			} else {
				log.Printf("[RTC] Offer rejeitada: transmissor não encontrado target=%q receiver=%q", message.Target, c.id)
			}

		case "answer":
			s.mu.RLock()
			target := s.clients[message.Target]
			s.mu.RUnlock()
			if target != nil {
				log.Printf("[RTC] Answer encaminhada transmitter=%q receiver=%q sdp_bytes=%d", c.id, target.id, len(message.Sdp))
				s.send(target, Envelope{Type: "answer", SenderId: c.id, Sdp: message.Sdp})
			} else {
				log.Printf("[RTC] Answer rejeitada: receptor não encontrado target=%q transmitter=%q", message.Target, c.id)
			}

		case "ice":
			s.mu.RLock()
			target := s.clients[message.Target]
			s.mu.RUnlock()
			if target != nil {
				log.Printf("[RTC] ICE encaminhada from=%q to=%q", c.id, target.id)
				s.send(target, Envelope{Type: "ice", SenderId: c.id, Candidate: message.Candidate})
			} else {
				log.Printf("[RTC] ICE rejeitado: destino não encontrado target=%q from=%q", message.Target, c.id)
			}

		case "mute":
			s.mu.Lock()
			target := s.clients[message.Target]
			if target != nil {
				target.muted = message.Muted
			}
			s.mu.Unlock()

			if target != nil {
				log.Printf("[MUTE] id=%q muted=%t solicitado por receptor=%q", target.id, message.Muted, c.id)
				controlType := "pause"
				if message.Muted {
					controlType = "pause"
				} else {
					controlType = "resume"
				}
				s.send(target, Envelope{Type: controlType})
				s.broadcast(Envelope{Type: "mute_changed", Id: target.id, Muted: target.muted}, "receiver")
			} else {
				log.Printf("[MUTE] Falha: transmissor não encontrado target=%q receptor=%q", message.Target, c.id)
			}

		case "noise_suppression":
			if c.role != "receiver" {
				log.Printf("[AUDIO] Redução de ruído rejeitada: solicitante não é receptor id=%q", c.id)
				continue
			}
			s.mu.RLock()
			target := s.clients[message.Target]
			s.mu.RUnlock()
			if target == nil || target.role != "transmitter" {
				log.Printf("[AUDIO] Transmissor não encontrado para redução de ruído target=%q", message.Target)
				s.send(c, Envelope{Type: "error", Name: "Transmissor não encontrado"})
				continue
			}
			log.Printf("[AUDIO] Alteração remota de redução de ruído receptor=%q transmissor=%q enabled=%t",
				c.id, target.id, message.NoiseSuppression)
			s.send(target, Envelope{
				Type: "noise_suppression", NoiseSuppression: message.NoiseSuppression,
			})

		case "noise_suppression_updated", "noise_suppression_error":
			if c.role != "transmitter" {
				log.Printf("[AUDIO] Resposta de redução de ruído rejeitada: solicitante não é transmissor id=%q", c.id)
				continue
			}
			if message.Type == "noise_suppression_updated" {
				s.mu.Lock()
				c.noiseSuppression = message.NoiseSuppression
				s.mu.Unlock()
			}
			log.Printf("[AUDIO] Resposta de redução de ruído transmissor=%q type=%q", c.id, message.Type)
			s.broadcast(Envelope{
				Type: message.Type, Id: c.id, NoiseSuppression: message.NoiseSuppression, Name: message.Name,
			}, "receiver")
		}
	}
}

type localAddress struct {
	ip            string
	interfaceName string
}

func localAddresses() []localAddress {
	interfaces, err := net.Interfaces()
	if err == nil {
		addresses := make([]localAddress, 0)
		for _, iface := range interfaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			addrs, err := iface.Addrs()
			if err != nil {
				log.Printf("[NET] Falha ao consultar endereços da interface %q: %v", iface.Name, err)
				continue
			}
			for _, addr := range addrs {
				ipNet, ok := addr.(*net.IPNet)
				if !ok {
					continue
				}
				ip := ipNet.IP.To4()
				if ip == nil || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() {
					continue
				}
				addresses = append(addresses, localAddress{ip: ip.String(), interfaceName: iface.Name})
			}
		}
		sort.Slice(addresses, func(i, j int) bool {
			if addresses[i].interfaceName == addresses[j].interfaceName {
				return addresses[i].ip < addresses[j].ip
			}
			return addresses[i].interfaceName < addresses[j].interfaceName
		})
		return addresses
	}
	log.Printf("[NET] Falha ao consultar interfaces de rede: %v", err)
	return nil
}

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

func configuredPort(name, fallback string) string {
	if port := os.Getenv(name); port != "" {
		return port
	}
	return fallback
}

func main() {
	interfaces := localAddresses()
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatalf("Não foi possível localizar a pasta de configuração do usuário: %v", err)
	}
	caCert, caKey, err := loadOrCreateCA(configDir)
	if err != nil {
		log.Fatal(err)
	}
	caPEM, err := os.ReadFile(filepath.Join(configDir, certificateDirectory, caCertificateName))
	if err != nil {
		log.Fatalf("Falha ao carregar certificado CA para download: %v", err)
	}
	serverCert, err := createServerCertificate(caCert, caKey, interfaces)
	if err != nil {
		log.Fatal(err)
	}
	iosProfile := mobileConfig(caCert)
	fingerprint := certificateFingerprint(caCert)
	log.Printf("Impressão digital SHA-256 da CA (compare com a página antes de instalar): %s", fingerprint)
	log.Printf("Chave privada da CA armazenada localmente em %s; nunca compartilhe esse arquivo", filepath.Join(configDir, certificateDirectory, caPrivateKeyName))

	httpPort := configuredPort("PORT", "8080")
	httpsPort := configuredPort("HTTPS_PORT", "8443")
	if httpPort == httpsPort {
		log.Fatal("PORT e HTTPS_PORT devem ser diferentes")
	}
	handler := registerRoutes(
		&Server{clients: make(map[string]*Client)},
		caPEM,
		caCert.Raw,
		iosProfile,
		fingerprint,
		httpsPort,
		interfaces,
	)
	httpListener, err := net.Listen("tcp", net.JoinHostPort("", httpPort))
	if err != nil {
		log.Fatalf("Falha ao abrir porta HTTP %s: %v", httpPort, err)
	}
	httpsListener, err := net.Listen("tcp", net.JoinHostPort("", httpsPort))
	if err != nil {
		_ = httpListener.Close()
		log.Fatalf("Falha ao abrir porta HTTPS %s: %v", httpsPort, err)
	}
	tlsListener := tls.NewListener(httpsListener, &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{serverCert},
	})
	if len(interfaces) == 0 {
		log.Printf("[NET] Nenhum endereço IPv4 de rede encontrado; confira `ipconfig` no Windows")
	}
	log.Printf("HTTP escutando em todas as interfaces na porta TCP %s", httpPort)
	log.Printf("HTTPS escutando em todas as interfaces na porta TCP %s", httpsPort)
	for _, address := range interfaces {
		log.Printf("Instalação do certificado: http://%s:%s/ (interface: %s)", address.ip, httpPort, address.interfaceName)
	}
	if len(interfaces) == 0 {
		log.Printf("Acesso local: http://localhost:%s/ (instalação) e https://localhost:%s/", httpPort, httpsPort)
	}
	errors := make(chan error, 2)
	go func() {
		errors <- (&http.Server{Handler: handler}).Serve(httpListener)
	}()
	go func() {
		errors <- (&http.Server{
			Handler: handler,
			TLSConfig: &tls.Config{
				MinVersion:   tls.VersionTLS12,
				Certificates: []tls.Certificate{serverCert},
			},
		}).Serve(tlsListener)
	}()
	if err := <-errors; err != nil && err != http.ErrServerClosed {
		log.Fatalf("Servidor encerrado com erro: %v", err)
	}
}
