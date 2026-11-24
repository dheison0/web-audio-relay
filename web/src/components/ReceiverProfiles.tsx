import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { ReceiverProfile, Transmitter } from "../types";

type Props = {
  profiles: ReceiverProfile[];
  activeProfile: ReceiverProfile;
  transmitters: Transmitter[];
  storageError: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => string | null;
  onDelete: (id: string) => void;
  onToggleParticipant: (name: string) => void;
  includesParticipant: (name: string) => boolean;
};

function ReceiverProfiles({
  profiles,
  activeProfile,
  transmitters,
  storageError,
  onSelect,
  onCreate,
  onDelete,
  onToggleParticipant,
  includesParticipant,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [error, setError] = useState("");

  const addProfile = () => {
    const result = onCreate(profileName);
    if (result) {
      setError(result);
      return;
    }
    setDialogOpen(false);
    setProfileName("");
    setError("");
  };

  const participantNames = [
    ...new Set([
      ...transmitters.map((item) => item.name),
      ...activeProfile.participantNames,
    ]),
  ];

  return (
    <Stack spacing={2}>
      {storageError && <Alert severity="warning">{storageError}</Alert>}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ overflowX: "auto" }}>
        {profiles.map((profile) => (
          <Chip
            key={profile.id}
            label={profile.name}
            color={profile.id === activeProfile.id ? "primary" : "default"}
            variant={profile.id === activeProfile.id ? "filled" : "outlined"}
            onClick={() => onSelect(profile.id)}
            onDelete={
              profile.all ? undefined : () => onDelete(profile.id)
            }
            deleteIcon={
              <Tooltip title={`Excluir perfil ${profile.name}`}>
                <DeleteOutlineIcon />
              </Tooltip>
            }
          />
        ))}
        <Tooltip title="Adicionar perfil">
          <IconButton aria-label="Adicionar perfil" onClick={() => setDialogOpen(true)}>
            <AddIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Perfil ativo: {activeProfile.name}. O mute dos transmissores continua sendo controlado separadamente.
      </Typography>
      {!activeProfile.all && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Reproduzir neste perfil
          </Typography>
          {participantNames.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nenhum transmissor conectado. Os participantes por nome salvos neste perfil serão considerados quando conectarem.
            </Typography>
          ) : (
            <Stack direction="row" flexWrap="wrap" columnGap={2}>
              {participantNames.map((name) => (
                <FormControlLabel
                  key={name}
                  control={
                    <Checkbox
                      checked={includesParticipant(name)}
                      onChange={() => onToggleParticipant(name)}
                    />
                  }
                  label={`${name}${transmitters.some((item) => item.name === name) ? "" : " (desconectado)"}`}
                />
              ))}
            </Stack>
          )}
        </Box>
      )}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Adicionar perfil</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              label="Nome do perfil"
              value={profileName}
              onChange={(event) => {
                setProfileName(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") addProfile();
              }}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={addProfile}>Criar</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export default ReceiverProfiles;
