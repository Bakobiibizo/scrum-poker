const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, 'src-tauri/icons/spade.svg');
const iconsDir = path.join(__dirname, 'src-tauri/icons');

// Simple ICO file creator (single 256x256 image)
function createIco(pngBuffer) {
  const size = 256;
  const imageSize = pngBuffer.length;
  
  // ICO header (6 bytes)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // Reserved
  header.writeUInt16LE(1, 2);      // Type: 1 = ICO
  header.writeUInt16LE(1, 4);      // Number of images
  
  // ICO directory entry (16 bytes)
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);          // Width (0 = 256)
  entry.writeUInt8(0, 1);          // Height (0 = 256)
  entry.writeUInt8(0, 2);          // Color palette
  entry.writeUInt8(0, 3);          // Reserved
  entry.writeUInt16LE(1, 4);       // Color planes
  entry.writeUInt16LE(32, 6);      // Bits per pixel
  entry.writeUInt32LE(imageSize, 8);  // Image size
  entry.writeUInt32LE(22, 12);     // Offset to image data (6 + 16 = 22)
  
  return Buffer.concat([header, entry, pngBuffer]);
}

async function generateIcons() {
  const svg = fs.readFileSync(svgPath);
  
  // Generate PNG at 256x256
  const pngBuffer = await sharp(svg)
    .resize(256, 256)
    .png()
    .toBuffer();
  
  // Save PNG
  const pngPath = path.join(iconsDir, 'icon.png');
  fs.writeFileSync(pngPath, pngBuffer);
  console.log('Created icon.png');
  
  // Generate ICO from PNG
  const icoBuffer = createIco(pngBuffer);
  fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuffer);
  console.log('Created icon.ico');
  
  // Generate different sizes for various platforms
  const sizes = [32, 128, 256];
  for (const size of sizes) {
    const resized = await sharp(svg)
      .resize(size, size)
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(iconsDir, `${size}x${size}.png`), resized);
    console.log(`Created ${size}x${size}.png`);
  }
  
  console.log('Done! Icons generated in src-tauri/icons/');
}

generateIcons().catch(console.error);
