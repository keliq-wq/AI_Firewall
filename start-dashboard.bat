@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [firewall] Node.js not found. Please install Node.js 20+ first: https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo [firewall] First run: installing dependencies, about 1-2 min...
  call npm install
  if errorlevel 1 (
    echo [firewall] npm install failed. Check your network / npm registry.
    pause
    exit /b 1
  )
)

call npm run dashboard
pause
