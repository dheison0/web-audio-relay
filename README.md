# Transmissão de áudio

Aplicação local para transmitir áudio de vários microfones simultaneamente para receptores em uma rede LAN.

## Requisitos

- Go 1.23 ou superior para desenvolvimento/build
- Node.js 20 ou superior para desenvolvimento/build
- Navegador moderno com suporte a WebRTC e microfone

## Uso no notebook e celulares

Ao iniciar, o servidor abre duas portas TCP:

- HTTP, padrão `8080`: página de instalação do certificado e download.
- HTTPS, padrão `8443`: aplicação de transmissão de áudio.

A página HTTP mostra os endereços da rede, a impressão digital do certificado, o download do certificado e o botão para abrir a aplicação HTTPS. No Firewall do Windows, permita o aplicativo em redes privadas. Se necessário, libere as portas TCP configuradas para HTTP e HTTPS; WebRTC também usa UDP para o áudio.

As portas podem ser alteradas com as variáveis `PORT` e `HTTPS_PORT`. Elas precisam ser diferentes. O certificado e sua chave CA ficam salvos na pasta de configuração do usuário e são reutilizados; o certificado HTTPS é reemitido ao iniciar para cobrir os IPs locais atuais. Assim, a mudança do IP do hotspot não exige reconfigurar DNS nem instalar outro certificado.

**Segurança:** antes de instalar, compare a impressão digital SHA-256 mostrada na página HTTP com a exibida no terminal do notebook. Instale a CA somente nos dispositivos que você administra e confia. A chave privada da CA nunca deve ser copiada para os celulares nem compartilhada. Ao terminar de usar o sistema, remova a CA dos aparelhos se não quiser que continuem confiando nela.

## Instalação do certificado no Android

1. Abra no celular o endereço HTTP indicado pelo servidor.
2. Compare a impressão digital SHA-256 na página com a que aparece no terminal do notebook.
3. Baixe **CA para Android** (`audio-relay-local-ca.cer`, formato DER).
4. Em Configurações, procure por **Instalar certificado** ou **Certificado CA**. Em muitos aparelhos: **Segurança e privacidade → Mais configurações de segurança → Criptografia e credenciais → Instalar um certificado → Certificado CA**.
5. Selecione o arquivo `.cer` baixado e confirme o aviso do Android.
6. Volte à página HTTP e toque em **Abrir Audio Relay por HTTPS**.

Os nomes dos menus podem variar conforme fabricante e versão do Android. Para remover a confiança, procure por certificados de usuário nas configurações de segurança e remova **Audio Relay Local CA**.

## Instalação do certificado no iPhone/iPad

1. Abra no Safari o endereço HTTP indicado pelo servidor.
2. Compare a impressão digital SHA-256 na página com a que aparece no terminal do notebook.
3. Baixe **perfil para iPhone/iPad** (`audio-relay-local-ca.mobileconfig`).
4. Abra **Ajustes** e toque em **Perfil Baixado**; se não aparecer, acesse **Geral → VPN e Gerenciamento de Dispositivo**. Selecione **Audio Relay Local CA** e toque em **Instalar**, confirmando os avisos.
5. Ative a confiança: **Ajustes → Geral → Sobre → Ajustes de Confiança de Certificados**. Ative a confiança total para **Audio Relay Local CA**.
6. Volte à página HTTP e toque em **Abrir Audio Relay por HTTPS**.

No iOS/iPadOS, instalar o perfil não basta: é necessário ativar a confiança total. Para remover, acesse **Ajustes → Geral → VPN e Gerenciamento de Dispositivo** e remova o perfil.

## Instalação do certificado no Windows

1. Abra a página HTTP indicada pelo servidor e compare a impressão digital com a exibida no terminal.
2. Baixe **CA para Windows/Linux** (`audio-relay-local-ca.crt`, formato PEM).
3. Abra o arquivo e escolha **Instalar Certificado**.
4. Selecione **Usuário Atual** e **Colocar todos os certificados no repositório a seguir**.
5. Escolha **Autoridades de Certificação Raiz Confiáveis**, conclua e confirme o aviso.
6. Abra o endereço HTTPS indicado pelo servidor em Edge ou Chrome.

Para remover, abra `certmgr.msc`, localize **Audio Relay Local CA** em **Autoridades de Certificação Raiz Confiáveis → Certificados** e exclua-o.

## Instalação do certificado no Linux

Compare primeiro a impressão digital da página com a do terminal e baixe `audio-relay-local-ca.crt` (formato PEM).

Ubuntu/Debian:

```bash
sudo cp audio-relay-local-ca.crt /usr/local/share/ca-certificates/audio-relay-local-ca.crt
sudo update-ca-certificates
```

Fedora:

```bash
sudo cp audio-relay-local-ca.crt /etc/pki/ca-trust/source/anchors/audio-relay-local-ca.crt
sudo update-ca-trust
```

Reinicie o navegador e abra o endereço HTTPS. O Firefox pode exigir importar o certificado em **Configurações → Privacidade e Segurança → Certificados → Ver certificados → Autoridades**. Para remover nos sistemas Debian/Ubuntu, exclua o arquivo copiado e execute `sudo update-ca-certificates --fresh`; no Fedora, exclua o arquivo e execute `sudo update-ca-trust extract`.

## Desenvolvimento

```bash
cd web
npm ci
npm run build
cd ..
cp -R web/dist/. server/dist/
go run ./server
```

## Diagnóstico

- O terminal registra os endereços HTTP/HTTPS, a impressão digital da CA, WebSocket, sinalização WebRTC, candidatos ICE, mute e desconexões.
- Use o endereço da interface de rede conectada ao hotspot. No Windows, confira os endereços com `ipconfig`.
- Se a página abre, mas o áudio não conecta, verifique se o Firewall permite o executável e se o hotspot permite comunicação entre os dispositivos.
- A página também mostra o **Log do sistema**, estados dos PeerConnections e pistas de áudio recebidas.

## Controles de áudio e latência

- Transmissores e receptores exibem a latência RTT da conexão WebRTC em milissegundos.
- O transmissor tem uma opção remota de redução de ruído.
- O receptor controla o volume individual de cada transmissor (0% a 200%) e mostra o nível de áudio recebido.

Durante a transmissão, a página solicita ao navegador que mantenha a tela do transmissor ligada. Isso depende do suporte do navegador e não mantém a tela apagada.

## Gerar os binários

Linux:

```bash
make build-linux
```

Windows:

```bash
make build-windows
```

Ambos:

```bash
make build-all
```

Os binários ficam em `dist/`. O frontend compilado é incorporado ao executável.
