@echo off
echo ========================================
echo  CodeSense Chat Service Startup
echo ========================================
echo.

cd /d "%~dp0"

set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
    echo [ERROR] Virtual environment not found at %~dp0.venv
    pause
    exit /b 1
)

echo Starting chat service on http://localhost:8000
echo.
"%PYTHON_EXE%" backend\chat_service.py
