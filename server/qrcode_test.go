package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestPrintTerminalQR(t *testing.T) {
	var output bytes.Buffer
	if err := printTerminalQR(&output, "QR - Instalação HTTP:", "http://192.168.10.25:8080/"); err != nil {
		t.Fatal(err)
	}
	text := output.String()
	if !strings.Contains(text, "QR - Instalação HTTP:") ||
		!strings.Contains(text, "http://192.168.10.25:8080/") {
		t.Fatalf("QR output missing label or URL: %q", text)
	}
	if !strings.ContainsAny(text, "█▀▄") {
		t.Fatalf("QR output missing terminal matrix blocks: %q", text)
	}
}

func TestPrintTerminalQRRejectsEmptyOutput(t *testing.T) {
	var output bytes.Buffer
	if err := printTerminalQR(&output, "QR", strings.Repeat("x", 5000)); err == nil {
		t.Fatal("expected oversized QR content to fail")
	}
}
