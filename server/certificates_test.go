package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadOrCreateCAPersists(t *testing.T) {
	configDir := t.TempDir()
	firstCert, firstKey, err := loadOrCreateCA(configDir)
	if err != nil {
		t.Fatal(err)
	}
	secondCert, secondKey, err := loadOrCreateCA(configDir)
	if err != nil {
		t.Fatal(err)
	}
	if string(firstCert.Raw) != string(secondCert.Raw) ||
		!firstKey.PublicKey.Equal(&secondKey.PublicKey) {
		t.Fatal("CA was not persisted between loads")
	}
	if _, err := os.Stat(filepath.Join(configDir, certificateDirectory, caPrivateKeyName)); err != nil {
		t.Fatalf("private CA key was not persisted: %v", err)
	}
}

func TestLoadOrCreateCARejectsIncompleteFiles(t *testing.T) {
	configDir := t.TempDir()
	certPath := filepath.Join(configDir, certificateDirectory, caCertificateName)
	if err := os.MkdirAll(filepath.Dir(certPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(certPath, []byte("certificate"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadOrCreateCA(configDir); err == nil {
		t.Fatal("expected an error for an incomplete CA")
	}
}

func TestCreateServerCertificateIncludesLocalAddresses(t *testing.T) {
	caCert, caKey, err := loadOrCreateCA(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	serverCert, err := createServerCertificate(caCert, caKey, []localAddress{{ip: "192.168.10.25"}})
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(serverCert.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(caCert)
	if _, err := leaf.Verify(x509.VerifyOptions{
		Roots:   roots,
		DNSName: net.ParseIP("192.168.10.25").String(),
	}); err != nil {
		t.Fatalf("server certificate does not verify for local IP: %v", err)
	}
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: roots, DNSName: "localhost"}); err != nil {
		t.Fatalf("server certificate does not verify for localhost: %v", err)
	}
}

func TestMobileConfigEmbedsCA(t *testing.T) {
	caCert, _, err := loadOrCreateCA(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	profile := string(mobileConfig(caCert))
	encoded := base64.StdEncoding.EncodeToString(caCert.Raw)
	if !strings.Contains(profile, encoded) ||
		!strings.Contains(profile, "<string>com.apple.security.root</string>") {
		t.Fatal("iOS profile does not contain the root certificate payload")
	}
}

func TestIsLocalSetupHost(t *testing.T) {
	addresses := []localAddress{{ip: "192.168.10.25"}}
	if !isLocalSetupHost("192.168.10.25", addresses) || !isLocalSetupHost("localhost", addresses) {
		t.Fatal("expected local setup hosts to be accepted")
	}
	if isLocalSetupHost("192.168.10.99", addresses) || isLocalSetupHost("example.com", addresses) {
		t.Fatal("expected non-local setup hosts to be rejected")
	}
}

func TestIsVirtualInterfaceName(t *testing.T) {
	for _, name := range []string{"docker0", "veth1234", "WSL", "vEthernet (Default Switch)", "VMware Network Adapter", "VirtualBox Host-Only", "Tailscale", "ZeroTier"} {
		if !isVirtualInterfaceName(name) {
			t.Errorf("expected %q to be recognized as virtual", name)
		}
	}
	for _, name := range []string{"Wi-Fi", "Ethernet", "Ethernet 2"} {
		if isVirtualInterfaceName(name) {
			t.Errorf("expected %q to be recognized as a physical/LAN interface", name)
		}
	}
}

func TestSetupInfoUsesHTTPSAddressFromRequest(t *testing.T) {
	handler := registerRoutes(
		&Server{clients: make(map[string]*Client)},
		[]byte("public certificate"),
		[]byte("public DER certificate"),
		mobileConfigForTest(t),
		"AA:BB",
		"8443",
		[]localAddress{{ip: "192.168.10.25"}},
	)
	request := httptest.NewRequest(http.MethodGet, "/setup-info", nil)
	request.Host = "192.168.10.25:8080"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("setup info status = %d, want %d: %s", response.Code, http.StatusOK, response.Body)
	}
	var info struct {
		HTTPSURL    string `json:"httpsUrl"`
		Fingerprint string `json:"fingerprint"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if info.HTTPSURL != "https://192.168.10.25:8443/" || info.Fingerprint != "AA:BB" {
		t.Fatalf("unexpected setup info: %+v", info)
	}
}

func TestCertificateDownloadsExposeOnlyPublicCertificates(t *testing.T) {
	caCert, _, err := loadOrCreateCA(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCert.Raw})
	profile := mobileConfig(caCert)
	handler := registerRoutes(
		&Server{clients: make(map[string]*Client)},
		certPEM,
		caCert.Raw,
		profile,
		certificateFingerprint(caCert),
		"8443",
		[]localAddress{{ip: "192.168.10.25"}},
	)
	for _, path := range []string{"/ca.crt", "/ca.cer", "/ca.mobileconfig"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d", path, response.Code, http.StatusOK)
		}
		if strings.Contains(response.Body.String(), "PRIVATE KEY") {
			t.Fatalf("%s exposed private key material", path)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s did not disable caching", path)
		}
		if path == "/ca.crt" && response.Body.String() != string(certPEM) {
			t.Fatal("CA download does not match the persisted root certificate")
		}
		if path == "/ca.cer" && response.Body.String() != string(caCert.Raw) {
			t.Fatal("DER download does not match the persisted root certificate")
		}
		if path == "/ca.mobileconfig" && !strings.Contains(response.Body.String(), base64.StdEncoding.EncodeToString(caCert.Raw)) {
			t.Fatal("iOS download does not contain the persisted root certificate")
		}
	}
}

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
			request := httptest.NewRequest(http.MethodGet, "/ws", nil)
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

func mobileConfigForTest(t *testing.T) []byte {
	t.Helper()
	caCert, _, err := loadOrCreateCA(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return mobileConfig(caCert)
}
