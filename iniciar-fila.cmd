@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

rem Fila ao Vivo - instalador e inicializador para Windows.
if /i "%~1"=="--firewall" goto firewall

set "PY_CMD="
where py >nul 2>&1
if not errorlevel 1 set "PY_CMD=py"
if not defined PY_CMD (
    where python >nul 2>&1
    if not errorlevel 1 set "PY_CMD=python"
)

if not defined PY_CMD goto ask_python
goto check_pip

:ask_python
echo.
echo Python nao foi encontrado.
echo Python e obrigatorio para executar a Fila ao Vivo.
set "ANSWER="
set /p "ANSWER=Instalar Python automaticamente pelo winget? (y,n): "
if /i "!ANSWER!"=="y" goto install_python
if /i "!ANSWER!"=="n" goto stop_missing
echo Responda somente y ou n.
goto ask_python

:install_python
where winget >nul 2>&1
if errorlevel 1 (
    echo winget nao foi encontrado. Instale Python manualmente em https://www.python.org/downloads/windows/
    goto stop_missing
)
winget install --id Python.Python.3.13 -e --scope user --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto install_failed
set "PY_CMD=py"
where py >nul 2>&1
if errorlevel 1 set "PY_CMD=python"
goto check_pip

:check_pip
echo.
echo O pip sera atualizado. Esta etapa e obrigatoria para instalar as dependencias.
set "ANSWER="
set /p "ANSWER=Atualizar o pip agora? (y,n): "
if /i "!ANSWER!"=="y" goto update_pip
if /i "!ANSWER!"=="n" goto stop_missing
echo Responda somente y ou n.
goto check_pip

:update_pip
%PY_CMD% -m pip install --upgrade pip
if errorlevel 1 goto install_failed

echo.
echo As dependencias do projeto serao instaladas ou atualizadas.
echo Esta etapa e obrigatoria para pesquisa no YouTube e QR codes.
set "ANSWER="
set /p "ANSWER=Instalar/atualizar as dependencias? (y,n): "
if /i "!ANSWER!"=="y" goto install_dependencies
if /i "!ANSWER!"=="n" goto stop_missing
echo Responda somente y ou n.
goto update_pip

:install_dependencies
%PY_CMD% -m pip install --upgrade -r requirements.txt
if errorlevel 1 goto install_failed

echo.
echo A porta 8080 permite que celulares acessem a fila.
netsh advfirewall firewall show rule name="Fila YouTube 8080" >nul 2>&1
if errorlevel 1 goto ask_firewall
goto start_server

:ask_firewall
echo Liberar a porta no Firewall e obrigatorio para usar o celular na rede Wi-Fi.
set "ANSWER="
set /p "ANSWER=Criar a regra do Firewall agora? (y,n): "
if /i "!ANSWER!"=="y" goto request_firewall
if /i "!ANSWER!"=="n" goto start_server
echo Responda somente y ou n.
goto ask_firewall

:request_firewall
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '--firewall' -Verb RunAs -Wait"
goto start_server

:start_server
echo.
echo Iniciando Fila ao Vivo. Feche esta janela ou pressione Ctrl+C para parar.
start "Fila ao Vivo" http://localhost:8080/
%PY_CMD% app.py
pause
exit /b

:stop_missing
echo.
echo A Fila ao Vivo nao pode iniciar sem esta etapa obrigatoria.
pause
exit /b 1

:install_failed
echo.
echo A instalacao falhou. Corrija o erro exibido e execute este arquivo novamente.
pause
exit /b 1

:firewall
netsh advfirewall firewall add rule name="Fila YouTube 8080" dir=in action=allow protocol=TCP localport=8080 profile=private >nul
exit /b %errorlevel%
