package main

import (
	"log"
	"net"
	"os"
	"sort"
	"strings"
)

type localAddress struct {
	ip            string
	interfaceName string
}

func isVirtualInterfaceName(name string) bool {
	name = strings.ToLower(name)
	virtualNames := []string{
		"docker",
		"veth",
		"wsl",
		"hyper-v",
		"vethernet",
		"vmware",
		"virtualbox",
		"virtual",
		"tailscale",
		"zerotier",
		"vpn",
	}
	for _, virtualName := range virtualNames {
		if strings.Contains(name, virtualName) {
			return true
		}
	}
	return false
}

func localAddresses() []localAddress {
	interfaces, err := net.Interfaces()
	if err == nil {
		addresses := make([]localAddress, 0)
		for _, iface := range interfaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			if isVirtualInterfaceName(iface.Name) {
				continue
			}
			addrs, err := iface.Addrs()
			if err != nil {
				log.Printf("[NET] Falha ao consultar endereços da interface %q: %v", iface.Name, err)
				continue
			}
			for _, addr := range addrs {
				ipNet, ok := addr.(*net.IPNet)
				if !ok {
					continue
				}
				ip := ipNet.IP.To4()
				if ip == nil || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() {
					continue
				}
				addresses = append(addresses, localAddress{ip: ip.String(), interfaceName: iface.Name})
			}
		}
		sort.Slice(addresses, func(i, j int) bool {
			if addresses[i].interfaceName == addresses[j].interfaceName {
				return addresses[i].ip < addresses[j].ip
			}
			return addresses[i].interfaceName < addresses[j].interfaceName
		})
		return addresses
	}
	log.Printf("[NET] Falha ao consultar interfaces de rede: %v", err)
	return nil
}

func configuredPort(name, fallback string) string {
	if port := os.Getenv(name); port != "" {
		return port
	}
	return fallback
}
