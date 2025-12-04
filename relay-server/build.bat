@echo off
echo Building relay server...

REM Install dependencies
call npm install

REM Build TypeScript
call npm run build

REM Build web client
echo Building web client...
cd ..\web-client
call npm install
call npm run build

REM Copy to relay server public folder
echo Copying web client to relay server...
cd ..\relay-server
if exist public rmdir /s /q public
mkdir public
xcopy /s /e /y ..\web-client\dist\* public\

echo Build complete!
echo.
echo To run locally: npm start
echo To build Docker: docker build -t scrum-poker-relay .
echo To run Docker: docker run -p 8060:8060 -e RELAY_URL=https://your-domain.com scrum-poker-relay
