@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is missing from PATH.
  pause
  exit /b 1
)
if not exist "node_modules\socket.io\package.json" (
  echo Installing project dependencies...
  call npm ci
  if errorlevel 1 (
    echo [ERROR] Could not install dependencies.
    pause
    exit /b 1
  )
)
echo Starting HomeAuction server and Cloudflare Tunnel...
start "HomeAuction - Node Server" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
start "HomeAuction - Cloudflare Tunnel" cmd /k "npx cloudflared tunnel --url http://localhost:3000"
echo.
echo Local address: http://localhost:3000
echo The public address will appear in the Cloudflare Tunnel window.
echo Close both opened terminal windows to stop the processes.
pause
