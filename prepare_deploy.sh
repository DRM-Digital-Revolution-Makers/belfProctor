#!/bin/bash
set -e

# Define paths
ROOT_DIR=$(pwd)
DEPLOY_DIR="$ROOT_DIR/deploy_package"
SERVER_DEPLOY="$DEPLOY_DIR/server_bundle/server"
CLIENT_DEPLOY="$DEPLOY_DIR/client_bundle"

echo "=== Cleaning previous deployment builds ==="
rm -rf "$DEPLOY_DIR"
mkdir -p "$SERVER_DEPLOY/backend"
mkdir -p "$SERVER_DEPLOY/frontend/dist"
mkdir -p "$CLIENT_DEPLOY"

echo "=== Building Frontend (React) ==="
cd server/frontend
echo "Installing frontend dependencies..."
if [ -f "package-lock.json" ]; then
    npm ci
else
    npm install
fi
echo "Building frontend..."
npm run build
# Copy frontend build to deployment folder
cp -r dist/* "$SERVER_DEPLOY/frontend/dist/"
cd "$ROOT_DIR"

echo "=== Preparing Backend (Node.js) ==="
# Copy backend source code
cp -r server/backend/* "$SERVER_DEPLOY/backend/"
# Remove local node_modules from copy (clean install later on server)
rm -rf "$SERVER_DEPLOY/backend/node_modules"
rm -rf "$SERVER_DEPLOY/backend/dist"
# Ensure win8 scripts are copied (should be in server/backend already)
cp server/backend/win8-start.bat "$SERVER_DEPLOY/backend/"
cp server/backend/win8-install-autostart.bat "$SERVER_DEPLOY/backend/"

echo "=== Building Client (Windows .NET) ==="
cd client
if command -v dotnet >/dev/null 2>&1; then
    echo "Building Client for Windows x64..."
    # Publish for Windows x64 self-contained (no .NET runtime needed on target)
    dotnet publish Properties/BelfProctor.csproj -c Release -r win-x64 --self-contained true -o "$CLIENT_DEPLOY"
    
    # Copy installation scripts
    echo "Copying installation scripts..."
    cp scripts/install-client.bat "$CLIENT_DEPLOY/"
    cp scripts/install-windows-service.ps1 "$CLIENT_DEPLOY/"
    
    echo "Client built successfully."
else
    echo "WARNING: 'dotnet' command not found."
    echo "Skipping Client build. You must build the 'client' project manually"
    echo "or install .NET SDK on this machine."
fi
cd "$ROOT_DIR"

echo "=== Deployment Package Ready ==="
echo "Location: $DEPLOY_DIR"
echo "Instructions:"
echo "1. Server: Copy 'deploy_package/server_bundle' to C:\belfProctor on Windows 8."
echo "   - Install Node.js 16.x or 14.x (compatible with Win8)."
echo "   - Run 'server/backend/win8-start.bat'."
echo "2. Client: Copy 'deploy_package/client_bundle' to Worker machines."
echo "   - Edit 'appsettings.json' to set 'ServerUrl' to http://<SERVER_IP>:8080/api."
echo "   - Run 'install-client.bat' as Administrator."
