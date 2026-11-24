package main

import (
	"crypto/tls"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
)

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
		httpURL := "http://" + net.JoinHostPort(address.ip, httpPort) + "/"
		httpsURL := "https://" + net.JoinHostPort(address.ip, httpsPort) + "/"
		if err := printTerminalQR(os.Stdout, "QR - Instalação HTTP:", httpURL); err != nil {
			log.Printf("[QR] Falha ao imprimir QR HTTP: %v", err)
		}
		if err := printTerminalQR(os.Stdout, "QR - Aplicação HTTPS:", httpsURL); err != nil {
			log.Printf("[QR] Falha ao imprimir QR HTTPS: %v", err)
		}
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
