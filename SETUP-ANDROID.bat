@echo off
setlocal
cd /d "%~dp0"

echo.
echo ARK Client Center Android setup
echo --------------------------------

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not available in PATH.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm is not installed or is not available in PATH.
  pause
  exit /b 1
)

call npm run mobile:android:open
if errorlevel 1 (
  echo.
  echo Android setup failed. Read the error above before closing this window.
  pause
  exit /b 1
)

echo.
echo Android Studio should now be opening the correct android folder.
pause
