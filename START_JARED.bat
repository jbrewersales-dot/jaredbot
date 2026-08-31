@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing Jared Desktop Assistant...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
call npm start
