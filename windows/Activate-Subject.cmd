@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Drag an extracted subject folder onto this file, or pass its path.
  pause
  exit /b 1
)
"%~dp0runtime\python.exe" "%~dp0activate-subject.py" --directory "%~dp0app" --pack "%~1"
if errorlevel 1 (
  pause
  exit /b 1
)
pause
