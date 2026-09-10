@echo off
rem =====================================================================
rem  God's Eye View - Doppelklick-Start fuer Windows (kein Wissen noetig)
rem  Was es tut:
rem    1. Prueft Node.js (fragt, ob es per winget installiert werden soll)
rem    2. Installiert die App-Abhaengigkeiten (nur beim ersten Mal / Update)
rem    3. Prueft die Installation (Setup-Doctor)
rem    4. Startet den Server und oeffnet den Browser
rem  Keys? Keine noetig zum Starten. Spaeter in der App unten rechts auf
rem  POWER UP klicken und Keys einfuegen (Anleitung steht in der App).
rem =====================================================================
setlocal EnableExtensions
title God's Eye View - Starter
cd /d "%~dp0"

rem Volle Leistung fuer Gaeste: grosser JS-Heap + mehr IO-Threads.
rem Gilt fuer alles, was diese Datei startet (inkl. Autostart-Task).
if not defined NODE_OPTIONS set NODE_OPTIONS=--max-old-space-size=6144
if not defined UV_THREADPOOL_SIZE set UV_THREADPOOL_SIZE=16

rem Nur fuer Anzeige/URLs — NICHT setzen, damit .env und Vite-Defaults gelten.
if defined HOST (set URLHOST=%HOST%) else (set URLHOST=localhost)
if defined PORT (set URLPORT=%PORT%) else (set URLPORT=4173)

echo(
echo  ===============================================
echo   GOD'S EYE VIEW - Starter
echo  ===============================================
echo(

where node >nul 2>nul
if errorlevel 1 goto :no_node
for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODEVER=%%v
echo  [1/4] Node.js gefunden: %NODEVER%
goto :deps

:no_node
echo  [1/4] Node.js NICHT gefunden.
echo(
echo  Ohne Node.js laeuft die App nicht. Mit winget geht es automatisch.
set /p INSTALL_NODE="  Node.js jetzt per winget installieren? (J/N): "
if /i "%INSTALL_NODE%"=="J" goto :do_install_node
if /i "%INSTALL_NODE%"=="Y" goto :do_install_node
echo(
echo  Abbruch. Node.js gibt es hier: https://nodejs.org (LTS nehmen^),
echo  danach diese Datei einfach nochmal doppelklicken.
echo(
pause
exit /b 1

:do_install_node
where winget >nul 2>nul
if errorlevel 1 (
  echo(
  echo  winget nicht gefunden. Bitte Node.js LTS von https://nodejs.org
  echo  installieren und danach nochmal doppelklicken.
  echo(
  pause
  exit /b 1
)
echo  Installiere Node.js LTS (kann 1-2 Minuten dauern)...
winget install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo(
  echo  Installation fehlgeschlagen. Bitte Node.js LTS von
  echo  https://nodejs.org installieren und nochmal versuchen.
  echo(
  pause
  exit /b 1
)
echo(
echo  Fertig! Bitte dieses Fenster SCHLIESSEN und die Datei einmal
echo  NEU doppelklicken, damit Node.js gefunden wird.
echo(
pause
exit /b 0

:deps
if not exist package.json (
  echo(
  echo  FEHLER: package.json nicht gefunden. Diese Datei muss im
  echo  gods-eye-view Ordner liegen (da wo auch package.json ist^).
  echo(
  pause
  exit /b 1
)
if not exist node_modules (
  echo  [2/4] Installiere App-Dateien (erster Start, dauert 1-3 Minuten^)...
  call npm ci
  if errorlevel 1 (
    echo(
    echo  Installation fehlgeschlagen. Internet pruefen und nochmal versuchen.
    echo(
    pause
    exit /b 1
  )
) else (
  echo  [2/4] App-Dateien schon da, weiter gehts.
)

echo  [3/4] Pruefe Installation...
call npm run doctor
if errorlevel 1 (
  echo(
  echo  Der Check meldet ein Problem (steht oben^). Oft hilft:
  echo  node_modules Ordner loeschen und nochmal doppelklicken.
  echo(
  pause
  exit /b 1
)

if not exist "node_modules\.vite\deps\_metadata.json" (
  echo  Baue Browser-Dateien einmalig auf (kann 1-2 Minuten dauern^)...
  call npx vite optimize
)

echo(
echo  [4/4] Starte God's Eye View...
echo  Es oeffnet sich gleich ein zweites Fenster (der Server).
echo  BEIDE Fenster bitte offen lassen (minimieren ist ok).
echo  Stoppen: Server-Fenster schliessen.
echo(
start "God's Eye View Server" /min /high cmd /c "npm run dev & echo( & echo  Server beendet. & pause"
echo  Warte, bis der Server bereit ist (max. 3 Minuten)...
where curl.exe >nul 2>nul
if errorlevel 1 goto :openbrowser
set WAITED=0
:waitloop
curl.exe -s -o nul --max-time 3 "http://%URLHOST%:%URLPORT%/" >nul 2>nul
if not errorlevel 1 goto :ready
set /a WAITED+=1
if %WAITED% GEQ 60 goto :ready_timeout
timeout /t 3 /nobreak >nul
goto :waitloop
:ready_timeout
echo(
echo  Der Server braucht ungewoehnlich lange. Ich oeffne den Browser
echo  trotzdem - falls eine Fehlerseite kommt, 30 Sekunden warten und
echo  dann neu laden (F5). Oder ins Server-Fenster schauen, ob da ein
echo  Fehler steht.
goto :openbrowser
:ready
echo  Server ist bereit!
:openbrowser
echo(
start "" "http://%URLHOST%:%URLPORT%/"
echo  Browser geoeffnet: http://%URLHOST%:%URLPORT%/
echo(
echo  Viel Spass! Unten rechts in der App auf POWER UP klicken,
echo  um Keys einzutragen (Anleitung steht in der App).
echo  Dieses Fenster kann zu bleiben - stoppen geht uebers Server-Fenster.
echo(
pause
endlocal



