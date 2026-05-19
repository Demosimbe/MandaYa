// service-worker.js
const CACHE_NAME = 'mandaya-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/cliente.html',
  '/delivery.html',
  '/js/app.js',
  '/js/cliente.js',
  '/js/delivery.js',
  '/js/config.js',
  '/js/security.js',
  '/js/shared.js',
  '/js/map-utils.js',
  '/img/logo.png',
  '/img/favicon512.png'
];

// Instalación del Service Worker
self.addEventListener('install', event => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cacheando archivos');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activación
self.addEventListener('activate', event => {
  console.log('[SW] Activado');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );
});

// Fetch - estrategia: network first, luego cache
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Notificaciones push (para futuro)
self.addEventListener('push', function(event) {
  const data = event.data ? event.data.json() : {};
  
  let titulo = 'MandaYa';
  let opciones = {
    body: data.mensaje || 'Actualización importante',
    icon: '/img/logo.png',
    badge: '/img/icon-72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    }
  };
  
  if (data.tipo === 'nuevo_pedido') {
    titulo = '🔔 ¡Nuevo pedido!';
    opciones.body = `📦 ${data.cliente} - $${data.tarifa}`;
    opciones.vibrate = [300, 100, 300, 100, 500];
  } else if (data.tipo === 'pedido_asignado') {
    titulo = '🚚 Delivery asignado';
    opciones.body = `🏍️ ${data.delivery} va a recoger tu paquete`;
  } else if (data.tipo === 'pedido_entregado') {
    titulo = '✅ Pedido entregado';
    opciones.body = '¡Gracias por usar MandaYa!';
  }
  
  event.waitUntil(
    self.registration.showNotification(titulo, opciones)
  );
});

// Clic en notificación
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});