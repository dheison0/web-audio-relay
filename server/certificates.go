package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	certificateDirectory = "audio-relay"
	caCertificateName    = "audio-relay-ca.crt"
	caPrivateKeyName     = "audio-relay-ca.key"
)

func loadOrCreateCA(configDir string) (*x509.Certificate, *ecdsa.PrivateKey, error) {
	dir := filepath.Join(configDir, certificateDirectory)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, nil, fmt.Errorf("criar diretório de certificados %q: %w", dir, err)
	}

	certPath := filepath.Join(dir, caCertificateName)
	keyPath := filepath.Join(dir, caPrivateKeyName)
	certPEM, certErr := os.ReadFile(certPath)
	keyPEM, keyErr := os.ReadFile(keyPath)
	certMissing := os.IsNotExist(certErr)
	keyMissing := os.IsNotExist(keyErr)
	if certErr != nil && !certMissing {
		return nil, nil, fmt.Errorf("ler certificado CA %q: %w", certPath, certErr)
	}
	if keyErr != nil && !keyMissing {
		return nil, nil, fmt.Errorf("ler chave privada CA %q: %w", keyPath, keyErr)
	}
	if certMissing != keyMissing {
		return nil, nil, fmt.Errorf(
			"certificado ou chave CA ausente em %q; restaure ambos ou remova a pasta para gerar uma nova CA",
			dir,
		)
	}

	if certMissing {
		generatedCertPEM, generatedKeyPEM, err := createCA()
		if err != nil {
			return nil, nil, fmt.Errorf("gerar CA local: %w", err)
		}
		if err := os.WriteFile(keyPath, generatedKeyPEM, 0600); err != nil {
			return nil, nil, fmt.Errorf("salvar chave privada CA %q: %w", keyPath, err)
		}
		if err := os.WriteFile(certPath, generatedCertPEM, 0600); err != nil {
			_ = os.Remove(keyPath)
			return nil, nil, fmt.Errorf("salvar certificado CA %q: %w", certPath, err)
		}
		certPEM = generatedCertPEM
		keyPEM = generatedKeyPEM
	}

	certBlock, _ := pem.Decode(certPEM)
	if certBlock == nil || certBlock.Type != "CERTIFICATE" {
		return nil, nil, fmt.Errorf("certificado CA %q contém PEM inválido", certPath)
	}
	caCert, err := x509.ParseCertificate(certBlock.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("interpretar certificado CA %q: %w", certPath, err)
	}
	keyBlock, _ := pem.Decode(keyPEM)
	if keyBlock == nil || keyBlock.Type != "EC PRIVATE KEY" {
		return nil, nil, fmt.Errorf("chave privada CA %q contém PEM inválido", keyPath)
	}
	caKey, err := x509.ParseECPrivateKey(keyBlock.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("interpretar chave privada CA %q: %w", keyPath, err)
	}
	caPublicKey, ok := caCert.PublicKey.(*ecdsa.PublicKey)
	if !caCert.IsCA || !ok || caCert.CheckSignatureFrom(caCert) != nil ||
		!caPublicKey.Equal(&caKey.PublicKey) {
		return nil, nil, fmt.Errorf("certificado e chave em %q não formam uma autoridade certificadora válida", dir)
	}
	if err := os.Chmod(keyPath, 0600); err != nil {
		return nil, nil, fmt.Errorf("proteger chave privada CA %q: %w", keyPath, err)
	}
	return caCert, caKey, nil
}

func createCA() ([]byte, []byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	serial, err := randomSerial()
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "Audio Relay Local CA"},
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            0,
		MaxPathLenZero:        true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), nil
}

func createServerCertificate(caCert *x509.Certificate, caKey *ecdsa.PrivateKey, addresses []localAddress) (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("gerar chave HTTPS: %w", err)
	}
	serial, err := randomSerial()
	if err != nil {
		return tls.Certificate{}, err
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "Audio Relay Local Server"},
		NotBefore:    now.Add(-5 * time.Minute),
		NotAfter:     now.AddDate(1, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}
	seen := map[string]bool{"127.0.0.1": true, "::1": true}
	for _, address := range addresses {
		ip := net.ParseIP(address.ip)
		if ip == nil || seen[ip.String()] {
			continue
		}
		seen[ip.String()] = true
		template.IPAddresses = append(template.IPAddresses, ip)
	}
	sort.Slice(template.IPAddresses, func(i, j int) bool {
		return template.IPAddresses[i].String() < template.IPAddresses[j].String()
	})
	der, err := x509.CreateCertificate(rand.Reader, template, caCert, &key.PublicKey, caKey)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("assinar certificado HTTPS: %w", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("serializar chave HTTPS: %w", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	serverCert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("montar cadeia HTTPS: %w", err)
	}
	return serverCert, nil
}

func randomSerial() (*big.Int, error) {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return nil, fmt.Errorf("gerar número de série: %w", err)
	}
	return serial, nil
}

func certificateFingerprint(cert *x509.Certificate) string {
	sum := sha256.Sum256(cert.Raw)
	encoded := strings.ToUpper(hex.EncodeToString(sum[:]))
	parts := make([]string, 0, len(encoded)/2)
	for i := 0; i < len(encoded); i += 2 {
		parts = append(parts, encoded[i:i+2])
	}
	return strings.Join(parts, ":")
}

func mobileConfig(caCert *x509.Certificate) []byte {
	cert := base64.StdEncoding.EncodeToString(caCert.Raw)
	return []byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key><string>audio-relay-local-ca.crt</string>
      <key>PayloadContent</key><data>%s</data>
      <key>PayloadDescription</key><string>Autoridade certificadora local do Audio Relay</string>
      <key>PayloadDisplayName</key><string>Audio Relay Local CA</string>
      <key>PayloadIdentifier</key><string>com.audio-relay.local-ca.certificate</string>
      <key>PayloadType</key><string>com.apple.security.root</string>
      <key>PayloadUUID</key><string>e09c814c-5594-493b-a973-a4f57c17f110</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key><string>Confiança local para acessar o Audio Relay por HTTPS</string>
  <key>PayloadDisplayName</key><string>Audio Relay Local CA</string>
  <key>PayloadIdentifier</key><string>com.audio-relay.local-ca</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>aa9c311d-81b7-4e31-b641-535b5c3a9ba8</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`, cert))
}
