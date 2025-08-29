pause
@echo off
echo ========================================
echo    KHOI DONG HE THONG KEO BUA BAO
echo ========================================
@echo off
echo ========================================
echo    KHOI DONG HE THONG KEO BUA BAO
echo ========================================
echo.

echo Dang khoi dong Backend Server (Port 8082)...
start "Backend Server" cmd /c "cd backend && python server.py"
timeout /t 2 /nobreak > nul

echo Dang khoi dong Frontend Server (Port 8000)...
start "Frontend Server" cmd /c "cd frontend && python -m http.server 8000"
timeout /t 2 /nobreak > nul

echo.
echo Da khoi dong ca Backend va Frontend!
echo Truy cap:
echo - Game: http://localhost:8000
echo - Backend WebSocket: ws://localhost:8082
echo.
echo Press any key to exit...
pause > nul