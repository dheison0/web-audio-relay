package main

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
)

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
