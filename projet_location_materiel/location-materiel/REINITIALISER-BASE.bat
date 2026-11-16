@echo off
cd /d "%~dp0"
echo Cette action SUPPRIME toutes les donnees et recree la base de test.
set /p ok=Continuer ? (o/n) : 
if /i not "%ok%"=="o" exit /b
call npm run init-db
echo ok> ".base-creee"
pause
