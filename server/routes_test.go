package main

import (
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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

func mobileConfigForTest(t *testing.T) []byte {
	t.Helper()
	caCert, _, err := loadOrCreateCA(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return mobileConfig(caCert)
}
