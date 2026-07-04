@echo off
rem Klyp dev server launcher — used by the "Klyp Dev Server" scheduled task.
rem Skips starting if something is already listening on :3000.
netstat -ano | findstr ":3000 " | findstr LISTENING >nul && exit /b 0
cd /d C:\Users\Michael\klyp-app
title Klyp dev server
npm run dev
