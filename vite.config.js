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
    },
    minify: 'esbuild',
    closeBundle() {
      console.log('📦 Copiando archivos estáticos a dist/...');
      
      if (existsSync('js')) {
        copyFolderSync('js', 'dist/js');
        console.log('✅ js/ copiada a dist/js/');
      }
      
      if (existsSync('img')) {
        copyFolderSync('img', 'dist/img');
        console.log('✅ img/ copiada a dist/img/');
      }
      
      console.log('✅ Build completado!');
    }
  },
  server: {
    port: 3000,
    open: true,
    cors: true
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY),
    'import.meta.env.VITE_OSRM_API_URL': JSON.stringify(process.env.VITE_OSRM_API_URL),
    'import.meta.env.VITE_WHATSAPP_NUMBER': JSON.stringify(process.env.VITE_WHATSAPP_NUMBER)
  }
});