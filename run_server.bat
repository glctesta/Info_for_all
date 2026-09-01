@echo off
REM =====================================================================
REM  run_server.bat  -  Avvia il server Info_for_all (porta 5100)
REM  con auto-restart e log di console. Usa il venv locale .venv.
REM =====================================================================
cd /d "%~dp0"

:loop
echo [%date% %time%] Avvio server... >> console_output.log
.venv\Scripts\python.exe info_for_all.py >> console_output.log 2>&1
echo [%date% %time%] Server arrestato con codice %errorlevel%. Riavvio in corso... >> console_output.log
ping 127.0.0.1 -n 6 >nul
goto loop
