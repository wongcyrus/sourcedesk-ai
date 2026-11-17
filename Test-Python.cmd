@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with npm, then run this file again.
  pause
  exit /b 1
)
py -3.14 --version >nul 2>nul
if errorlevel 1 (
  echo Python 3.14 and the Windows py launcher are required.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\http-server.cmd" (
  echo Installing project dependencies...
  call npm ci
  if errorlevel 1 goto failed
)
if not exist "offline\release.json" (
  echo Preparing the browser application...
  call npm run prepare:offline
  if errorlevel 1 goto failed
)
if not exist "offline\OfflineVectorSearch-min.js" (
  echo Preparing the browser application...
  call npm run prepare:offline
  if errorlevel 1 goto failed
)
if not exist "offline\models\cbb97a3e73fd566bd089ca762461458c78ed4761\litert-community\gemma-4-E2B-it-litert-lm\gemma-4-E2B-it-web.litertlm" (
  echo Downloading shared models and browser runtimes. This can take a while...
  call npm run prepare:models
  if errorlevel 1 goto failed
)
if not exist "offline\models\5090578d9565bb06545b4552f76e6bc2c93e4a66\onnx-community\embeddinggemma-300m-ONNX\onnx\model_q4.onnx" (
  echo Downloading the shared embedding model...
  call npm run prepare:models
  if errorlevel 1 goto failed
)
if not exist "examples\python\content\tutorial\.complete" (
  echo Downloading the official Python tutorial...
  py -3.14 examples\python\prepare_source.py
  if errorlevel 1 goto failed
)
if not exist "data\python\subject.json" (
  echo Building the Python subject pack...
  call npm run build:subject -- --subject examples/python/subject.json
  if errorlevel 1 goto failed
)

echo Activating the Python subject...
py -3.14 windows\activate-subject.py --directory offline --pack data\python
if errorlevel 1 goto failed
echo Starting SourceDesk AI. Close this window to stop the local server.
call npm start
exit /b %errorlevel%

:failed
echo Setup failed. Check the message above, then run Test-Python.cmd again.
pause
exit /b 1
