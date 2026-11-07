@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Esta etapa elevada so cria a regra do Firewall; o servidor continua sem administrador.
if /i "%~1"=="--firewall" goto firewall

netsh advfirewall firewall show rule name="Fila YouTube 8080" >nul 2>&1
if errorlevel 1 (
    echo A porta 8080 ainda nao foi liberada no Firewall do Windows.
    echo Sera solicitada permissao de administrador apenas para criar essa regra.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--firewall' -Verb RunAs -Wait"
    if errorlevel 1 echo Nao foi possivel criar a regra; o servidor sera iniciado mesmo assim.
)

echo.
echo O Windows tentara localizar a senha ja salva no perfil da rede.

:start
echo.
echo Iniciando Fila ao Vivo. Feche esta janela ou pressione Ctrl+C para parar.
start "Fila ao Vivo" http://localhost:8080/
python app.py
pause
exit /b

:firewall
netsh advfirewall firewall add rule name="Fila YouTube 8080" dir=in action=allow protocol=TCP localport=8080 profile=private >nul
exit /b %errorlevel%
