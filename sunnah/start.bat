@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 7 vesomyh sunn

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
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo  [!] npm install завершился с ошибкой. Пришлите текст выше.
    pause
    exit /b 1
  )
)

echo.
echo  Запускаю «7 весомых сунн». НЕ закрывайте это окно, пока пользуетесь приложением.
echo  Данные хранятся в папке data рядом с этим файлом.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8080"
node server.mjs
echo.
echo  [!] Сервер остановился. Если выше есть сообщение об ошибке — пришлите его.
pause
