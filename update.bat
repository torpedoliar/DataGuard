@echo off
echo.
echo ==============================================
echo   DC-Check System - Production Update Launcher
echo ==============================================
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0update.ps1"

echo.
pause
