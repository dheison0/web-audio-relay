import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import LockIcon from "@mui/icons-material/Lock";
import CertificateInstallationInstructions from "./components/CertificateInstallationInstructions";

type SetupInfo = {
  httpsUrl: string;
  fingerprint: string;
};

function LocalSetupPage() {
  const [setupInfo, setSetupInfo] = useState<SetupInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/setup-info", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await response.text());
        }
        return (await response.json()) as SetupInfo;
      })
      .then((info) => {
        if (active) setSetupInfo(info);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Preparar acesso seguro
          </Typography>
          <Typography color="text.secondary">
            Instale a autoridade certificadora local uma vez neste aparelho.
            Depois, abra o Audio Relay por HTTPS para liberar o microfone.
          </Typography>
        </Box>

        <Alert severity="warning">
          Enquanto esta CA estiver instalada, o aparelho confiará em certificados
          emitidos pelo notebook. Instale-a somente em dispositivos que você
          administra e confia. Nunca compartilhe a chave privada da autoridade.
        </Alert>

        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">1. Confira a identidade do certificado</Typography>
              {error ? (
                <Alert severity="error">{error}</Alert>
              ) : setupInfo ? (
                <Box>
                  <Typography variant="body2">
                    Compare a impressão digital SHA-256 abaixo com a exibida no
                    terminal do notebook antes de instalar:
                  </Typography>
                  <Typography
                    component="code"
                    sx={{ display: "block", mt: 1, overflowWrap: "anywhere" }}
                  >
                    {setupInfo.fingerprint}
                  </Typography>
                </Box>
              ) : (
                <CircularProgress size={24} />
              )}
              <Typography variant="body2" color="text.secondary">
                Se os valores forem diferentes, não instale o certificado.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6">2. Baixe o certificado</Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button
                  component="a"
                  href="/ca.cer"
                  variant="contained"
                  startIcon={<DownloadIcon />}
                >
                  Baixar CA para Android (.cer)
                </Button>
                <Button
                  component="a"
                  href="/ca.mobileconfig"
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                >
                  Baixar perfil para iPhone/iPad
                </Button>
                <Button
                  component="a"
                  href="/ca.crt"
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                >
                  Baixar CA para Windows/Linux (.crt)
                </Button>
                <Button
                  component="a"
                  href={setupInfo?.httpsUrl ?? "#"}
                  variant="contained"
                  color="success"
                  startIcon={<LockIcon />}
                  disabled={!setupInfo}
                >
                  Abrir versão HTTPS
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                O perfil para iOS contém o mesmo certificado CA; não contém a chave
                privada.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Primeiro instale o certificado e só então abra a versão HTTPS.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h6">3. Instale e confie no certificado</Typography>
              <CertificateInstallationInstructions />
            </Stack>
          </CardContent>
        </Card>

        <Typography variant="body2" color="text.secondary">
          Depois de instalar, use o endereço HTTPS. O endereço HTTP serve apenas
          para baixar o certificado e consultar estas instruções. Para remover a
          confiança no futuro, apague “Audio Relay Local CA” nas configurações de
          certificados do aparelho.
        </Typography>
      </Stack>
    </Container>
  );
}

export default LocalSetupPage;
