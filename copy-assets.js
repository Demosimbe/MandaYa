// copy-assets.js
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function copyFolderSync(src, dest) {
  if (!existsSync(src)) return;
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) {
      copyFolderSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

console.log('📦 Copiando archivos estáticos a dist/...');

if (existsSync('js')) {
  copyFolderSync('js', 'dist/js');
  console.log('✅ js/ copiada a dist/js/');
}

if (existsSync('img')) {
  copyFolderSync('img', 'dist/img');
  console.log('✅ img/ copiada a dist/img/');
}

console.log('✅ Assets copiados!');