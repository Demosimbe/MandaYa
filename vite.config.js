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
    emptyOutDir: true,
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
    open: true
  }
});

// Copiar archivos estáticos después del build
process.on('exit', () => {
  console.log('📦 Copiando js, img, manifest y service-worker a dist...');
  
  if (existsSync('js')) copyFolderSync('js', 'dist/js');
  if (existsSync('img')) copyFolderSync('img', 'dist/img');
  
  // Copiar archivos raíz importantes
  const rootFiles = ['manifest.json', 'service-worker.js'];
  rootFiles.forEach(file => {
    if (existsSync(file)) {
      copyFileSync(file, `dist/${file}`);
    }
  });
  
  console.log('✅ Build completado y archivos copiados!');
});