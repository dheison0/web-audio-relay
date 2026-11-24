package main

import (
	"encoding/json"
	"log"
	"net/http"
)

func (s *Server) send(c *Client, message any) {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.conn.WriteJSON(message); err != nil {
		log.Printf("[WS OUT] erro id=%q role=%q type=%T: %v", c.id, c.role, message, err)
	}
}

func (s *Server) broadcast(message any, roles ...string) {
	s.mu.RLock()
	clients := make([]*Client, 0, len(s.clients))
	for _, c := range s.clients {
		if len(roles) == 0 {
			clients = append(clients, c)
			continue
		}
		for _, role := range roles {
			if c.role == role {
				clients = append(clients, c)
				break
			}
		}
	}
	s.mu.RUnlock()

	for _, c := range clients {
		s.send(c, message)
	}
}

func (s *Server) transmitterList() []Transmitter {
	s.mu.RLock()
	defer s.mu.RUnlock()
	transmitters := make([]Transmitter, 0)
	for _, c := range s.clients {
		if c.role == "transmitter" {
			transmitters = append(transmitters, Transmitter{
				Id: c.id, Name: c.name, Muted: c.muted, NoiseSuppression: c.noiseSuppression,
			})
		}
	}
	return transmitters
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[HTTP] Falha ao abrir WebSocket remoto=%s: %v", r.RemoteAddr, err)
		return
	}
	log.Printf("[WS] Conexão aberta remoto=%s", r.RemoteAddr)

	c := &Client{conn: conn}
	defer func() {
		s.mu.Lock()
		if c.id != "" {
			delete(s.clients, c.id)
			wasTransmitter := c.role == "transmitter"
			s.mu.Unlock()
			log.Printf("[WS] Conexão fechada id=%q nome=%q role=%q", c.id, c.name, c.role)
			if wasTransmitter {
				s.broadcast(Envelope{Type: "transmitter_left", Id: c.id})
			}
		} else {
			s.mu.Unlock()
			log.Printf("[WS] Conexão fechada antes do registro remoto=%s", r.RemoteAddr)
		}
		_ = conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var message Envelope
		if err := json.Unmarshal(data, &message); err != nil {
			log.Printf("[WS IN] id=%q mensagem JSON inválida: %v", c.id, err)
			s.send(c, Envelope{Type: "error", Name: "Mensagem inválida"})
			continue
		}
		log.Printf("[WS IN] id=%q nome=%q role=%q type=%q target=%q sdp_bytes=%d",
			c.id, c.name, c.role, message.Type, message.Target, len(message.Sdp))

		switch message.Type {
		case "register":
			if message.Id == "" || message.Role == "" {
				log.Printf("[WS] Registro rejeitado: id ou role ausente remoto=%s", r.RemoteAddr)
				s.send(c, Envelope{Type: "error", Name: "Identificação inválida"})
				continue
			}
			c.id = message.Id
			c.name = message.Name
			c.role = message.Role
			c.noiseSuppression = true
			s.mu.Lock()
			s.clients[c.id] = c
			s.mu.Unlock()
			log.Printf("[WS] Registrado id=%q nome=%q role=%q", c.id, c.name, c.role)

			if c.role == "receiver" {
				transmitters := s.transmitterList()
				log.Printf("[WS] Presença enviada ao receptor id=%q transmissores=%d", c.id, len(transmitters))
				s.send(c, Envelope{Type: "presence", Transmitters: transmitters})
			} else {
				log.Printf("[WS] Transmissor entrou id=%q nome=%q", c.id, c.name)
				s.broadcast(Envelope{
					Type: "transmitter_joined", Id: c.id, Name: c.name, Muted: c.muted,
					NoiseSuppression: c.noiseSuppression,
				}, "receiver")
				s.broadcast(Envelope{Type: "presence", Transmitters: s.transmitterList()}, "receiver")
			}

		case "offer":
			s.mu.RLock()
			target := s.clients[message.Target]
			s.mu.RUnlock()
			if target != nil {
				log.Printf("[RTC] Offer encaminhada receiver=%q transmitter=%q sdp_bytes=%d", c.id, target.id, len(message.Sdp))
				s.send(target, Envelope{Type: "offer", ReceiverId: c.id, Sdp: message.Sdp})
			} else {
				log.Printf("[RTC] Offer rejeitada: transmissor não encontrado target=%q receiver=%q", message.Target, c.id)
			}

		case "answer":
			s.mu.RLock()
			target := s.clients[message.Target]
			s.mu.RUnlock()
			if target != nil {
				log.Printf("[RTC] Answer encaminhada transmitter=%q receiver=%q sdp_bytes=%d", c.id, target.id, len(message.Sdp))
				s.send(target, Envelope{Type: "answer", SenderId: c.id, Sdp: message.Sdp})
			} else {
				log.Printf("[RTC] Answer rejeitada: receptor não encontrado target=%q transmitter=%q", message.Target, c.id)
			}

		case "ice":
			s.mu.RLock()
			target := s.clients[message.Target]
			s.mu.RUnlock()
			if target != nil {
				log.Printf("[RTC] ICE encaminhada from=%q to=%q", c.id, target.id)
				s.send(target, Envelope{Type: "ice", SenderId: c.id, Candidate: message.Candidate})
			} else {
				log.Printf("[RTC] ICE rejeitado: destino não encontrado target=%q from=%q", message.Target, c.id)
			}

		case "mute":
			s.mu.Lock()
			target := s.clients[message.Target]
			if target != nil {
				target.muted = message.Muted
			}
			s.mu.Unlock()

			if target != nil {
				log.Printf("[MUTE] id=%q muted=%t solicitado por receptor=%q", target.id, message.Muted, c.id)
				controlType := "pause"
				if message.Muted {
					controlType = "pause"
				} else {
					controlType = "resume"
				}
				s.send(target, Envelope{Type: controlType})
				s.broadcast(Envelope{Type: "mute_changed", Id: target.id, Muted: target.muted}, "receiver")
			} else {
				log.Printf("[MUTE] Falha: transmissor não encontrado target=%q receptor=%q", message.Target, c.id)
			}

		case "noise_suppression":
			if c.role != "receiver" {
				log.Printf("[AUDIO] Redução de ruído rejeitada: solicitante não é receptor id=%q", c.id)
				continue
			}
			s.mu.RLock()
			target := s.clients[message.Target]
			s.mu.RUnlock()
			if target == nil || target.role != "transmitter" {
				log.Printf("[AUDIO] Transmissor não encontrado para redução de ruído target=%q", message.Target)
				s.send(c, Envelope{Type: "error", Name: "Transmissor não encontrado"})
				continue
			}
			log.Printf("[AUDIO] Alteração remota de redução de ruído receptor=%q transmissor=%q enabled=%t",
				c.id, target.id, message.NoiseSuppression)
			s.send(target, Envelope{
				Type: "noise_suppression", NoiseSuppression: message.NoiseSuppression,
			})

		case "noise_suppression_updated", "noise_suppression_error":
			if c.role != "transmitter" {
				log.Printf("[AUDIO] Resposta de redução de ruído rejeitada: solicitante não é transmissor id=%q", c.id)
				continue
			}
			if message.Type == "noise_suppression_updated" {
				s.mu.Lock()
				c.noiseSuppression = message.NoiseSuppression
				s.mu.Unlock()
			}
			log.Printf("[AUDIO] Resposta de redução de ruído transmissor=%q type=%q", c.id, message.Type)
			s.broadcast(Envelope{
				Type: message.Type, Id: c.id, NoiseSuppression: message.NoiseSuppression, Name: message.Name,
			}, "receiver")
		}
	}
}
