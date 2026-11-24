import { useRef } from "react";
import type { AudioNodes, Message } from "../types";

type Props = {
  send: (message: Message) => void;
  addDebugLog: (message: string) => void;
  receiveVolumes: Record<string, number>;
  includesParticipant: (name: string) => boolean;
};

function usePeerConnections({
  send,
  addDebugLog,
  receiveVolumes,
  includesParticipant,
}: Props) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<Map<string, AudioNodes>>(new Map());
  const transmitterPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const receiverPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const transmitterNamesRef = useRef<Map<string, string>>(new Map());
  const receiveVolumesRef = useRef(receiveVolumes);
  const includesParticipantRef = useRef(includesParticipant);
  receiveVolumesRef.current = receiveVolumes;
  includesParticipantRef.current = includesParticipant;

  const connectReceiverTo = async (transmitterId: string) => {
    if (receiverPeersRef.current.has(transmitterId)) return;
    const pc = new RTCPeerConnection();
    receiverPeersRef.current.set(transmitterId, pc);
    try {
      pc.addTransceiver("audio", { direction: "recvonly" });
      addDebugLog("RTC receptor: transceiver de áudio recvonly criado");
    } catch (error) {
      addDebugLog(`RTC receptor: falha ao criar transceiver de áudio: ${error}`);
    }
    addDebugLog(`RTC receptor: iniciando conexão com transmissor ${transmitterId}`);

    pc.oniceconnectionstatechange = () => {
      addDebugLog(`RTC receptor ICE=${pc.iceConnectionState} conexão=${pc.connectionState}`);
    };
    pc.onsignalingstatechange = () => {
      addDebugLog(`RTC receptor sinalização=${pc.signalingState}`);
    };
    pc.onicecandidateerror = (event) => {
      addDebugLog(`RTC receptor erro ICE: code=${event.errorCode} texto=${event.errorText}`);
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        addDebugLog(`RTC receptor: candidato ICE enviado (${event.candidate.type ?? "desconhecido"})`);
        send({
          type: "ice",
          target: transmitterId,
          candidate: event.candidate.toJSON(),
        });
      }
    };
    pc.ontrack = (event) => {
      addDebugLog(`RTC receptor: pista recebida kind=${event.track.kind} streams=${event.streams.length}`);
      const audioContext = audioContextRef.current;
      const audio = document.getElementById(`audio-${transmitterId}`) as HTMLAudioElement | null;
      const volume = receiveVolumesRef.current[transmitterId] ?? 100;
      const selected = includesParticipantRef.current(
        transmitterNamesRef.current.get(transmitterId) ?? "",
      );
      if (audio) {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        audio.volume = Math.min(volume / 100, 1);
        audio.muted = !selected || volume > 100;
        void audio.play()
          .then(() => addDebugLog(`Áudio receptor: reprodução iniciada para ${transmitterId}`))
          .catch((error) =>
            addDebugLog(`Áudio receptor: autoplay bloqueado ou falha: ${error}`),
          );
      }
      if (audioContext && audio) {
        const previous = audioNodesRef.current.get(transmitterId);
        previous?.source.disconnect();
        previous?.gain.disconnect();
        previous?.analyser.disconnect();
        previous?.silentGain.disconnect();
        const source = audioContext.createMediaStreamSource(
          event.streams[0] ?? new MediaStream([event.track]),
        );
        const gain = audioContext.createGain();
        const analyser = audioContext.createAnalyser();
        const silentGain = audioContext.createGain();
        analyser.fftSize = 256;
        gain.gain.value = selected && volume > 100 ? volume / 100 : 0;
        silentGain.gain.value = 0;
        source.connect(gain);
        gain.connect(audioContext.destination);
        source.connect(analyser);
        analyser.connect(silentGain);
        silentGain.connect(audioContext.destination);
        audioNodesRef.current.set(transmitterId, {
          source,
          gain,
          analyser,
          silentGain,
          audio,
        });
        void audioContext.resume().catch((error) =>
          addDebugLog(`Áudio receptor: falha ao iniciar reprodução: ${error}`),
        );
        addDebugLog(`Áudio receptor: processamento iniciado para ${transmitterId}`);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      addDebugLog(`RTC receptor: oferta criada sdp=${pc.localDescription?.sdp.length ?? 0} bytes`);
      send({ type: "offer", target: transmitterId, sdp: pc.localDescription?.sdp });
    } catch (error) {
      addDebugLog(`RTC receptor: falha ao criar oferta: ${error}`);
    }
  };

  const handleOffer = async (receiverId: string, sdp?: string) => {
    if (!sdp) return;
    let pc = transmitterPeersRef.current.get(receiverId);
    if (!pc) {
      pc = new RTCPeerConnection();
      transmitterPeersRef.current.set(receiverId, pc);
      addDebugLog(`RTC transmissor: PeerConnection criada para receptor ${receiverId}`);
      pc.oniceconnectionstatechange = () => {
        addDebugLog(`RTC transmissor ICE=${pc!.iceConnectionState} conexão=${pc!.connectionState}`);
      };
      pc.onsignalingstatechange = () => {
        addDebugLog(`RTC transmissor sinalização=${pc!.signalingState}`);
      };
      pc.onicecandidateerror = (event) => {
        addDebugLog(`RTC transmissor erro ICE: code=${event.errorCode} texto=${event.errorText}`);
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addDebugLog(`RTC transmissor: candidato ICE enviado (${event.candidate.type ?? "desconhecido"})`);
          send({
            type: "ice",
            target: receiverId,
            candidate: event.candidate.toJSON(),
          });
        }
      };
      const stream = localStreamRef.current;
      if (stream) {
        const tracks = stream.getAudioTracks();
        addDebugLog(`RTC transmissor: adicionando ${tracks.length} pista(s) de áudio`);
        tracks.forEach((track) => {
          track.onmute = () => addDebugLog("Microfone: pista mudou para mute");
          track.onunmute = () => addDebugLog("Microfone: pista mudou para ativo");
          track.onended = () => addDebugLog("Microfone: pista encerrada");
          pc!.addTrack(track, stream);
        });
      }
    }

    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      addDebugLog(`RTC transmissor: oferta recebida sdp=${sdp.length} bytes`);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      addDebugLog(`RTC transmissor: resposta criada sdp=${pc.localDescription?.sdp.length ?? 0} bytes`);
      send({ type: "answer", target: receiverId, sdp: pc.localDescription?.sdp });
      const pending = pendingIceRef.current.get(receiverId) ?? [];
      for (const candidate of pending) {
        await pc.addIceCandidate(candidate);
      }
      pendingIceRef.current.delete(receiverId);
      if (pending.length > 0) {
        addDebugLog(`RTC transmissor: ${pending.length} candidato(s) ICE pendente(s) aplicado(s)`);
      }
    } catch (error) {
      addDebugLog(`RTC transmissor: falha ao processar oferta: ${error}`);
    }
  };

  const handleAnswer = async (senderId: string, sdp?: string) => {
    if (!sdp) return;
    const pc = receiverPeersRef.current.get(senderId);
    if (pc && pc.signalingState !== "stable") {
      try {
        await pc.setRemoteDescription({ type: "answer", sdp });
        addDebugLog(`RTC receptor: resposta recebida de ${senderId} sdp=${sdp.length} bytes`);
        const pending = pendingIceRef.current.get(senderId) ?? [];
        for (const candidate of pending) {
          await pc.addIceCandidate(candidate);
        }
        pendingIceRef.current.delete(senderId);
        if (pending.length > 0) {
          addDebugLog(`RTC receptor: ${pending.length} candidato(s) ICE pendente(s) aplicado(s)`);
        }
      } catch (error) {
        addDebugLog(`RTC receptor: falha ao processar resposta: ${error}`);
      }
    }
  };

  const handleIce = async (senderId: string, candidate?: RTCIceCandidateInit) => {
    if (!candidate) return;
    const pc =
      receiverPeersRef.current.get(senderId) ??
      transmitterPeersRef.current.get(senderId);
    if (pc) {
      try {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
          addDebugLog(`RTC: candidato ICE recebido de ${senderId}`);
        } else {
          const pending = pendingIceRef.current.get(senderId) ?? [];
          pending.push(candidate);
          pendingIceRef.current.set(senderId, pending);
          addDebugLog(`RTC: candidato ICE de ${senderId} aguardando descrição remota`);
        }
      } catch (error) {
        addDebugLog(`RTC: falha ao adicionar ICE de ${senderId}: ${error}`);
      }
    } else {
      const pending = pendingIceRef.current.get(senderId) ?? [];
      pending.push(candidate);
      pendingIceRef.current.set(senderId, pending);
      addDebugLog(`RTC: candidato ICE de ${senderId} aguardando criação da PeerConnection`);
    }
  };

  const setTransmitSending = (sending: boolean) => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    transmitterPeersRef.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === "audio" || !sender.track) {
          if (sending) {
            if (track) void sender.replaceTrack(track);
          } else {
            void sender.replaceTrack(null);
          }
        }
      });
    });
  };

  const closeAudioResources = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    audioNodesRef.current.forEach(({ source, gain, analyser, silentGain }) => {
      source.disconnect();
      gain.disconnect();
      analyser.disconnect();
      silentGain.disconnect();
    });
    audioNodesRef.current.clear();
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch((error) => console.error("Falha ao fechar AudioContext:", error));
    }
    transmitterPeersRef.current.forEach((pc) => pc.close());
    receiverPeersRef.current.forEach((pc) => pc.close());
    transmitterPeersRef.current.clear();
    receiverPeersRef.current.clear();
    pendingIceRef.current.clear();
  };

  return {
    localStreamRef,
    audioContextRef,
    audioNodesRef,
    transmitterPeersRef,
    receiverPeersRef,
    pendingIceRef,
    transmitterNamesRef,
    connectReceiverTo,
    handleOffer,
    handleAnswer,
    handleIce,
    setTransmitSending,
    closeAudioResources,
  };
}

export default usePeerConnections;
