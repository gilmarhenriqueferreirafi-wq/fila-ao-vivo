# Fila ao Vivo — YouTube

Servidor local para uma sala adicionar vídeos do YouTube à fila usando celulares ou outros dispositivos conectados à mesma rede Wi-Fi.

## Rodar

Para iniciar pelo Windows, execute `iniciar-fila.cmd`. Ele só pede administrador na primeira vez, para liberar a porta 8080 no Firewall.

```powershell
cd C:\Users\gilma\Projects\03-python-e-bots\youtube-fila
py -m pip install -r requirements.txt
py app.py
```

Para gerar também um QR que conecta o celular ao Wi‑Fi:

```powershell
py app.py --wifi-name "Minha Rede" --wifi-password "minha-senha"
```

Abra o endereço `Celulares` mostrado no terminal no celular. O painel principal fica em `http://localhost:8080/`.

Se o celular não conectar, permita o Python no Firewall do Windows e confirme que os dispositivos estão na mesma rede (não na rede de convidados). A fila é mantida em memória e volta vazia quando o servidor é encerrado.

## Modos de reprodução

- **Contínua** repete a fila ao chegar ao fim.
- **Alternada** escolhe aleatoriamente a próxima música.
- **Autoplay** avança quando o vídeo atual termina.
- **Música surpresa** pesquisa uma música no YouTube quando a fila chega ao fim.
