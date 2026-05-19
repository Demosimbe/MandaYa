// ==================== SERVICE WORKER MANDAYA ====================

const CACHE_NAME = 'mandaya-v2';

const urlsToCache = [
  '/',
  '/index.html',
  '/cliente.html',
  '/delivery.html',

  // JS
  '/js/app.js',
  '/js/cliente.js',
  '/js/delivery.js',
  '/js/config.js',
  '/js/security.js',
  '/js/shared.js',
  '/js/map-utils.js',

  // Imágenes
  '/img/logo.png',
  '/img/favicon512.png',
  '/img/icon-72.png'
];

// ==================== INSTALACIÓN ====================
self.addEventListener('install', event => {
  console.log('[SW] Instalando...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cacheando archivos principales');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('[SW] Instalación completada');
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Error instalando:', err);
      })
  );
});

// ==================== ACTIVACIÓN ====================
self.addEventListener('activate', event => {
  console.log('[SW] Activado');

  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys.map(key => {
            if (key !== CACHE_NAME) {
              console.log('[SW] Eliminando cache viejo:', key);
              return caches.delete(key);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Controlando clientes');
        return self.clients.claim();
      })
  );
});

// ==================== FETCH ====================
self.addEventListener('fetch', event => {
  const request = event.request;

  // ==================== IGNORAR MÉTODOS NO GET ====================
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }

  // ==================== IGNORAR CHROME EXTENSIONS ====================
  if (request.url.startsWith('chrome-extension://')) {
    return;
  }

  // ==================== IGNORAR SUPABASE REALTIME / API ====================
  if (
    request.url.includes('/realtime/') ||
    request.url.includes('/socket/') ||
    request.url.includes('supabase.co/rest/') ||
    request.url.includes('supabase.co/auth/') ||
    request.url.includes('supabase.co/storage/')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // ==================== IGNORAR MAPAS ====================
  if (
    request.url.includes('maptiler') ||
    request.url.includes('openstreetmap') ||
    request.url.includes('tile.openstreetmap')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // ==================== NETWORK FIRST ====================
  event.respondWith(
    fetch(request)
      .then(response => {
        // Validar respuesta
        if (!response || response.status !== 200) {
          return response;
        }

        // Clonar respuesta
        const responseClone = response.clone();

        // Guardar en cache
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(request, responseClone)
              .catch(err => {
                console.warn('[SW] Error cacheando:', err);
              });
          });

        return response;
      })
      .catch(async () => {
        console.warn('[SW] Sin internet, buscando cache...');

        // Buscar en cache
        const cachedResponse = await caches.match(request);

        if (cachedResponse) {
          return cachedResponse;
        }

        // Fallback para navegación offline
        if (request.destination === 'document') {
          return caches.match('/index.html');
        }
      })
  );
});

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};

  let titulo = 'MandaYa';
  let opciones = {
    body: data.mensaje || 'Actualización importante',
    icon: '/img/logo.png',
    badge: '/img/icon-72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    },
    requireInteraction: false,
    actions: [
      {
        action: 'abrir',
        title: 'Abrir'
      }
    ]
  };

  // ==================== TIPOS DE NOTIFICACIÓN ====================
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

// ==================== CLICK NOTIFICACIÓN ====================
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    })
      .then(windowClients => {
        // Reusar ventana existente
        for (const client of windowClients) {
          if (client.url.includes(url) && 'focus' in client) {
            return client.focus();
          }
        }

        // Abrir nueva ventana
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// ==================== MENSAJE DEBUG ====================
console.log('[SW] Service Worker cargado correctamente');