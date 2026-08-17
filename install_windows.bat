@echo off
setlocal enabledelayedexpansion

echo =========================================================
echo               DXFify Windows Installer Setup
echo =========================================================
echo.

:: 1. Check Python
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please download and install Python 3.10+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

:: 2. Check Node.js (for web build)
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Node.js is not installed. Using pre-built web assets.
    echo For fresh web builds, install Node.js 18+ from https://nodejs.org/
    echo.
) else (
    echo [1/4] Building Web Frontend...
    cd web
    call npm install
    call npm run build
    cd ..
)

:: 3. Setup Python Virtual Environment
echo.
echo [2/4] Setting up Python virtual environment...
cd dxferpy
if not exist "venv" (
    python -m venv venv
)
call .\venv\Scripts\activate.bat

echo.
echo [3/4] Installing Python dependencies...
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install pywebview bottle pyinstaller PyQt6 PyQt6-WebEngine

cd ..

:: 4. Build Standalone Desktop Binary Executable
echo.
echo [4/4] Compiling DXFify Desktop Application executable...
call dxferpy\venv\Scripts\pyinstaller --noconfirm desktop\dxfify.spec

:: Sync to dxferpy\dist\dxfify for subdirectory launcher parity
if not exist "dxferpy\dist" mkdir dxferpy\dist
xcopy /E /I /Y dist\dxfify dxferpy\dist\dxfify

:: Create quick launcher script run_windows.bat
(
    echo @echo off
    echo start "" "%%~dp0dist\dxfify\dxfify.exe"
) > run_windows.bat

:: Create Desktop Shortcut using PowerShell
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), 'DXFify.lnk')); $s.TargetPath = '%CD%\dist\dxfify\dxfify.exe'; $s.WorkingDirectory = '%CD%\dist\dxfify'; $s.Save()"

echo.
echo =========================================================
echo            DXFify Windows Installation Complete!
echo =========================================================
echo.
echo - Standalone executable built: dist\dxfify\dxfify.exe
echo - Desktop Shortcut created: DXFify on your Desktop
echo - Quick Launcher created: run_windows.bat in this folder
echo.
pause
