@echo off
rem FinanceAiPro (JS) - local launcher. ASCII only: Cyrillic breaks cmd parsing.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js not found. Install Node.js 22+ from https://nodejs.org
    pause
    exit /b 1
)

if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo [i] Created .env - put APP_PASSWORD, SESSION_SECRET and the LLM key there, save it and run run.bat again.
    echo     Without APP_PASSWORD the site opens without an access code; without an LLM key texts use the template.
    start "" notepad ".env"
)

echo [i] FinanceAiPro: http://127.0.0.1:8000  - press Ctrl+C to stop
start "" http://127.0.0.1:8000
node dev-server.mjs
pause
