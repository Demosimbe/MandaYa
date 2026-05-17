import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

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

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        cliente: resolve(__dirname, 'cliente.html'),
        delivery: resolve(__dirname, 'delivery.html')
      }
    }
  },
  server: {
    port: 3000,
    open: true,
    cors: true
  }
});

// Copiar assets después del build
import { writeFileSync } from 'fs';
process.on('exit', () => {
  console.log('📦 Copiando archivos estáticos a dist/...');
  if (existsSync('js')) copyFolderSync('js', 'dist/js');
  if (existsSync('img')) copyFolderSync('img', 'dist/img');
  console.log('✅ Build completado!');
});