import {
  Box,
  Card,
  CardContent,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Slider,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import ReceiverProfiles from "./ReceiverProfiles";
import type { ReceiverProfile, Transmitter } from "../types";

type Props = {
  profiles: ReceiverProfile[];
  activeProfile: ReceiverProfile;
  transmitters: Transmitter[];
  receiveVolumes: Record<string, number>;
  noiseSuppressionByTransmitter: Record<string, boolean>;
  audioLevels: Record<string, number[]>;
  latencies: Record<string, number | null>;
  storageError: string | null;
  onSelectProfile: (id: string) => void;
  onCreateProfile: (name: string) => string | null;
  onDeleteProfile: (id: string) => void;
  onToggleParticipant: (name: string) => void;
  includesParticipant: (name: string) => boolean;
  onToggleMute: (transmitter: Transmitter) => void;
  onUpdateNoiseSuppression: (id: string, enabled: boolean) => void;
  onUpdateReceiveVolume: (id: string, volume: number) => void;
};

function ReceiverPanel({
  profiles,
  activeProfile,
  transmitters,
  receiveVolumes,
  noiseSuppressionByTransmitter,
  audioLevels,
  latencies,
  storageError,
  onSelectProfile,
  onCreateProfile,
  onDeleteProfile,
  onToggleParticipant,
  includesParticipant,
  onToggleMute,
  onUpdateNoiseSuppression,
  onUpdateReceiveVolume,
}: Props) {
  return (
    <Card>
      <CardContent>
        <ReceiverProfiles
          profiles={profiles}
          activeProfile={activeProfile}
          transmitters={transmitters}
          storageError={storageError}
          onSelect={onSelectProfile}
          onCreate={onCreateProfile}
          onDelete={onDeleteProfile}
          onToggleParticipant={onToggleParticipant}
          includesParticipant={includesParticipant}
        />
        <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
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
                      onClick={() => onToggleMute(transmitter)}
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
                          onUpdateNoiseSuppression(transmitter.id, event.target.checked)
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
                          onUpdateReceiveVolume(transmitter.id, value);
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
  );
}

export default ReceiverPanel;
