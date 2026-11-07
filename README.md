# Fila ao Vivo — YouTube

Servidor local para controlar uma fila de músicas do YouTube em tempo real. Pessoas conectadas à mesma rede Wi-Fi podem adicionar músicas pelo celular, enquanto o computador controla a reprodução.

## O que instalar

No Windows, execute `iniciar-fila.cmd`. O assistente verifica se o Python existe e oferece instalar pelo `winget` caso esteja ausente. Antes de instalar qualquer coisa, ele verifica se o `pip` e cada dependência estão ausentes ou desatualizados; só oferece a atualização quando necessário.

Todas essas etapas são perguntadas com `(y,n)`. Responder `y` é obrigatório para a função correspondente funcionar:

- Python: obrigatório para executar o servidor.
- pip: obrigatório para instalar as dependências.
- Dependências: obrigatório para pesquisa no YouTube e geração dos QR codes.
- Firewall: obrigatório para acessar pelo celular na rede Wi-Fi; pode ser recusado se for usar somente o PC.

## Executar manualmente

```powershell
cd C:\Users\gilma\Projects\03-python-e-bots\youtube-fila
py -m pip install --upgrade pip
py -m pip install --upgrade -r requirements.txt
py app.py
```

Para gerar também um QR code que conecta o celular ao Wi-Fi:

```powershell
py app.py --wifi-name "Minha Rede" --wifi-password "minha-senha"
```

## Endereços

- `http://localhost:8080/`: painel principal para reproduzir e administrar a fila.
- `http://localhost:8080/remote`: controle remoto para celulares adicionarem músicas.
- `http://localhost:8080/painel`: painel compacto com capa, progresso e modo tela cheia.

O endereço acessível pelos celulares é mostrado no terminal como `Celulares`. Os dispositivos precisam estar na mesma rede Wi-Fi, e não em uma rede de convidados.

## Recursos

- Pesquisa e adição de músicas pelo celular e pelo PC.
- Fila compartilhada em tempo real.
- Seleção, remoção e reordenação por setas; arrastar disponível no PC.
- Reprodução contínua, aleatória, autoplay e busca automática de artistas brasileiros por gênero.
- Qualidade de vídeo e modo somente áudio no PC.
- Histórico JSON das configurações em `config_history.json`.
- API de estado, reprodução atual e progresso.

## Dependências

As dependências estão em `requirements.txt`:

- `yt-dlp` para pesquisar vídeos no YouTube.
- `qrcode` e `pillow` para gerar os QR codes.

## Licença

Este projeto está disponível sob a licença [MIT](LICENSE).
