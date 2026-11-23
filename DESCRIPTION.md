# Projeto de transmissão de áudio

## Tecnologia desejadas

- Go: Backend do servidor multiplataforma(windows/linux);
- React+Material UI: Frontend onde podemos conectar como transmissor ou receptor

## Funcionamento

O servidor (Go) inicia uma interface web que possui as funções de Transmissor(apenas envia o audio do microphone pro servidor) e Receptor (reproduz o audio de todos os transmissores ao mesmo tempo). Cada transmissor deve ter um nome, o audio deve ter a menor latência possível, no receptor, devemos poder deixar mudo determinado transmissor enquanto mantem outros ativos(aproveite para reduzir a banda de dados utilizado - pode-se enviar um sinal pro transmissor para que ele não envie mais audio e futuramente enviar um novo para liberar o envio novamente)
