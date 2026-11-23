import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DownloadIcon from "@mui/icons-material/Download";
import LockIcon from "@mui/icons-material/Lock";

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
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>Android</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography component="div">
                    <ol>
                      <li>Baixe o certificado CA em formato DER (<code>audio-relay-local-ca.cer</code>) e compare a impressão digital com o terminal do notebook.</li>
                      <li>Abra Configurações e procure por “Instalar certificado” ou “Certificado CA”.</li>
                      <li>Em muitos aparelhos: Segurança e privacidade → Mais configurações de segurança → Criptografia e credenciais → Instalar um certificado → Certificado CA.</li>
                      <li>Selecione <code>audio-relay-local-ca.crt</code> e confirme o aviso do Android.</li>
                      <li>Volte a esta página e toque em “Abrir Audio Relay por HTTPS”.</li>
                    </ol>
                  </Typography>
                  <Alert severity="info">
                    Os nomes dos menus variam conforme o fabricante e a versão do Android.
                  </Alert>
                </AccordionDetails>
              </Accordion>

              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>iPhone e iPad (iOS/iPadOS)</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography component="div">
                    <ol>
                      <li>Baixe o perfil para iPhone/iPad e compare a impressão digital com o terminal do notebook.</li>
                      <li>Abra Ajustes; toque em “Perfil Baixado” ou acesse Geral → VPN e Gerenciamento de Dispositivo.</li>
                      <li>Selecione “Audio Relay Local CA” e toque em Instalar. Confirme os avisos.</li>
                      <li>Para confiar em HTTPS: Ajustes → Geral → Sobre → Ajustes de Confiança de Certificados; ative a confiança total para “Audio Relay Local CA”.</li>
                      <li>Volte a esta página e toque em “Abrir Audio Relay por HTTPS”.</li>
                    </ol>
                  </Typography>
                  <Alert severity="info">
                    No iOS/iPadOS, instalar o perfil não basta: também é necessário
                    ativar a confiança total em Ajustes de Confiança de Certificados.
                    {" "}
                    <Link
                      href="https://support.apple.com/en-us/102390"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Instruções oficiais da Apple
                    </Link>
                  </Alert>
                </AccordionDetails>
              </Accordion>

              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>Windows</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography component="div">
                    <ol>
                      <li>Baixe <code>audio-relay-local-ca.crt</code> (PEM) e compare a impressão digital com o terminal.</li>
                      <li>Abra o arquivo <code>audio-relay-local-ca.crt</code> e escolha Instalar Certificado.</li>
                      <li>Selecione Usuário Atual, escolha “Colocar todos os certificados no repositório a seguir” e selecione “Autoridades de Certificação Raiz Confiáveis”.</li>
                      <li>Confirme a instalação e abra o endereço HTTPS em um navegador que use o repositório de certificados do Windows.</li>
                    </ol>
                  </Typography>
                </AccordionDetails>
              </Accordion>

              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>Linux</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography component="div">
                    <ol>
                      <li>Baixe <code>audio-relay-local-ca.crt</code> (PEM) e compare a impressão digital com o terminal.</li>
                      <li>No Ubuntu/Debian, copie o arquivo para <code>/usr/local/share/ca-certificates/audio-relay-local-ca.crt</code> e execute <code>sudo update-ca-certificates</code>.</li>
                      <li>No Fedora, copie para <code>/etc/pki/ca-trust/source/anchors/audio-relay-local-ca.crt</code> e execute <code>sudo update-ca-trust</code>.</li>
                      <li>Reinicie o navegador e abra o endereço HTTPS. O Firefox pode exigir importar o certificado nas configurações de autoridades.</li>
                    </ol>
                  </Typography>
                </AccordionDetails>
              </Accordion>
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
