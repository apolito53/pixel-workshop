@echo off
setlocal
cd /d "%~dp0"
set "PIXEL_DATA_DIR=%LOCALAPPDATA%\PixelWorkshop\data"
set "PORT=4317"
if not exist "%PIXEL_DATA_DIR%" mkdir "%PIXEL_DATA_DIR%"
echo Pixel Workshop local edition
echo Address: http://127.0.0.1:%PORT%
echo Files: %PIXEL_DATA_DIR%
echo Keep this window open while editing. Ctrl+C stops it.
echo.
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$u='http://127.0.0.1:4317'; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2; if($r.StatusCode -eq 200){Start-Process $u; break} } catch {} ; Start-Sleep -Milliseconds 500 }"
".\node.exe" --experimental-strip-types ".\server\node.ts"
if errorlevel 1 (
  echo.
  echo Pixel Workshop stopped with an error. Check whether port 4317 is already in use.
  pause
)
