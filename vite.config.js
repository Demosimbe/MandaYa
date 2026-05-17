// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.', // Usa la raíz actual
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        cliente: resolve(__dirname, 'cliente.html'),
        delivery: resolve(__dirname, 'delivery.html')
      }
    },
    // No minimizar en desarrollo para mejor debug
    minify: 'esbuild'
  },
  server: {
    port: 3000,
    open: true,
    // Permitir CORS para desarrollo
    cors: true
  },
  // Definir variables de entorno
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY),
    'import.meta.env.VITE_OSRM_API_URL': JSON.stringify(process.env.VITE_OSRM_API_URL),
    'import.meta.env.VITE_WHATSAPP_NUMBER': JSON.stringify(process.env.VITE_WHATSAPP_NUMBER)
  }
});