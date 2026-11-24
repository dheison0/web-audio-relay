import { useEffect, useRef, useState } from "react";
import type { Role } from "../types";

type Props = {
  connected: boolean;
  role: Role;
  receiverPeers: Map<string, RTCPeerConnection>;
  transmitterPeers: Map<string, RTCPeerConnection>;
  audioNodes: Map<string, { analyser: AnalyserNode }>;
  addDebugLog: (message: string) => void;
};

function useConnectionMetrics({
  connected,
  role,
  receiverPeers,
  transmitterPeers,
  audioNodes,
  addDebugLog,
}: Props) {
  const [audioLevels, setAudioLevels] = useState<Record<string, number[]>>({});
  const [latencies, setLatencies] = useState<Record<string, number | null>>({});
  const addDebugLogRef = useRef(addDebugLog);
  addDebugLogRef.current = addDebugLog;

  useEffect(() => {
    if (!connected) return;
    let active = true;
    const latencyTimer = window.setInterval(() => {
      const peers = role === "receiver" ? receiverPeers : transmitterPeers;
      void Promise.all(
        [...peers.entries()].map(async ([id, pc]) => {
          try {
            const stats = await pc.getStats();
            let selectedPairId: string | undefined;
            stats.forEach((report) => {
              if (report.type === "transport" && report.selectedCandidatePairId) {
                selectedPairId = report.selectedCandidatePairId;
              }
            });
            let roundTripTime: number | null = null;
            stats.forEach((report) => {
              const isSelected = selectedPairId
                ? report.id === selectedPairId
                : report.type === "candidate-pair" &&
                  report.state === "succeeded" &&
                  report.nominated;
              if (
                report.type === "candidate-pair" &&
                isSelected &&
                Number.isFinite(report.currentRoundTripTime)
              ) {
                roundTripTime = report.currentRoundTripTime * 1000;
              }
            });
            if (active) {
              setLatencies((current) => ({ ...current, [id]: roundTripTime }));
            }
          } catch (error) {
            addDebugLogRef.current(`RTC: falha ao medir latência de ${id}: ${error}`);
          }
        }),
      );
    }, 1000);
    const levelTimer =
      role === "receiver"
        ? window.setInterval(() => {
            const levels: Record<string, number[]> = {};
            audioNodes.forEach(({ analyser }, id) => {
              const samples = new Uint8Array(analyser.frequencyBinCount);
              analyser.getByteFrequencyData(samples);
              const bars = 24;
              levels[id] = Array.from({ length: bars }, (_, index) => {
                const start = Math.floor((index * samples.length) / bars);
                const end = Math.floor(((index + 1) * samples.length) / bars);
                let sum = 0;
                for (let sample = start; sample < end; sample++) sum += samples[sample];
                return end > start ? sum / (end - start) / 255 : 0;
              });
            });
            setAudioLevels(levels);
          }, 100)
        : undefined;
    return () => {
      active = false;
      window.clearInterval(latencyTimer);
      if (levelTimer !== undefined) window.clearInterval(levelTimer);
    };
  }, [connected, role, receiverPeers, transmitterPeers, audioNodes]);

  const removePeer = (id: string) => {
    setAudioLevels((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setLatencies((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const clear = () => {
    setAudioLevels({});
    setLatencies({});
  };

  return { audioLevels, latencies, removePeer, clear };
}

export default useConnectionMetrics;
