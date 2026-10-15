@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Skazka pro menya

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] Node.js не найден. Установите версию LTS с https://nodejs.org
  echo      и после установки перезагрузите компьютер.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Устанавливаю зависимости, это займёт минуту...
  call npm install
  if errorlevel 1 (
    echo.
    echo  [!] npm install завершился с ошибкой. Пришлите текст выше.
    pause
    exit /b 1
  )
)

if not exist .env copy .env.example .env >nul

echo.
echo  Запускаю приложение. НЕ закрывайте это окно, пока пользуетесь приложением.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
node server.js
echo.
echo  [!] Сервер остановился. Если выше есть сообщение об ошибке — пришлите его.
pause
