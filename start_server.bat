@echo off
echo ========================================
echo    KHOI DONG SERVER KEO BUA BAO
echo ========================================
echo.

echo Dang cai dat dependencies...
pip install -r requirements.txt

echo.
echo Dang khoi dong server...
cd backend
python sever.py

pause 