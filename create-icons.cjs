const fs = require('fs');
const path = require('path');

// Minimal valid ICO file (16x16 green poker chip icon)
const icoBase64 = 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAABILAAASCwAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AJsZVfybGVf8mxlX/JsZV/ybGVf8mxlV/////AP///wD///8A////AP///wD///8A////AP///wD///8AJsZVfybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlV/////AP///wD///8A////AP///wD///8AJsZVfybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVX////8A////AP///wD///8AJsZVfybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlV/////AP///wD///8AJsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/////AP///wD///8AJsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/////AP///wD///8AJsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/////AP///wD///8AJsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/////AP///wD///8AJsZVfybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlV/////AP///wD///8A////AJbGVX8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZV/ybGVX////8A////AP///wD///8A////AP///wCWxlV/JsZV/ybGVf8mxlX/JsZV/ybGVf8mxlX/JsZVf////wD///8A////AP///wD///8A////AP///wD///8AlsZVfybGVf8mxlX/JsZV/ybGVf8mxlV/////AP///wD///8A////AP///wD///8A////AP///wD///8A////AJbGVX8mxlX/JsZV/ybGVX////8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8AlsZVf5bGVX////8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A////AP///wD///8A//8AAP4/AAD8HwAA+A8AAPAHAADgAwAA4AMAAOADAADgAwAA8AcAAPgPAAD8HwAA/j8AAP5/AAD//wAA//8AAA==';

// Minimal valid PNG (32x32 green square)
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABPSURBVFiF7c4xDQAwDAOw+je9swjJQCqH3xwkJfk2M7O7uwMAAADgv1TV7u4OAAAAgNOqand3BwAAAACc9gegqnZ3BwAAAACc9t0fAACg0wMTYQMhKjLDSgAAAABJRU5ErkJggg==';

const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

// Ensure directory exists
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

// Write ICO
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), Buffer.from(icoBase64, 'base64'));
console.log('Created icon.ico');

// Write PNG
fs.writeFileSync(path.join(iconsDir, '32x32.png'), Buffer.from(pngBase64, 'base64'));
console.log('Created 32x32.png');

// Delete old icon.png if it exists
const oldPng = path.join(iconsDir, 'icon.png');
if (fs.existsSync(oldPng)) {
    fs.unlinkSync(oldPng);
    console.log('Deleted old icon.png');
}

console.log('Done!');
