@echo off
setlocal
set PYEXE=

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    set PYEXE=python
) else (
    where py >nul 2>nul
    if %ERRORLEVEL%==0 set PYEXE=py
)

if "%PYEXE%"=="" (
    echo Python is required to run this tool but was not found.
    echo Install it from https://www.python.org/downloads/ and try again.
    pause
    exit /b 1
)

%PYEXE% "%~dp0extract.py"
echo.
pause
endlocal
