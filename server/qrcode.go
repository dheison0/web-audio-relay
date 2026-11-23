package main

import (
	"fmt"
	"io"

	qrcode "github.com/skip2/go-qrcode"
)

func printTerminalQR(w io.Writer, label, content string) error {
	code, err := qrcode.New(content, qrcode.Medium)
	if err != nil {
		return fmt.Errorf("gerar QR Code para %q: %w", content, err)
	}
	bitmap := code.Bitmap()
	if len(bitmap) == 0 {
		return fmt.Errorf("QR Code para %q não possui matriz", content)
	}

	_, _ = fmt.Fprintf(w, "\n%s\n%s\n", label, content)
	for y := 0; y < len(bitmap); y += 2 {
		_, _ = io.WriteString(w, " ")
		for x := 0; x < len(bitmap[y]); x++ {
			top := bitmap[y][x]
			bottom := y+1 < len(bitmap) && bitmap[y+1][x]
			switch {
			case top && bottom:
				_, _ = io.WriteString(w, "█")
			case top:
				_, _ = io.WriteString(w, "▀")
			case bottom:
				_, _ = io.WriteString(w, "▄")
			default:
				_, _ = io.WriteString(w, " ")
			}
		}
		_, _ = io.WriteString(w, "\n")
	}
	return nil
}
