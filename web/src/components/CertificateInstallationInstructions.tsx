import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Link,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

function CertificateInstallationInstructions() {
  return (
    <>
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
            ativar a confiança total em Ajustes de Confiança de Certificados.{" "}
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
    </>
  );
}

export default CertificateInstallationInstructions;
