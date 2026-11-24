package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
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

func randomSerial() (*big.Int, error) {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return nil, fmt.Errorf("gerar número de série: %w", err)
	}
	return serial, nil
}
