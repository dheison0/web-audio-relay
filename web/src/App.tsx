import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Slider,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";

const LocalSetupPage = lazy(() => import("./LocalSetupPage"));

type Role = "transmitter" | "receiver";
type Transmitter = {
  id: string;
  name: string;
  muted: boolean;
  noiseSuppression: boolean;
};
type AudioNodes = {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  silentGain: GainNode;
  audio: HTMLAudioElement;
};

type Message = {
  type: string;
  id?: string;
  name?: string;
  role?: string;
  muted?: boolean;
  noiseSuppression?: boolean;
  transmitters?: Transmitter[];
  receiverId?: string;
  senderId?: string;
  target?: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
};

function App() {
  const [role, setRole] = useState<Role>("transmitter");
  const [name, setName] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Desconectado");
  const [screenWakeLockStatus, setScreenWakeLockStatus] = useState<
    "inactive" | "active" | "unsupported" | "unavailable"
  >("inactive");
  const [transmitters, setTransmitters] = useState<Transmitter[]>([]);
  const [playing, setPlaying] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [receiveVolumes, setReceiveVolumes] = useState<Record<string, number>>({});
  const [noiseSuppressionByTransmitter, setNoiseSuppressionByTransmitter] =
    useState<Record<string, boolean>>({});
  const [audioLevels, setAudioLevels] = useState<Record<string, number[]>>({});
  const [latencies, setLatencies] = useState<Record<string, number | null>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef("");
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioNodesRef = useRef<Map<string, AudioNodes>>(new Map());
  const screenWakeLockRef = useRef<WakeLockSentinel | null>(null);
  const screenWakeLockRequestedRef = useRef(false);
  const transmitterPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const receiverPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const addDebugLog = (message: string) => {
    const entry = `${new Date().toLocaleTimeString()} ${message}`;
    console.log(`[AudioRelay] ${entry}`);
    setDebugLogs((current) => [entry, ...current].slice(0, 100));
  };

  const send = (message: Message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const closeConnection = () => {
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
    wsRef.current?.close();
    wsRef.current = null;
  };

  useEffect(() => () => closeConnection(), []);

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
      const volume = receiveVolumes[transmitterId] ?? 100;
      if (audio) {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        audio.volume = Math.min(volume / 100, 1);
        audio.muted = volume > 100;
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
        gain.gain.value = volume > 100 ? volume / 100 : 0;
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

  const connect = async () => {
    if (!name.trim()) {
      setStatus("Informe um nome");
      addDebugLog("Conexão: nome não informado");
      return;
    }

    addDebugLog(`Conexão: modo=${role} origem=${location.origin}`);
    if (!window.isSecureContext && location.hostname !== "localhost") {
      const message =
        "Microfone bloqueado: acesse pelo HTTPS ou por localhost. Navegadores não permitem microfone em HTTP de outro dispositivo.";
      setStatus(message);
      addDebugLog(message);
      return;
    }

    if (role === "transmitter") {
      try {
        addDebugLog("Microfone: solicitando acesso getUserMedia");
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        setPlaying(true);
        const track = localStreamRef.current.getAudioTracks()[0];
        addDebugLog(
          `Microfone: acesso concedido pista=${track?.label ?? "sem pista"} estado=${track?.readyState ?? "desconhecido"}`,
        );
      } catch (error) {
        closeConnection();
        setStatus("Não foi possível acessar o microfone");
        addDebugLog(`Microfone: getUserMedia falhou: ${error}`);
        return;
      }
    } else {
      try {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        await audioContext.resume();
      } catch (error) {
        setStatus("Não foi possível iniciar o áudio");
        addDebugLog(`Áudio receptor: falha ao iniciar AudioContext: ${error}`);
        return;
      }
    }

    clientIdRef.current = crypto.randomUUID();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setStatus("Conectado");
      addDebugLog(`WebSocket: conectado como ${role} id=${clientIdRef.current}`);
      send({
        type: "register",
        id: clientIdRef.current,
        name: name.trim(),
        role,
      });
    };

    ws.onclose = (event) => {
      setConnected(false);
      setStatus("Desconectado");
      addDebugLog(`WebSocket: fechado code=${event.code} reason=${event.reason || "sem motivo"}`);
    };

    ws.onerror = () => {
      addDebugLog(`WebSocket: erro na conexão com ${ws.url}`);
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data) as Message;
      addDebugLog(`WebSocket: recebido type=${message.type}`);
      switch (message.type) {
        case "presence":
          setTransmitters(message.transmitters ?? []);
          setNoiseSuppressionByTransmitter(
            Object.fromEntries(
              (message.transmitters ?? []).map((item) => [
                item.id,
                item.noiseSuppression ?? true,
              ]),
            ),
          );
          if (role === "receiver") {
            for (const transmitter of message.transmitters ?? []) {
              await connectReceiverTo(transmitter.id);
            }
          }
          break;
        case "transmitter_joined":
          if (message.id) {
            setTransmitters((current) => [
              ...current.filter((item) => item.id !== message.id),
              {
                id: message.id!,
                name: message.name ?? "Sem nome",
                muted: message.muted ?? false,
                noiseSuppression: message.noiseSuppression ?? true,
              },
            ]);
            setNoiseSuppressionByTransmitter((current) => ({
              ...current,
              [message.id!]: message.noiseSuppression ?? true,
            }));
            await connectReceiverTo(message.id);
          }
          break;
        case "transmitter_left":
          if (message.id) {
            receiverPeersRef.current.get(message.id)?.close();
            receiverPeersRef.current.delete(message.id);
            const nodes = audioNodesRef.current.get(message.id);
            nodes?.source.disconnect();
            nodes?.gain.disconnect();
            nodes?.analyser.disconnect();
            nodes?.silentGain.disconnect();
            audioNodesRef.current.delete(message.id);
            setAudioLevels((current) => {
              const next = { ...current };
              delete next[message.id!];
              return next;
            });
            setLatencies((current) => {
              const next = { ...current };
              delete next[message.id!];
              return next;
            });
            setNoiseSuppressionByTransmitter((current) => {
              const next = { ...current };
              delete next[message.id!];
              return next;
            });
            setTransmitters((current) => current.filter((item) => item.id !== message.id));
          }
          break;
        case "offer":
          await handleOffer(message.receiverId!, message.sdp);
          break;
        case "answer":
          await handleAnswer(message.senderId!, message.sdp);
          break;
        case "ice":
          await handleIce(message.senderId!, message.candidate);
          break;
        case "pause":
          setTransmitSending(false);
          setPlaying(false);
          break;
        case "resume":
          setTransmitSending(true);
          setPlaying(true);
          break;
        case "noise_suppression":
          if (role === "transmitter") {
            const track = localStreamRef.current?.getAudioTracks()[0];
            if (!track || message.noiseSuppression === undefined) {
              addDebugLog("Microfone: comando remoto de redução de ruído inválido");
              break;
            }
            try {
              await track.applyConstraints({
                ...track.getConstraints(),
                noiseSuppression: message.noiseSuppression,
              });
              send({
                type: "noise_suppression_updated",
                noiseSuppression: message.noiseSuppression,
              });
              addDebugLog(
                `Microfone: redução de ruído ${message.noiseSuppression ? "ativada" : "desativada"} remotamente`,
              );
            } catch (error) {
              send({
                type: "noise_suppression_error",
                name: `Não foi possível alterar a redução de ruído: ${error}`,
              });
              addDebugLog(`Microfone: falha no comando remoto de redução de ruído: ${error}`);
            }
          }
          break;
        case "noise_suppression_updated":
          if (message.id && message.noiseSuppression !== undefined) {
            setNoiseSuppressionByTransmitter((current) => ({
              ...current,
              [message.id!]: message.noiseSuppression!,
            }));
            setTransmitters((current) =>
              current.map((item) =>
                item.id === message.id
                  ? { ...item, noiseSuppression: message.noiseSuppression! }
                  : item,
              ),
            );
          }
          break;
        case "noise_suppression_error":
          setStatus(message.name ?? "Falha ao alterar redução de ruído");
          addDebugLog(`Redução de ruído remota: ${message.name ?? "falha sem detalhes"}`);
          break;
        case "mute_changed":
          if (message.id) {
            setTransmitters((current) =>
              current.map((item) =>
                item.id === message.id ? { ...item, muted: message.muted ?? false } : item,
              ),
            );
          }
          break;
        case "error":
          setStatus(message.name ?? "Erro");
          break;
      }
    };
  };

  const disconnect = () => {
    closeConnection();
    setConnected(false);
    setPlaying(false);
    setTransmitters([]);
    setAudioLevels({});
    setLatencies({});
    setNoiseSuppressionByTransmitter({});
    setStatus("Desconectado");
  };

  const toggleMute = (transmitter: Transmitter) => {
    send({ type: "mute", target: transmitter.id, muted: !transmitter.muted });
  };

  const updateNoiseSuppression = (transmitterId: string, enabled: boolean) => {
    send({
      type: "noise_suppression",
      target: transmitterId,
      noiseSuppression: enabled,
    });
  };

  const updateReceiveVolume = async (transmitterId: string, value: number) => {
    const nodes = audioNodesRef.current.get(transmitterId);
    if (value > 100 && nodes && audioContextRef.current?.state !== "running") {
      try {
        await audioContextRef.current?.resume();
      } catch (error) {
        addDebugLog(`Áudio receptor: falha ao habilitar amplificação: ${error}`);
        return;
      }
    }
    setReceiveVolumes((current) => ({ ...current, [transmitterId]: value }));
    if (nodes) {
      nodes.audio.volume = Math.min(value / 100, 1);
      nodes.audio.muted = value > 100;
      nodes.gain.gain.setTargetAtTime(
        value > 100 ? value / 100 : 0,
        nodes.gain.context.currentTime,
        0.02,
      );
    }
  };

  useEffect(() => {
    if (!connected) return;
    let active = true;
    const latencyTimer = window.setInterval(() => {
      const peers =
        role === "receiver" ? receiverPeersRef.current : transmitterPeersRef.current;
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
              if (report.type === "candidate-pair" && isSelected && Number.isFinite(report.currentRoundTripTime)) {
                roundTripTime = report.currentRoundTripTime * 1000;
              }
            });
            if (active) {
              setLatencies((current) => ({ ...current, [id]: roundTripTime }));
            }
          } catch (error) {
            addDebugLog(`RTC: falha ao medir latência de ${id}: ${error}`);
          }
        }),
      );
    }, 1000);
    const levelTimer =
      role === "receiver"
        ? window.setInterval(() => {
            const levels: Record<string, number[]> = {};
            audioNodesRef.current.forEach(({ analyser }, id) => {
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
  }, [connected, role]);

  useEffect(() => {
    const shouldKeepScreenAwake = connected && role === "transmitter" && playing;
    screenWakeLockRequestedRef.current = shouldKeepScreenAwake;

    const releaseScreenWakeLock = () => {
      const sentinel = screenWakeLockRef.current;
      screenWakeLockRef.current = null;
      if (sentinel) void sentinel.release();
    };

    if (!shouldKeepScreenAwake) {
      releaseScreenWakeLock();
      setScreenWakeLockStatus("inactive");
      return;
    }

    const requestScreenWakeLock = async () => {
      if (
        document.visibilityState !== "visible" ||
        screenWakeLockRef.current ||
        !screenWakeLockRequestedRef.current
      ) {
        return;
      }
      if (!("wakeLock" in navigator)) {
        setScreenWakeLockStatus("unsupported");
        return;
      }

      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (!screenWakeLockRequestedRef.current) {
          void sentinel.release();
          return;
        }
        screenWakeLockRef.current = sentinel;
        setScreenWakeLockStatus("active");
        addDebugLog("Tela: bloqueio de suspensão ativado durante a transmissão");
        sentinel.addEventListener(
          "release",
          () => {
            if (screenWakeLockRef.current === sentinel) {
              screenWakeLockRef.current = null;
              setScreenWakeLockStatus("unavailable");
              addDebugLog("Tela: bloqueio de suspensão liberado pelo navegador ou sistema");
            }
          },
          { once: true },
        );
      } catch (error) {
        setScreenWakeLockStatus("unavailable");
        addDebugLog(`Tela: não foi possível manter a tela ativa: ${error}`);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestScreenWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void requestScreenWakeLock();

    return () => {
      screenWakeLockRequestedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseScreenWakeLock();
    };
  }, [connected, playing, role]);

  const isLoopbackHost =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]" ||
    location.hostname === "::1";
  if (location.protocol === "http:" && !isLoopbackHost) {
    return (
      <Suspense fallback={<Typography sx={{ p: 4 }}>Carregando instruções...</Typography>}>
        <LocalSetupPage />
      </Suspense>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Typography variant="h4" component="h1">
          Transmissão de áudio
        </Typography>

        <Card>
          <CardContent>
            <Stack spacing={2}>
              <TextField
                label="Nome"
                value={name}
                disabled={connected}
                onChange={(event) => setName(event.target.value)}
              />
              <ToggleButtonGroup
                exclusive
                fullWidth
                value={role}
                disabled={connected}
                onChange={(_, value: Role | null) => value && setRole(value)}
              >
                <ToggleButton value="transmitter">
                  <MicIcon sx={{ mr: 1 }} /> Transmissor
                </ToggleButton>
                <ToggleButton value="receiver">
                  <VolumeUpIcon sx={{ mr: 1 }} /> Receptor
                </ToggleButton>
              </ToggleButtonGroup>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={connect} disabled={connected}>
                  Conectar
                </Button>
                <Button variant="outlined" onClick={disconnect} disabled={!connected}>
                  Desconectar
                </Button>
              </Stack>
              <Alert severity={connected ? "success" : "info"}>{status}</Alert>
              {connected && role === "transmitter" && (
                <Alert
                  severity={screenWakeLockStatus === "active" ? "success" : "warning"}
                >
                  {screenWakeLockStatus === "active"
                    ? "Tela configurada para permanecer ligada enquanto transmite. Não bloqueie o celular manualmente."
                    : screenWakeLockStatus === "unsupported"
                      ? "Este navegador não oferece o recurso para manter a tela ligada. Mantenha-a acesa manualmente."
                      : screenWakeLockStatus === "unavailable"
                        ? "Não foi possível manter a tela ligada. Volte à página ou mantenha a tela acesa manualmente."
                        : "Ativando a proteção para manter a tela ligada durante a transmissão..."}
                </Alert>
              )}
            </Stack>
          </CardContent>
        </Card>

        {connected && role === "transmitter" && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Stack direction="row" spacing={1} alignItems="center">
                  {playing ? <MicIcon color="success" /> : <MicOffIcon color="warning" />}
                  <Typography>
                    {playing ? "Microfone transmitindo" : "Transmissão pausada"}
                  </Typography>
                </Stack>
                <Typography variant="h6">Conexões com receptores</Typography>
                {transmitterPeersRef.current.size === 0 ? (
                  <Typography color="text.secondary">Aguardando receptores</Typography>
                ) : (
                  <List dense disablePadding>
                    {[...transmitterPeersRef.current.keys()].map((receiverId) => (
                      <ListItem key={receiverId} disableGutters>
                        <ListItemText
                          primary={`Receptor ${receiverId.slice(0, 8)}`}
                          secondary={`Latência (RTT): ${
                            latencies[receiverId] == null
                              ? "calculando..."
                              : `${Math.round(latencies[receiverId] ?? 0)} ms`
                          }`}
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
              </Stack>
            </CardContent>
          </Card>
        )}

        {connected && role === "receiver" && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Transmissores
              </Typography>
              {transmitters.length === 0 ? (
                <Typography color="text.secondary">Nenhum transmissor conectado</Typography>
              ) : (
                <List>
                  {transmitters.map((transmitter) => (
                    <Box key={transmitter.id}>
                      <ListItem
                        secondaryAction={
                          <IconButton
                            edge="end"
                            aria-label={transmitter.muted ? "Reativar" : "Silenciar"}
                            onClick={() => toggleMute(transmitter)}
                          >
                            {transmitter.muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
                          </IconButton>
                        }
                      >
                        <ListItemText
                          primary={transmitter.name}
                          secondary={`${transmitter.muted ? "Silenciado" : "Ativo"} · Latência (RTT): ${
                            latencies[transmitter.id] == null
                              ? "calculando..."
                              : `${Math.round(latencies[transmitter.id] ?? 0)} ms`
                          }`}
                        />
                      </ListItem>
                      <audio id={`audio-${transmitter.id}`} autoPlay playsInline />
                      <Stack spacing={1} sx={{ px: 2, pb: 2 }}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={noiseSuppressionByTransmitter[transmitter.id] ?? true}
                              onChange={(event) =>
                                updateNoiseSuppression(transmitter.id, event.target.checked)
                              }
                            />
                          }
                          label="Redução de ruído no microfone"
                        />
                        <Box
                          role="img"
                          aria-label={`Nível de áudio de ${transmitter.name}`}
                          sx={{
                            display: "flex",
                            alignItems: "end",
                            gap: 0.5,
                            height: 40,
                            px: 1,
                          }}
                        >
                          {(audioLevels[transmitter.id] ?? Array(24).fill(0)).map(
                            (level, index) => (
                              <Box
                                key={index}
                                sx={{
                                  flex: 1,
                                  minWidth: 2,
                                  height: `${Math.max(4, level * 100)}%`,
                                  borderRadius: 1,
                                  bgcolor: transmitter.muted ? "text.disabled" : "success.main",
                                  transition: "height 100ms linear",
                                }}
                              />
                            ),
                          )}
                        </Box>
                        <Box>
                          <Typography variant="body2" gutterBottom>
                            Volume: {receiveVolumes[transmitter.id] ?? 100}%
                          </Typography>
                          <Slider
                            aria-label={`Volume de ${transmitter.name}`}
                            min={0}
                            max={200}
                            step={5}
                            value={receiveVolumes[transmitter.id] ?? 100}
                            onChange={(_, value) => {
                              if (typeof value === "number") {
                                void updateReceiveVolume(transmitter.id, value);
                              }
                            }}
                          />
                        </Box>
                      </Stack>
                    </Box>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Log do sistema
            </Typography>
            {debugLogs.length === 0 ? (
              <Typography color="text.secondary">Nenhum evento registrado</Typography>
            ) : (
              <Box
                component="pre"
                sx={{
                  m: 0,
                  maxHeight: 280,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  fontSize: 12,
                }}
              >
                {debugLogs.join("\n")}
              </Box>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}

export default App;
