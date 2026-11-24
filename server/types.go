package main

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

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
