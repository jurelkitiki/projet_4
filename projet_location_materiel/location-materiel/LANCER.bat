@echo off
title LocaTech - Location de materiel
cd /d "%~dp0"

echo ==================================================
echo    LocaTech - Demarrage du projet
echo ==================================================
echo.

REM --- 1. Verifier Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe.
  echo Installez-le depuis https://nodejs.org puis relancez ce fichier.
  pause
  exit /b
)

REM --- 2. Installer les dependances (premiere fois seulement) ---
if not exist "node_modules" (
  echo Installation des dependances, patientez...
  call npm install
  if errorlevel 1 ( echo [ERREUR] npm install a echoue. & pause & exit /b )
)

REM --- 3. Creer le fichier .env (premiere fois seulement) ---
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Fichier .env cree. Utilisateur MySQL : root, mot de passe vide ^(XAMPP^).
)

REM --- 4. Demarrer MySQL de XAMPP s'il n'est pas deja lance ---
netstat -an | find ":3306" | find "LISTENING" >nul
if errorlevel 1 (
  if exist "C:\xampp\mysql\bin\mysqld.exe" (
    echo Demarrage de MySQL ^(XAMPP^)...
    start "MySQL" /min "C:\xampp\mysql\bin\mysqld.exe" --defaults-file="C:\xampp\mysql\bin\my.ini" --standalone
    timeout /t 6 /nobreak >nul
  ) else (
    echo [ATTENTION] MySQL ne semble pas demarre.
    echo Ouvrez XAMPP et cliquez sur Start a cote de MySQL, puis appuyez sur une touche.
    pause
  )
)

REM --- 5. Creer la base de donnees (premiere fois seulement) ---
if not exist ".base-creee" (
  echo Creation de la base de donnees...
  call npm run init-db
  if errorlevel 1 (
    echo.
    echo [ERREUR] Impossible de creer la base.
    echo Verifiez que MySQL est demarre et que DB_USER / DB_PASSWORD sont corrects dans .env
    pause
    exit /b
  )
  echo ok> ".base-creee"
)

REM --- 6. Lancer le serveur et ouvrir le navigateur ---
echo.
echo Le site s'ouvre dans votre navigateur : http://localhost:3000
echo Comptes de test : client@location.test / responsable@location.test / admin@location.test
echo Mot de passe : Motdepasse123!
echo.
echo NE FERMEZ PAS cette fenetre tant que vous utilisez le site.
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call npm start
pause
