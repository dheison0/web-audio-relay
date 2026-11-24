package main

import "testing"

func TestIsLocalSetupHost(t *testing.T) {
	addresses := []localAddress{{ip: "192.168.10.25"}}
	if !isLocalSetupHost("192.168.10.25", addresses) || !isLocalSetupHost("localhost", addresses) {
		t.Fatal("expected local setup hosts to be accepted")
	}
	if isLocalSetupHost("192.168.10.99", addresses) || isLocalSetupHost("example.com", addresses) {
		t.Fatal("expected non-local setup hosts to be rejected")
	}
}

func TestIsVirtualInterfaceName(t *testing.T) {
	for _, name := range []string{"docker0", "veth1234", "WSL", "vEthernet (Default Switch)", "VMware Network Adapter", "VirtualBox Host-Only", "Tailscale", "ZeroTier"} {
		if !isVirtualInterfaceName(name) {
			t.Errorf("expected %q to be recognized as virtual", name)
		}
	}
	for _, name := range []string{"Wi-Fi", "Ethernet", "Ethernet 2"} {
		if isVirtualInterfaceName(name) {
			t.Errorf("expected %q to be recognized as a physical/LAN interface", name)
		}
	}
}
