#!/bin/bash
set -e

echo "Building relay server..."

# Install dependencies
npm install

# Build TypeScript
npm run build

# Build web client and copy to public
echo "Building web client..."
cd ../web-client
npm install
npm run build

# Copy to relay server public folder
echo "Copying web client to relay server..."
cd ../relay-server
rm -rf public
mkdir -p public
cp -r ../web-client/dist/* public/

echo "Build complete!"
echo ""
echo "To run locally: npm start"
echo "To build Docker: docker build -t scrum-poker-relay ."
echo "To run Docker: docker run -p 3000:3000 -e RELAY_URL=https://your-domain.com scrum-poker-relay"
