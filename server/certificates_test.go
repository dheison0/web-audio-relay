package main

import (
	"crypto/x509"
	"encoding/base64"
	"net"
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
