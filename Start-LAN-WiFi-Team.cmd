@echo off
title God's Eye View - LAN Wi-Fi Sentinel & Dev Team
chcp 65001 >nul
cd /d "%~dp0"

echo Starte God's Eye View LAN Broadcast und autonomes Dev Team...
node scripts\lan-sentinel-devteam.mjs

pause
