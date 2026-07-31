@echo off
rem Klyp dev server launcher — used by the "Klyp Dev Server" scheduled task.
rem Skips starting if something is already listening on :3000.
netstat -ano | findstr ":3000 " | findstr LISTENING >nul && exit /b 0
cd /d C:\Users\Michael\klyp-app
title Klyp dev server

if not exist logs mkdir logs
rem Keep one previous cycle's log around, then start fresh for this run.
if exist logs\dev-server.log move /y logs\dev-server.log logs\dev-server.log.old >nul

rem Restart-on-crash loop: if `next dev` ever exits (crash, OOM, closed window),
rem this brings it back instead of leaving the app dead until the next logon.
:loop
echo [%date% %time%] starting npm run dev >> logs\dev-server.log
call npm run dev >> logs\dev-server.log 2>&1
echo [%date% %time%] npm run dev exited with code %errorlevel% — restarting in 3s >> logs\dev-server.log
timeout /t 3 /nobreak >nul
goto loop
