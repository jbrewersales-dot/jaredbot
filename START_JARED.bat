@echo off
title Jared Desktop Assistant
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo.
  echo   1. Go to  https://nodejs.org
  echo   2. Download the big green "LTS" button and install it
  echo   3. Close this window, then double-click START_JARED.bat again
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   First run - installing Jared. This takes a few minutes.
  echo   Leave this window open.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Install failed. Check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   Starting Jared. Press Ctrl+Alt+J to open his control panel.
echo.
call npm start
if errorlevel 1 pause
