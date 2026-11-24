import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Container,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import SystemLog from "./components/SystemLog";
import {
  useLocalProfiles,
  useStoredNickname,
  useStoredRole,
} from "./hooks/useLocalPreferences";
import usePeerConnections from "./hooks/usePeerConnections";
import useConnectionMetrics from "./hooks/useConnectionMetrics";
import useScreenWakeLock from "./hooks/useScreenWakeLock";
import type { Message, Role, Transmitter } from "./types";

const LocalSetupPage = lazy(() => import("./LocalSetupPage"));
const ReceiverPanel = lazy(() => import("./components/ReceiverPanel"));

function App() {
  const [role, setRole] = useStoredRole();
  const [name, setName] = useStoredNickname();
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Desconectado");
  const [transmitters, setTransmitters] = useState<Transmitter[]>([]);
  const [playing, setPlaying] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [receiveVolumes, setReceiveVolumes] = useState<Record<string, number>>({});
  const [noiseSuppressionByTransmitter, setNoiseSuppressionByTransmitter] =
    useState<Record<string, boolean>>({});
  const profiles = useLocalProfiles(transmitters);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef("");

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

  const peers = usePeerConnections({
    send,
    addDebugLog,
    receiveVolumes,
    includesParticipant: profiles.includesParticipant,
  });
  const metrics = useConnectionMetrics({
    connected,
    role,
    receiverPeers: peers.receiverPeersRef.current,
    transmitterPeers: peers.transmitterPeersRef.current,
    audioNodes: peers.audioNodesRef.current,
    addDebugLog,
  });
  const screenWakeLockStatus = useScreenWakeLock(connected, role, playing, addDebugLog);

  const closeConnection = () => {
    peers.closeAudioResources();
    wsRef.current?.close();
    wsRef.current = null;
  };

  useEffect(() => () => closeConnection(), []);

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
        peers.localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        setPlaying(true);
        const track = peers.localStreamRef.current.getAudioTracks()[0];
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
        peers.audioContextRef.current = audioContext;
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
          peers.transmitterNamesRef.current = new Map(
            (message.transmitters ?? []).map((item) => [item.id, item.name]),
          );
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
              await peers.connectReceiverTo(transmitter.id);
            }
          }
          break;
        case "transmitter_joined":
          if (message.id) {
            peers.transmitterNamesRef.current.set(message.id, message.name ?? "Sem nome");
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
            await peers.connectReceiverTo(message.id);
          }
          break;
        case "transmitter_left":
          if (message.id) {
            peers.transmitterNamesRef.current.delete(message.id);
            peers.receiverPeersRef.current.get(message.id)?.close();
            peers.receiverPeersRef.current.delete(message.id);
            const nodes = peers.audioNodesRef.current.get(message.id);
            nodes?.source.disconnect();
            nodes?.gain.disconnect();
            nodes?.analyser.disconnect();
            nodes?.silentGain.disconnect();
            peers.audioNodesRef.current.delete(message.id);
            metrics.removePeer(message.id);
            setNoiseSuppressionByTransmitter((current) => {
              const next = { ...current };
              delete next[message.id!];
              return next;
            });
            setTransmitters((current) => current.filter((item) => item.id !== message.id));
          }
          break;
        case "offer":
          await peers.handleOffer(message.receiverId!, message.sdp);
          break;
        case "answer":
          await peers.handleAnswer(message.senderId!, message.sdp);
          break;
        case "ice":
          await peers.handleIce(message.senderId!, message.candidate);
          break;
        case "pause":
          peers.setTransmitSending(false);
          setPlaying(false);
          break;
        case "resume":
          peers.setTransmitSending(true);
          setPlaying(true);
          break;
        case "noise_suppression":
          if (role === "transmitter") {
            const track = peers.localStreamRef.current?.getAudioTracks()[0];
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
    peers.transmitterNamesRef.current.clear();
    metrics.clear();
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
    const nodes = peers.audioNodesRef.current.get(transmitterId);
    const selected = profiles.includesParticipant(
      peers.transmitterNamesRef.current.get(transmitterId) ?? "",
    );
    if (value > 100 && nodes && peers.audioContextRef.current?.state !== "running") {
      try {
        await peers.audioContextRef.current?.resume();
      } catch (error) {
        addDebugLog(`Áudio receptor: falha ao habilitar amplificação: ${error}`);
        return;
      }
    }
    setReceiveVolumes((current) => ({ ...current, [transmitterId]: value }));
    if (nodes) {
      nodes.audio.volume = Math.min(value / 100, 1);
      nodes.audio.muted = !selected || value > 100;
      nodes.gain.gain.setTargetAtTime(
        selected && value > 100 ? value / 100 : 0,
        nodes.gain.context.currentTime,
        0.02,
      );
    }
  };

  useEffect(() => {
    if (role !== "receiver") return;
    for (const transmitter of transmitters) {
      const nodes = peers.audioNodesRef.current.get(transmitter.id);
      const audio =
        nodes?.audio ??
        (document.getElementById(`audio-${transmitter.id}`) as HTMLAudioElement | null);
      const selected = profiles.includesParticipant(transmitter.name);
      const volume = receiveVolumes[transmitter.id] ?? 100;
      if (audio) {
        audio.volume = Math.min(volume / 100, 1);
        audio.muted = !selected || volume > 100;
      }
      if (nodes) {
        nodes.gain.gain.setTargetAtTime(
          selected && volume > 100 ? volume / 100 : 0,
          nodes.gain.context.currentTime,
          0.02,
        );
      }
    }
  }, [profiles.activeProfile, profiles.includesParticipant, receiveVolumes, role, transmitters]);

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
                {peers.transmitterPeersRef.current.size === 0 ? (
                  <Typography color="text.secondary">Aguardando receptores</Typography>
                ) : (
                  <List dense disablePadding>
                    {[...peers.transmitterPeersRef.current.keys()].map((receiverId) => (
                      <ListItem key={receiverId} disableGutters>
                        <ListItemText
                          primary={`Receptor ${receiverId.slice(0, 8)}`}
                          secondary={`Latência (RTT): ${
                            metrics.latencies[receiverId] == null
                              ? "calculando..."
                              : `${Math.round(metrics.latencies[receiverId] ?? 0)} ms`
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
          <Suspense fallback={<Typography>Carregando receptores...</Typography>}>
            <ReceiverPanel
              profiles={profiles.profiles}
              activeProfile={profiles.activeProfile}
              transmitters={transmitters}
              receiveVolumes={receiveVolumes}
              noiseSuppressionByTransmitter={noiseSuppressionByTransmitter}
              audioLevels={metrics.audioLevels}
              latencies={metrics.latencies}
              storageError={profiles.storageError}
              onSelectProfile={profiles.setActiveProfileId}
              onCreateProfile={profiles.createProfile}
              onDeleteProfile={profiles.deleteProfile}
              onToggleParticipant={profiles.toggleParticipant}
              includesParticipant={profiles.includesParticipant}
              onToggleMute={toggleMute}
              onUpdateNoiseSuppression={updateNoiseSuppression}
              onUpdateReceiveVolume={(id, value) => void updateReceiveVolume(id, value)}
            />
          </Suspense>
        )}

        <SystemLog entries={debugLogs} />
      </Stack>
    </Container>
  );
}

export default App;
