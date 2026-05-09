// ==================== CONSTANTES Y VARIABLES GLOBALES ====================
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

// Mapa y marcadores
let map = null;
let originMarker = null;
let destMarker = null;
let originCoords = null;
let destCoords = null;
let currentRouteLayerId = 'current-route';
let currentRouteData = null;
let rutaYaDibujada = false;
let rutaActualTipo = null;
let rutaDestinoActual = null;

// Usuario y pedidos
let currentUser = null;
let pedidoActual = null;
let pedidoPendiente = null;
let ultimoEstadoPedido = null;
let deliveryMarker = null;  // ✅ Agregar

// Modos y control UI
let selectMode = 'origen';  // 'origen' o 'destino'
let clienteRouteControl = null;

// Intervalos y seguimiento
let seguimientoInterval = null;
let ubicacionInterval = null;
let deliverysInterval = null;

// Control de peticiones
let ultimaPeticionTime = 0;
let ultimaPeticionDeliverys = 0;
let paginaVisible = true;
// ✅ Array para marcadores de deliverys (VERSIÓN GLOBAL)
window.deliveryMarkers = [];
// ==================== BLOQUEAR/REACTIVAR UI ====================
function bloquearUIporPedidoActivo(bloquear) {
    const elementos = {
        inputs: ['origen', 'destino'],
        select: 'tipoEnvio',
        botones: ['btnOrigen', 'btnDestino'],
        botonSolicitar: 'solicitarEnvio'
    };
    
    if (bloquear) {
        elementos.inputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = true;
                input.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
            }
        });
        
        const select = document.getElementById(elementos.select);
        if (select) {
            select.disabled = true;
            select.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
        }
        
        elementos.botones.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.pointerEvents = 'none';
                btn.classList.add('opacity-50');
            }
        });
        
        if (originMarker) originMarker.dragging = false;
        if (destMarker) destMarker.dragging = false;
        
        if (map) {
            map.getCanvas().style.cursor = 'default';
        }
        
        const btnSolicitar = document.querySelector('button[onclick="solicitarEnvio()"], button[onclick="solicitarEnvioMobile()"]');
        if (btnSolicitar) {
            btnSolicitar.disabled = true;
            btnSolicitar.classList.add('opacity-50', 'cursor-not-allowed');
        }
        
        const origenInput = document.getElementById('origen');
        if (origenInput && !origenInput.placeholder.includes('(Bloqueado)')) {
            origenInput.placeholder = '📍 Origen (bloqueado - pedido en curso)';
        }
        const destinoInput = document.getElementById('destino');
        if (destinoInput && !destinoInput.placeholder.includes('(Bloqueado)')) {
            destinoInput.placeholder = '🏁 Destino (bloqueado - pedido en curso)';
        }

        if (typeof sincronizarBloqueoMobile === 'function') {
            sincronizarBloqueoMobile(true);
        }
        
        console.log("🔒 UI bloqueada - Pedido activo en curso");
        
    } else {
        elementos.inputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = false;
                input.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
                input.placeholder = id === 'origen' ? 'Buscar dirección o arrastra el marcador' : 'Buscar dirección o arrastra el marcador';
            }
        });
        
        const select = document.getElementById(elementos.select);
        if (select) {
            select.disabled = false;
            select.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
        }
        
        elementos.botones.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.pointerEvents = 'auto';
                btn.classList.remove('opacity-50');
            }
        });
        
        if (originMarker) originMarker.dragging = true;
        if (destMarker) destMarker.dragging = true;
        
        if (map) {
            map.getCanvas().style.cursor = 'crosshair';
        }
        
        const btnSolicitar = document.querySelector('button[onclick="solicitarEnvio()"], button[onclick="solicitarEnvioMobile()"]');
        if (btnSolicitar) {
            btnSolicitar.disabled = false;
            btnSolicitar.classList.remove('opacity-50', 'cursor-not-allowed');
        }

        if (typeof sincronizarBloqueoMobile === 'function') {
            sincronizarBloqueoMobile(false);
        }
        
        console.log("🔓 UI reactivada - Sin pedido activo");
    }
}

// Detectar cuando la pestaña está visible
document.addEventListener('visibilitychange', () => {
    paginaVisible = !document.hidden;
    if (paginaVisible) {
        console.log("🟢 Página visible - Reactivando actualizaciones");
        if (typeof cargarPedidos === 'function') cargarPedidos();
        if (typeof cargarDeliverysEnLinea === 'function') cargarDeliverysEnLinea();
    } else {
        console.log("🔴 Página oculta - Reduciendo actualizaciones");
    }
});

async function peticionConThrottling(funcion, nombre, intervaloMinimo = 3000) {
    const ahora = Date.now();
    if (!paginaVisible) {
        console.log(`⏸️ Página oculta, omitiendo ${nombre}`);
        return null;
    }
    if (ahora - ultimaPeticionTime < intervaloMinimo) {
        console.log(`⏳ Throttling: ${nombre} - muy rápido`);
        return null;
    }
    ultimaPeticionTime = ahora;
    return await funcion();
}

// ==================== INICIALIZACIÓN CON MAPLIBRE (CLIENTE) ====================
function initMap() {
    if (map) {
        console.log("⚠️ Mapa ya inicializado");
        return;
    }
    
    console.log("🗺️ Inicializando mapa...");

    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'osm-raster': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }
            },
            layers: [{
                id: 'osm-raster-layer',
                type: 'raster',
                source: 'osm-raster',
                minzoom: 0,
                maxzoom: 19
            }]
        },
        center: [-91.8249, 18.6456],
        zoom: 13.5,
        minZoom: 12,
        maxZoom: 18,
        maxBounds: [[-91.95, 18.50], [-91.70, 18.75]]  // Límite suave
    });

    window.map = map;
    
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Limitador suave (mejor que el anterior)
    let ajustando = false;
    map.on('moveend', () => {
        if (ajustando) return;
        
        const center = map.getCenter();
        if (center.lng < -91.95 || center.lng > -91.70 || 
            center.lat < 18.50 || center.lat > 18.75) {
            
            ajustando = true;
            map.flyTo({
                center: [-91.8249, 18.6456],
                zoom: Math.min(map.getZoom(), 15),
                duration: 1000
            });
            setTimeout(() => ajustando = false, 1200);
        }
    });

    map.on('load', () => {
        console.log('✅ Mapa cargado correctamente');
        crearMarcadoresIniciales();
        
        setTimeout(() => {
            if (typeof cargarDeliverysEnLinea === 'function') {
                cargarDeliverysEnLinea();
            }
        }, 800);
    });

    console.log("✅ Mapa inicializado");
}

// Agregar en cliente.js
function calculateShippingRate(distanceKm, tipo) {
    const km = parseFloat(distanceKm);
    let baseRate = 0;
    
    // Tarifa base por distancia
    if (km <= 1) baseRate = 30;
    else if (km <= 2) baseRate = 35;
    else if (km <= 3) baseRate = 40;
    else if (km <= 4) baseRate = 45;
    else if (km <= 5) baseRate = 50;
    else if (km <= 6) baseRate = 60;
    else if (km <= 7) baseRate = 70;
    else baseRate = 70 + ((km - 7) * 10);
    
    // Ajuste por tipo de envío
    if (tipo === 'comida') baseRate += 5;
    else if (tipo === 'farmacia') baseRate += 5;
    else if (tipo === 'mercancia') baseRate += 10;
    
    return { 
        total: Math.round(baseRate), 
        base: Math.round(baseRate), 
        porKm: null 
    };
}

// CORREGIR en cliente.js - Usar la función correcta
function crearMarcadoresIniciales() {
    console.log("🟢 Creando marcadores arrastrables...");
    
    // Limpiar marcadores existentes
    if (originMarker) {
        try { originMarker.remove(); } catch(e) {}
        originMarker = null;
    }
    if (destMarker) {
        try { destMarker.remove(); } catch(e) {}
        destMarker = null;
    }
    
    // Crear marcador ORIGEN usando la función global
    if (typeof crearMarcadorCirculo !== 'undefined') {
        originMarker = crearMarcadorCirculo(map, -91.8249, 18.6456, '#FF6200', 'fa-circle', 'ORIGEN');
    } else {
        // Fallback si no existe la función
        const el = document.createElement('div');
        el.style.cssText = 'background:#FF6200; width:32px; height:32px; border-radius:50%; border:3px solid white; cursor:grab;';
        originMarker = new maplibregl.Marker({ element: el, draggable: true })
            .setLngLat([-91.8249, 18.6456])
            .addTo(map);
    }
    
    // Evento dragend para origen
    if (originMarker) {
        originMarker.on('dragend', () => {
            const { lng, lat } = originMarker.getLngLat();
            if (lat >= 18.58 && lat <= 18.70 && lng >= -91.88 && lng <= -91.75) {
                originCoords = { lat, lng };
                reverseGeocode(originCoords, (addr) => {
                    document.getElementById("origen").value = addr;
                    if (document.getElementById("origenMobile")) document.getElementById("origenMobile").value = addr;
                });
                actualizarRutaYTarifa();
                mostrarToast("📍 Origen actualizado");
            } else {
                mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
                if (originCoords) originMarker.setLngLat([originCoords.lng, originCoords.lat]);
            }
        });
    }
    
    // Crear marcador DESTINO
    if (typeof crearMarcadorCirculo !== 'undefined') {
        destMarker = crearMarcadorCirculo(map, -91.8149, 18.6556, '#3B82F6', 'fa-flag-checkered', 'DESTINO');
    } else {
        const el = document.createElement('div');
        el.style.cssText = 'background:#3B82F6; width:32px; height:32px; border-radius:50%; border:3px solid white; cursor:grab;';
        destMarker = new maplibregl.Marker({ element: el, draggable: true })
            .setLngLat([-91.8149, 18.6556])
            .addTo(map);
    }
    
    if (destMarker) {
        destMarker.on('dragend', () => {
            const { lng, lat } = destMarker.getLngLat();
            if (lat >= 18.58 && lat <= 18.70 && lng >= -91.88 && lng <= -91.75) {
                destCoords = { lat, lng };
                reverseGeocode(destCoords, (addr) => {
                    document.getElementById("destino").value = addr;
                    if (document.getElementById("destinoMobile")) document.getElementById("destinoMobile").value = addr;
                });
                actualizarRutaYTarifa();
                mostrarToast("🏁 Destino actualizado");
            } else {
                mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
                if (destCoords) destMarker.setLngLat([destCoords.lng, destCoords.lat]);
            }
        });
    }
    
    // Inicializar coordenadas
    originCoords = { lat: 18.6456, lng: -91.8249 };
    destCoords = { lat: 18.6556, lng: -91.8149 };
    
    reverseGeocode(originCoords, (addr) => {
        document.getElementById("origen").value = addr;
        if (document.getElementById("origenMobile")) document.getElementById("origenMobile").value = addr;
    });
    reverseGeocode(destCoords, (addr) => {
        document.getElementById("destino").value = addr;
        if (document.getElementById("destinoMobile")) document.getElementById("destinoMobile").value = addr;
    });
    
    // Ajustar vista para ver ambos marcadores
    setTimeout(() => {
        try {
           // Después de dibujar la ruta:
        const bounds = new maplibregl.LngLatBounds()
        .extend([origin.lng, origin.lat])
        .extend([dest.lng, dest.lat]);
    
    map.fitBounds(bounds, { 
        padding: 70,
        duration: 1600,
        maxZoom: 16.2   // ← Evita que haga zoom demasiado
    });
        
        } catch(e) {
            console.log("Error ajustando bounds:", e);
        }
    }, 500);
    
    setTimeout(() => actualizarRutaYTarifa(), 500);
    console.log("✅ Marcadores creados correctamente");
}

// CORREGIR en cliente.js
function actualizarMarcadorOrigen(lat, lng) {
    if (originMarker) {
        originMarker.setLngLat([lng, lat]);
    }
    originCoords = { lat, lng };
    reverseGeocode(originCoords, (addr) => {
        document.getElementById("origen").value = addr;
        if (document.getElementById("origenMobile")) document.getElementById("origenMobile").value = addr;
    });
    actualizarRutaYTarifa();
}

function actualizarMarcadorDestino(lat, lng) {
    if (destMarker) {
        destMarker.setLngLat([lng, lat]);
    }
    destCoords = { lat, lng };
    reverseGeocode(destCoords, (addr) => {
        document.getElementById("destino").value = addr;
        if (document.getElementById("destinoMobile")) document.getElementById("destinoMobile").value = addr;
    });
    actualizarRutaYTarifa();
}

function loadUser() {
    if (seguimientoInterval) clearInterval(seguimientoInterval);
    if (ubicacionInterval) clearInterval(ubicacionInterval);
    if (deliverysInterval) clearInterval(deliverysInterval);
    
    const sesion = localStorage.getItem('sesion_activa');
    if (!sesion) { window.location.href = "index.html"; return; }
    currentUser = JSON.parse(sesion);
    if (currentUser.rol !== 'cliente') { window.location.href = "delivery.html"; return; }
    document.getElementById("userInfo").innerHTML = `<div class="flex items-center gap-2"><i class="fas fa-user-circle text-[#FF6200] text-xl"></i><span class="font-medium">${currentUser.nombre}</span><span class="text-gray-400 text-xs">(Cliente)</span></div>`;
}

function centrarMapa() {
    if (map) {
        map.setCenter([-91.8249, 18.6456]);
        map.setZoom(13);
    }
    mostrarToast("📍 Mapa centrado en Ciudad del Carmen");
}

function setSelectMode(mode) {
    selectMode = mode;
    document.getElementById('btnOrigen').className = mode === 'origen' ? 'mode-btn active' : 'mode-btn inactive';
    document.getElementById('btnDestino').className = mode === 'destino' ? 'mode-btn active' : 'mode-btn inactive';
    
    if (mode === 'origen') {
        if (originMarker) originMarker.togglePopup();
        mostrarToast("📍 Modo ORIGEN - Haz clic en el mapa o arrastra el marcador naranja");
    } else {
        if (destMarker) destMarker.togglePopup();
        mostrarToast("🏁 Modo DESTINO - Haz clic en el mapa o arrastra el marcador azul");
    }
}

// CORREGIR en cliente.js
function limpiarRutaCliente() {
    if (!map) return;
    
    // Capas y fuentes de ruta a limpiar
    const routeLayers = ['current-route', 'route-layer', 'delivery-route', 'fallback-line'];
    const routeSources = ['current-route', 'route-source', 'delivery-route', 'fallback-line'];
    
    routeLayers.forEach(layerId => {
        try {
            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
        } catch(e) { /* ignorar */ }
    });
    
    routeSources.forEach(sourceId => {
        try {
            if (map.getSource(sourceId)) {
                map.removeSource(sourceId);
            }
        } catch(e) { /* ignorar */ }
    });
}

// CORREGIR en cliente.js
async function dibujarRutaMapLibre(origin, dest, color, weight = 5) {
    if (!map || !origin || !dest) return null;
    
    // ✅ Limpiar ruta anterior correctamente
    try {
        // Primero eliminar la capa
        if (map.getLayer('current-route')) {
            map.removeLayer('current-route');
        }
        // Luego eliminar la fuente
        if (map.getSource('current-route')) {
            map.removeSource('current-route');
        }
        // También limpiar otras posibles capas
        if (map.getLayer('route-layer')) {
            map.removeLayer('route-layer');
        }
        if (map.getSource('route-source')) {
            map.removeSource('route-source');
        }
    } catch(e) {
        console.warn("Error limpiando ruta anterior:", e);
    }
    
    try {
        const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`
        );
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            const geojson = route.geometry;
            
            // ✅ Verificar que la fuente no exista antes de crearla
            if (!map.getSource('current-route')) {
                map.addSource('current-route', {
                    type: 'geojson',
                    data: geojson
                });
            } else {
                // Si ya existe, actualizar los datos
                map.getSource('current-route').setData(geojson);
            }
            
            // ✅ Verificar que la capa no exista antes de crearla
            if (!map.getLayer('current-route')) {
                map.addLayer({
                    id: 'current-route',
                    type: 'line',
                    source: 'current-route',
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    paint: {
                        'line-color': color,
                        'line-width': weight,
                        'line-opacity': 0.8
                    }
                });
            }
            
            console.log(`✅ Ruta dibujada: ${(route.distance / 1000).toFixed(2)} km`);
            
            return {
                distance: route.distance / 1000,
                duration: route.duration / 60
            };
        }
    } catch(e) {
        console.error('Error dibujando ruta:', e);
    }
    return null;
}

async function dibujarRutaDeliveryEnCliente(ubicacionDelivery, destinoCoords, tipo) {
    if (!ubicacionDelivery || !destinoCoords) {
        console.log("❌ Faltan coordenadas para dibujar ruta:", { ubicacionDelivery, destinoCoords });
        return;
    }
    
    const color = tipo === 'recogida' ? '#10B981' : '#FF6200';
    
    await dibujarRutaMapLibre(
        { lng: ubicacionDelivery.lng, lat: ubicacionDelivery.lat },
        { lng: destinoCoords.lng, lat: destinoCoords.lat },
        color,
        4
    );
}

// CORREGIR en cliente.js
async function actualizarRutaYTarifa() {
    if (originCoords && destCoords) {
        const tarifaContainer = document.getElementById("tarifaContainer");
        if (tarifaContainer) tarifaContainer.classList.remove("hidden");
        
        const tarifaValue = document.getElementById("tarifaValue");
        if (tarifaValue) tarifaValue.innerHTML = '<div class="loading-spinner"></div> Calculando...';
        
        const tipoEnvio = document.getElementById("tipoEnvio")?.value || 'paquete';
        
        const routeResult = await dibujarRutaMapLibre(originCoords, destCoords, '#FF6200', 5);
        
        if (routeResult) {
            const distance = routeResult.distance;
            const rate = calculateShippingRate(distance, tipoEnvio);
            
            currentRouteData = { 
                distance: distance, 
                duration: routeResult.duration,
                extras: currentRouteData?.extras || { lluvia: false, noche: false, espera: false }
            };
            
            let tarifaMostrar = rate.total;
            if (currentRouteData.extras) {
                if (currentRouteData.extras.lluvia) tarifaMostrar += 10;
                if (currentRouteData.extras.noche) tarifaMostrar += 10;
                if (currentRouteData.extras.espera) tarifaMostrar += 10;
            }
            
            if (tarifaValue) tarifaValue.innerHTML = `$${tarifaMostrar} MXN`;
            mostrarToast(`📏 Distancia: ${distance.toFixed(2)} km • ⏱️ ${formatDuration(routeResult.duration)}`);
            
            // Actualizar mobile
            const tarifaContainerMobile = document.getElementById("tarifaContainerMobile");
            const tarifaValueMobile = document.getElementById("tarifaValueMobile");
            if (tarifaContainerMobile) tarifaContainerMobile.classList.remove("hidden");
            if (tarifaValueMobile) tarifaValueMobile.innerHTML = `$${tarifaMostrar} MXN`;
            
        } else {
            // Fallback: calcular distancia lineal
            const distance = calcularDistancia();
            const rate = calculateShippingRate(distance, tipoEnvio);
            if (tarifaValue) tarifaValue.innerHTML = `$${rate.total} MXN (estimado)`;
            mostrarToast(`⚠️ Usando distancia estimada: ${distance.toFixed(2)} km`, true);
        }
    }
}

// Agregar en cliente.js - Funciones auxiliares faltantes
function formatDuration(minutes) {
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}min`;
}

async function getRealDistanceAndTime(origin, dest) {
    if (!origin || !dest) return null;
    
    try {
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`);
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
            const distance = data.routes[0].distance / 1000;
            const duration = data.routes[0].duration / 60;
            return {
                distance: distance,
                distanceKm: distance.toFixed(2),
                duration: duration,
                durationText: formatDuration(duration)
            };
        }
    } catch(e) {
        console.error('Error obteniendo distancia:', e);
    }
    return null;
}

function calcularDistancia() {
    const R = 6371;
    const dLat = (destCoords.lat - originCoords.lat) * Math.PI / 180;
    const dLon = (destCoords.lng - originCoords.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(originCoords.lat * Math.PI / 180) * Math.cos(destCoords.lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function reverseGeocode(latlng, callback) {
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&zoom=18`)
        .then(res => res.json())
        .then(data => {
            let address = data.display_name?.split(',')[0];
            if (address && address.length > 40) address = address.substring(0, 40) + '...';
            callback(address || `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`);
        })
        .catch(() => callback(`${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`));
}

function crearMarcadorDelivery(delivery) {
    if (!map || typeof map.addSource !== 'function') {
        console.warn("⏳ Mapa no listo");
        return null;
    }
    
    if (!delivery || typeof delivery.lat !== 'number' || typeof delivery.lng !== 'number') {
        console.warn("⚠️ Datos inválidos:", delivery);
        return null;
    }
    
    try {
        // Extraer solo el primer nombre
        let nombreMostrar = delivery.nombre || 'Delivery';
        const primerNombre = nombreMostrar.trim().split(' ')[0];
        
        const markerDiv = document.createElement('div');
        const color = delivery.online ? '#10B981' : '#6B7280';
        
        markerDiv.innerHTML = `
            <div style="position: relative; transform: translateY(-100%); display: flex; flex-direction: column; align-items: center;">
                <!-- Nombre con fondo más suave y bordes redondeados -->
                <div style="background:rgba(0,0,0,0.7); backdrop-filter: blur(4px); color:white; font-size:11px; font-weight:500; padding:4px 10px; border-radius:20px; margin-bottom:6px; white-space:nowrap; box-shadow: 0 1px 4px rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.2);">
                    ${primerNombre}
                </div>
                <!-- Círculo de la moto -->
                <div style="background-color: ${color}; width:32px; height:32px; border-radius:50%; border:2.5px solid white; display:flex; align-items:center; justify-content:center; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">
                    <i class="fas fa-motorcycle" style="color:white; font-size:16px;"></i>
                </div>
                <!-- Punta hacia abajo -->
                <div style="position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%);
                            width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent;
                            border-top: 8px solid ${color};">
                </div>
            </div>
        `;
        
        const marker = new maplibregl.Marker({
            element: markerDiv.firstElementChild,
            draggable: false,
            anchor: 'bottom'
        }).setLngLat([delivery.lng, delivery.lat]).addTo(map);
        
        const estado = delivery.online ? '🟢 En línea' : '⚫ Desconectado';
        const popup = new maplibregl.Popup({ offset: [0, -40] })
            .setHTML(`<b>🏍️ ${primerNombre}</b><br>${estado}`);
        marker.setPopup(popup);
        
        return marker;
    } catch(e) {
        console.error("❌ Error:", e);
        return null;
    }
}

async function solicitarEnvio() {
    const origen = document.getElementById("origen").value;
    const destino = document.getElementById("destino").value;
    const tipo = document.getElementById("tipoEnvio").value;
    
    if (!originCoords || !destCoords) {
        mostrarToast("❌ Error: No se han seleccionado origen o destino válidos", true);
        return;
    }
    
    if (!tipo || tipo === '') {
        mostrarToast("❌ Por favor, selecciona qué vas a enviar (Comida, Paquete, Mercancía o Farmacia)", true);
        const selectTipo = document.getElementById("tipoEnvio");
        selectTipo.style.border = "2px solid #dc2626";
        setTimeout(() => {
            selectTipo.style.border = "";
        }, 2000);
        return;
    }
    
    let distancia = currentRouteData ? currentRouteData.distance : calcularDistancia();
    const rate = calculateShippingRate(distancia, tipo);
    let tarifaBase = rate.total;
    
    let tarifaFinal = tarifaBase;
    if (currentRouteData && currentRouteData.extras) {
        tarifaFinal = tarifaBase;
        if (currentRouteData.extras.lluvia) tarifaFinal += 10;
        if (currentRouteData.extras.noche) tarifaFinal += 10;
        if (currentRouteData.extras.espera) tarifaFinal += 10;
    }
    
    pedidoPendiente = {
        id: Date.now(),
        cliente_id: currentUser.id,
        cliente_nombre: currentUser.nombre,
        origen: origen,
        destino: destino,
        origen_lat: originCoords.lat,
        origen_lng: originCoords.lng,
        destino_lat: destCoords.lat,
        destino_lng: destCoords.lng,
        tipo: tipo,
        distancia_real: distancia.toFixed(2),
        tarifa: tarifaFinal,
        extras: currentRouteData?.extras || { lluvia: false, noche: false, espera: false },
        estado: 'pendiente',
        fecha: new Date().toISOString()
    };
    
    document.getElementById("modalPago").classList.remove("hidden");
    document.getElementById("modalPago").classList.add("flex");
}

function seleccionarPago(metodo) { 
    cerrarModalPago(); 
    if (metodo === 'efectivo') {
        const total = pedidoPendiente.tarifa;
        document.getElementById("efectivoTotal").innerHTML = `$${total}`;
        document.getElementById("montoPaga").value = '';
        document.getElementById("cambioTotal").innerHTML = '$0';
        document.getElementById("modalEfectivo").classList.remove("hidden");
        document.getElementById("modalEfectivo").classList.add("flex");
    } else if (metodo === 'transferencia') {
        document.getElementById("transferenciaTotal").innerHTML = `$${pedidoPendiente.tarifa}`;
        document.getElementById("modalTransferencia").classList.remove("hidden");
        document.getElementById("modalTransferencia").classList.add("flex");
    }
}

function calcularCambio() {
    const total = pedidoPendiente.tarifa;
    const paga = parseFloat(document.getElementById("montoPaga").value) || 0;
    const cambio = paga - total;
    document.getElementById("cambioTotal").innerHTML = `$${cambio >= 0 ? cambio : 0}`;
}

async function confirmarPagoEfectivo() {
    const total = pedidoPendiente.tarifa;
    const paga = parseFloat(document.getElementById("montoPaga").value) || 0;
    
    if (paga < total) {
        mostrarToast(`❌ El monto es insuficiente. Faltan $${(total - paga).toFixed(2)}`, true);
        return;
    }
    
    const cambio = paga - total;
    if (cambio > 0) {
        mostrarToast(`✅ Cambio a devolver: $${cambio.toFixed(2)}`);
    }
    
    await guardarPedidoEnSupabase();
    cerrarModalEfectivo();
}

// ==================== EXTRAS ====================
let extrasSeleccionados = { lluvia: false, noche: false, espera: false };
let tarifaBaseSinExtras = 0;

function calcularTotalConExtras(tarifaBase) {
    let total = tarifaBase;
    if (extrasSeleccionados.lluvia) total += 10;
    if (extrasSeleccionados.noche) total += 10;
    if (extrasSeleccionados.espera) total += 10;
    return total;
}

// ==================== PANEL DE ESTADO DEL PEDIDO ====================
function mostrarPanelEstado(pedido) {
    const panel = document.getElementById("panelEstadoPedido");
    if (!panel) return;
    
    document.getElementById("pedidoIdLabel").innerText = pedido.id;
    actualizarEstadoPanel(pedido.estado);
    panel.classList.remove("hidden");
    
    if (pedido && (pedido.estado === 'asignado' || pedido.estado === 'recogido' || pedido.estado === 'pendiente')) {
        bloquearUIporPedidoActivo(true);
    }
}

function actualizarEstadoPanel(estado, deliveryNombre = null) {
    const estadoTexto = document.getElementById("estadoTexto");
    const estadoIcono = document.getElementById("estadoIcono");
    const estadoDetalle = document.getElementById("estadoDetalle");
    
    const estadoTextoMobile = document.getElementById("estadoTextoMobile");
    const estadoIconoMobile = document.getElementById("estadoIconoMobile");
    const estadoDetalleMobile = document.getElementById("estadoDetalleMobile");
    
    switch(estado) {
        case 'pendiente':
            if(estadoTexto) estadoTexto.innerText = "⏳ Pedido pendiente";
            if(estadoIcono) estadoIcono.className = "fas fa-clock text-yellow-500";
            if(estadoDetalle) estadoDetalle.innerText = "Esperando a que un delivery tome tu pedido...";
            if(estadoTextoMobile) estadoTextoMobile.innerText = "⏳ Pedido pendiente";
            if(estadoIconoMobile) estadoIconoMobile.className = "fas fa-clock text-yellow-500";
            if(estadoDetalleMobile) estadoDetalleMobile.innerText = "Esperando a que un delivery tome tu pedido...";
            break;
            
        case 'asignado':
            if(estadoTexto) estadoTexto.innerText = "🚚 En camino a recoger";
            if(estadoIcono) estadoIcono.className = "fas fa-motorcycle text-orange-500";
            if(estadoDetalle) estadoDetalle.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> ya se dirige a recoger tu paquete.`;
            if(estadoTextoMobile) estadoTextoMobile.innerText = "🚚 En camino a recoger";
            if(estadoIconoMobile) estadoIconoMobile.className = "fas fa-motorcycle text-orange-500";
            if(estadoDetalleMobile) estadoDetalleMobile.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> ya se dirige a recoger tu paquete.`;
            break;
            
        case 'recogido':
            if(estadoTexto) estadoTexto.innerText = "📦 Paquete recogido";
            if(estadoIcono) estadoIcono.className = "fas fa-box-open text-purple-500";
            if(estadoDetalle) estadoDetalle.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> ya recogió tu paquete y va en camino.`;
            if(estadoTextoMobile) estadoTextoMobile.innerText = "📦 Paquete recogido";
            if(estadoIconoMobile) estadoIconoMobile.className = "fas fa-box-open text-purple-500";
            if(estadoDetalleMobile) estadoDetalleMobile.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> ya recogió tu paquete y va en camino.`;
            break;
            
       case 'completado':
           console.log("🎉 Actualizando UI para pedido COMPLETADO");
           
           const panel = document.getElementById("panelEstadoPedido");
           const panelMobile = document.getElementById("panelEstadoPedidoMobile");
           if(panel) panel.classList.add("hidden");
           if(panelMobile) panelMobile.classList.add("hidden");
           
           pedidoActual = null;
           bloquearUIporPedidoActivo(false);
           
           if(seguimientoInterval) {
               clearInterval(seguimientoInterval);
               seguimientoInterval = null;
           }
           if(ubicacionInterval) {
               clearInterval(ubicacionInterval);
               ubicacionInterval = null;
           }
           
           if(deliveryMarker) {
               map.removeLayer(deliveryMarker);
               deliveryMarker = null;
           }
           
           limpiarRutaCliente();
           
           const selectTipo = document.getElementById("tipoEnvio");
           if(selectTipo) selectTipo.value = "";
           
           const origenInput = document.getElementById("origen");
           const destinoInput = document.getElementById("destino");
           if(origenInput) origenInput.value = "";
           if(destinoInput) destinoInput.value = "";
           
           cargarDeliverysEnLinea();
           
           setTimeout(() => {
               if(map) {
                   map.setCenter([-91.8249, 18.6456]);
                   map.setZoom(13);
               }
           }, 500);
           
           mostrarToast("🎉 ¡Envío completado! Gracias por usar MandaYa");
           break;    
    }
}

async function cancelarPedido() {
    if (!pedidoActual || pedidoActual.estado !== 'pendiente') {
        mostrarToast("❌ No se puede cancelar este pedido porque ya está en camino o completado", true);
        return;
    }
    
    mostrarModalConfirmacion(
        "Cancelar pedido",
        `¿Estás seguro de cancelar el pedido #${pedidoActual.id}? Esta acción no se puede deshacer.`,
        async () => {
            const supabase = supabaseClient;
            if (!supabase) return;
            
            try {
                const { error } = await supabase
                    .from('pedidos')
                    .delete()
                    .eq('id', pedidoActual.id);
                
                if (error) throw error;
                
                mostrarToast(`✅ Pedido #${pedidoActual.id} cancelado correctamente`);
                bloquearUIporPedidoActivo(false);
                limpiarYResetearUI();
                
            } catch(e) {
                console.error('Error cancelando pedido:', e);
                mostrarToast("❌ Error al cancelar el pedido", true);
            }
        }
    );
}

function limpiarYResetearUI() {
    bloquearUIporPedidoActivo(false);
    
    if (seguimientoInterval) {
        clearInterval(seguimientoInterval);
        seguimientoInterval = null;
    }
    if (ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
    }
    if (deliverysInterval) {
        clearInterval(deliverysInterval);
        deliverysInterval = null;
    }
    
    document.getElementById("origen").value = "";
    document.getElementById("destino").value = "";
    document.getElementById("tipoEnvio").value = "";
    document.getElementById("tarifaContainer").classList.add("hidden");
    
    if (originMarker && destMarker) {
        originCoords = { lat: 18.6456, lng: -91.8249 };
        destCoords = { lat: 18.6556, lng: -91.8149 };
        originMarker.setLngLat([originCoords.lng, originCoords.lat]);
        destMarker.setLngLat([destCoords.lng, destCoords.lat]);
        reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
        reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
    }
    
    limpiarRutaCliente();
    
    if (map && map.getLayer('fallback-line')) map.removeLayer('fallback-line');
    if (map && map.getSource('fallback-line')) map.removeSource('fallback-line');
    
    if (deliveryMarker) {
        map.removeLayer(deliveryMarker);
        deliveryMarker = null;
    }
    
    document.getElementById("panelEstadoPedido").classList.add("hidden");
    pedidoActual = null;
    pedidoPendiente = null;
    
    if (currentUser && currentUser.rol === 'cliente') {
        if (deliverysInterval) clearInterval(deliverysInterval);
        deliverysInterval = setInterval(() => cargarDeliverysEnLinea(), 5000);
        cargarDeliverysEnLinea();
    }
    mostrarToast("🔄 Todo listo. Puedes hacer un nuevo envío.");
}

function forzarReactivacionUI() {
    console.log("🔄 Forzando reactivación de UI");
    
    const origenInput = document.getElementById("origen");
    const destinoInput = document.getElementById("destino");
    const selectTipo = document.getElementById("tipoEnvio");
    const btnSolicitar = document.querySelector('button[onclick="solicitarEnvio()"]');
    
    if(origenInput) {
        origenInput.disabled = false;
        origenInput.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
    }
    if(destinoInput) {
        destinoInput.disabled = false;
        destinoInput.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
    }
    if(selectTipo) {
        selectTipo.disabled = false;
        selectTipo.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
    }
    if(btnSolicitar) {
        btnSolicitar.disabled = false;
        btnSolicitar.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    
    if(originMarker) originMarker.dragging = true;
    if(destMarker) destMarker.dragging = true;
    
    if (map) {
        map.getCanvas().style.cursor = 'crosshair';
    }
    
    const panel = document.getElementById("panelEstadoPedido");
    if(panel) panel.classList.add("hidden");
    
    pedidoActual = null;
    
    mostrarToast("✅ Listo para un nuevo envío");
}

async function guardarPedidoEnSupabase() {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
        const pedidoAGuardar = {
            ...pedidoPendiente,
            extras: pedidoPendiente.extras || { lluvia: false, noche: false, espera: false }
        };
        
        const { error } = await supabase
            .from('pedidos')
            .insert([pedidoAGuardar]);
        
        if (error) throw error;
        
        pedidoActual = pedidoPendiente;
        
        cerrarModalPago();
        cerrarModalEfectivo();
        cerrarModalTransferencia();
        
        mostrarPanelEstado(pedidoActual);
        
        mostrarToast(`✅ ¡Envío solicitado! ID: #${pedidoActual.id} - Esperando delivery`);
        iniciarSeguimientoDelivery();
        
    } catch(e) {
        console.error('Error creando pedido:', e);
        mostrarToast("❌ Error al crear el pedido: " + (e.message || "Verifica la consola"), true);
    }
}

function enviarComprobanteWhatsApp() {
    if (!pedidoPendiente) {
        mostrarToast("❌ No hay información del pedido", true);
        return;
    }
    
    const total = pedidoPendiente.tarifa;
    const pedidoId = pedidoPendiente.id;
    const numeroWhatsApp = '5219381083498';
    
    let mensaje = `🍔 *MANDAYA - NUEVO PEDIDO* 🍔\n\n`;
    mensaje += `🎫 *PEDIDO:* #${pedidoId}\n`;
    mensaje += `👤 *CLIENTE:* ${pedidoPendiente.cliente_nombre}\n`;
    mensaje += `\n━━━━━━━━━━━━━━━\n`;
    mensaje += `📦 *DETALLES DEL ENVÍO:*\n`;
    mensaje += `\n📍 *ORIGEN:* ${pedidoPendiente.origen}\n`;
    mensaje += `🏁 *DESTINO:* ${pedidoPendiente.destino}\n`;
    mensaje += `📏 *DISTANCIA:* ${pedidoPendiente.distancia_real} km\n`;
    mensaje += `📦 *TIPO:* ${pedidoPendiente.tipo}\n`;
    mensaje += `\n━━━━━━━━━━━━━━━\n`;
    mensaje += `💰 *TOTAL A PAGAR:* $${total} MXN\n`;
    mensaje += `\n━━━━━━━━━━━━━━━\n`;
    mensaje += `✅ *Comprobante de pago adjunto*\n`;
    mensaje += `\n🙏 *¡Gracias por usar MandaYa!*`;
    
    const mensajeCodificado = encodeURIComponent(mensaje);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${numeroWhatsApp}&text=${mensajeCodificado}`;
    
    window.open(whatsappUrl, '_blank');
    mostrarToast("📱 Abriendo WhatsApp...");
    confirmarPagoTransferencia();
}

async function confirmarPagoTransferencia() {
    await guardarPedidoEnSupabase();
    cerrarModalTransferencia();
    mostrarToast("✅ ¡Pago registrado! Envía tu comprobante por WhatsApp para confirmar.");
}

function cerrarModalPago() {
    const modal = document.getElementById("modalPago");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function cerrarModalEfectivo() {
    const modal = document.getElementById("modalEfectivo");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function cerrarModalTransferencia() {
    const modal = document.getElementById("modalTransferencia");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function copiarDatosBancarios() {
    const datos = `BBVA México\nCuenta: 1234 5678 9012 3456\nCLABE: 012 345 6789 01234567 8\nBeneficiario: MandaYa Servicios`;
    navigator.clipboard.writeText(datos);
    mostrarToast("✅ Datos bancarios copiados");
}

// ==================== SEGUIMIENTO DE DELIVERY ====================
function iniciarSeguimientoDelivery() {
    if (!pedidoActual || !pedidoActual.id) {
        console.error("No hay pedido actual para seguir");
        return;
    }

    if (seguimientoInterval) {
        clearInterval(seguimientoInterval);
        seguimientoInterval = null;
    }
    
    mostrarToast("🟢 Buscando delivery disponible...");

    seguimientoInterval = setInterval(async () => {
        const supabase = supabaseClient;
        if (!supabase) return;
        
        try {
            const { data: pedidoActualizado, error } = await supabase
                .from('pedidos')
                .select('*')
                .eq('id', pedidoActual.id)
                .single();
            
            if (error) throw error;
            
            if (pedidoActualizado) {
                const estadoAnterior = pedidoActual.estado;
                pedidoActual = pedidoActualizado;
                
                if (pedidoActualizado.estado === 'completado') {
                    console.log("🎉 Pedido completado detectado! Limpiando UI...");
                    
                    if (seguimientoInterval) {
                        clearInterval(seguimientoInterval);
                        seguimientoInterval = null;
                    }
                    if (ubicacionInterval) {
                        clearInterval(ubicacionInterval);
                        ubicacionInterval = null;
                    }
                    
                    actualizarEstadoPanel('completado');
                    rutaYaDibujada = false;
                    ultimoEstadoPedido = null;
                    rutaDestinoActual = null;
                    pedidoActual = null;
                    bloquearUIporPedidoActivo(false);
                    cargarDeliverysEnLinea();
                    
                    return;
                }
                
                if (pedidoActualizado.estado === 'asignado' && pedidoActualizado.delivery_nombre) {
                    actualizarEstadoPanel('asignado', pedidoActualizado.delivery_nombre);
                } else if (pedidoActualizado.estado === 'recogido' && pedidoActualizado.delivery_nombre) {
                    actualizarEstadoPanel('recogido', pedidoActualizado.delivery_nombre);
                    if (estadoAnterior === 'asignado') {
                        mostrarToast(`📦 ¡El delivery ${pedidoActualizado.delivery_nombre} ya recogió tu paquete!`);
                    }
                } else if (pedidoActualizado.estado === 'pendiente') {
                    actualizarEstadoPanel('pendiente');
                }
            }
            
            if (pedidoActualizado && 
                (pedidoActualizado.estado === 'asignado' || pedidoActualizado.estado === 'recogido') && 
                pedidoActualizado.delivery_id) {
                
                if (!ubicacionInterval) {
                    mostrarToast(`✅ Delivery asignado: ${pedidoActualizado.delivery_nombre || 'Delivery'}`);
                    mostrarDeliveryEnMapa(pedidoActualizado.delivery_id, pedidoActualizado.delivery_nombre);
                    seguirUbicacionDelivery(pedidoActualizado.delivery_id);
                }
            }
            
        } catch(e) {
            console.error('Error en seguimiento:', e);
        }
    }, 3000);
}

function seguirUbicacionDelivery(deliveryId) {
    if (ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
    }
    
    if (deliveryMarker) {
        try { map.removeLayer(deliveryMarker); } catch(e) {}
        deliveryMarker = null;
    }
    
    console.log(`🔄 Ocultando delivery ${deliveryId} de la lista general de deliverys`);
    cargarDeliverysEnLinea();
    
    ubicacionInterval = setInterval(async () => {
        let ubicacion = null;
        
        if (typeof obtenerUbicacionDeSupabase !== 'undefined') {
            ubicacion = await obtenerUbicacionDeSupabase(deliveryId);
            if (ubicacion && ubicacion.lat && ubicacion.lng) {
                ubicacion = { lat: ubicacion.lat, lng: ubicacion.lng };
            }
        }
        
        let deliveryNombre = 'Delivery';
        const supabase = supabaseClient;
        if (supabase && deliveryId && !pedidoActual?.delivery_nombre) {
            const { data: delivery } = await supabase
                .from('usuarios')
                .select('nombre')
                .eq('id', deliveryId)
                .single();
            if (delivery) deliveryNombre = delivery.nombre;
        } else if (pedidoActual?.delivery_nombre) {
            deliveryNombre = pedidoActual.delivery_nombre;
        }
        
        if (ubicacion) {
            if (deliveryMarker) {
                try { map.removeLayer(deliveryMarker); } catch(e) {}
            }
            
           deliveryMarker = crearMarcadorDelivery({
               id: deliveryId,
               nombre: deliveryNombre,
               lat: ubicacion.lat,
               lng: ubicacion.lng,
               online: true
           });
            
            deliveryMarker.addTo(map);
            
            const estadoActual = pedidoActual?.estado;
            const necesitaRedibujar = !rutaYaDibujada || ultimoEstadoPedido !== estadoActual;
            
            if (pedidoActual) {
                let destinoCoords = null;
                let tipoRuta = null;
                
                if (pedidoActual.estado === 'asignado') {
                    if (pedidoActual.origen_lat && pedidoActual.origen_lng) {
                        destinoCoords = { lat: pedidoActual.origen_lat, lng: pedidoActual.origen_lng };
                        tipoRuta = 'recogida';
                    }
                } else if (pedidoActual.estado === 'recogido') {
                    if (pedidoActual.destino_lat && pedidoActual.destino_lng) {
                        destinoCoords = { lat: pedidoActual.destino_lat, lng: pedidoActual.destino_lng };
                        tipoRuta = 'entrega';
                    }
                }
                
                if (destinoCoords && necesitaRedibujar) {
                    console.log(`🔄 Redibujando ruta (${tipoRuta}) - Estado cambió de ${ultimoEstadoPedido} a ${estadoActual}`);
                    await dibujarRutaDeliveryEnCliente(ubicacion, destinoCoords, tipoRuta);
                    rutaYaDibujada = true;
                    ultimoEstadoPedido = estadoActual;
                    rutaDestinoActual = destinoCoords;
                    
                    const popup = new maplibregl.Popup({ offset: [0, -30] })
                        .setHTML(tipoRuta === 'recogida' 
                            ? `<b>🏍️ ${deliveryNombre}</b><br>🟠 En camino a recoger tu paquete`
                            : `<b>🏍️ ${deliveryNombre}</b><br>📦 En camino a entregar tu paquete`);
                    deliveryMarker.setPopup(popup);
                    
                } else if (destinoCoords && rutaYaDibujada) {
                    if (pedidoActual && pedidoActual.destino_lat && ubicacion) {
                        const destinoFinal = { lat: pedidoActual.destino_lat, lng: pedidoActual.destino_lng };
                        const distanciaADestino = calcularDistanciaEntrePuntos(ubicacion, destinoFinal);
                        const deliveryEstado = document.getElementById("deliveryEstado");
                        if (deliveryEstado) {
                            if (distanciaADestino < 0.5) {
                                deliveryEstado.innerHTML = "🟢 Muy cerca de tu destino 🎯";
                            } else if (distanciaADestino < 1) {
                                deliveryEstado.innerHTML = "🟡 Cerca de tu destino";
                            } else {
                                deliveryEstado.innerHTML = `🔴 A ${distanciaADestino.toFixed(1)} km de tu destino`;
                            }
                        }
                    }
                }
            }
        }
        
        if (supabase && pedidoActual) {
            const { data: pedidoActualizado } = await supabase
                .from('pedidos')
                .select('estado')
                .eq('id', pedidoActual.id)
                .single();
            
            if (pedidoActualizado?.estado === 'completado') {
                console.log("🎉 Pedido completado detectado en seguirUbicacionDelivery");
                
                clearInterval(ubicacionInterval);
                ubicacionInterval = null;
                
                ocultarDeliveryInfo();
                limpiarRutaCliente();
                
                const panel = document.getElementById("panelEstadoPedido");
                const panelMobile = document.getElementById("panelEstadoPedidoMobile");
                if(panel) panel.classList.add("hidden");
                if(panelMobile) panelMobile.classList.add("hidden");
                
                if(deliveryMarker) {
                    map.removeLayer(deliveryMarker);
                    deliveryMarker = null;
                }
                
                rutaYaDibujada = false;
                ultimoEstadoPedido = null;
                rutaDestinoActual = null;
                bloquearUIporPedidoActivo(false);
                pedidoActual = null;
                cargarDeliverysEnLinea();
                
                mostrarToast("🎉 ¡Envío completado! Gracias por usar MandaYa");
            }
        }
    }, 2000);
}

function calcularDistanciaEntrePuntos(punto1, punto2) {
    const R = 6371;
    const dLat = (punto2.lat - punto1.lat) * Math.PI / 180;
    const dLon = (punto2.lng - punto1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(punto1.lat * Math.PI / 180) * Math.cos(punto2.lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function ocultarDeliveryInfo() {
    document.getElementById("deliveryInfo").classList.add("hidden");
    if (deliveryMarker) map.removeLayer(deliveryMarker);
}

// ==================== HISTORIAL Y PERFIL ====================
async function mostrarHistorialCompleto() {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("Error de conexión", true);
        return;
    }
    
    try {
        const { data: misPedidos, error } = await supabase
            .from('pedidos')
            .select('*')
            .eq('cliente_id', currentUser?.id)
            .order('fecha', { ascending: false });
        
        if (error) throw error;
        
        if (!misPedidos || misPedidos.length === 0) {
            mostrarToast("📭 No tienes envíos anteriores");
            return;
        }
        
        let modalExistente = document.getElementById("modalHistorial");
        if (modalExistente) modalExistente.remove();
        
        const modal = document.createElement('div');
        modal.id = "modalHistorial";
        modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10000] p-4";
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-hidden modal-uber">
                <div class="flex justify-between items-center pt-6 pb-3 px-6 border-b border-gray-700">
                    <div>
                        <i class="fas fa-history text-3xl text-orange-500 mb-1 block"></i>
                        <h3 class="text-xl font-bold text-white">Mis Envíos</h3>
                        <p class="text-gray-400 text-xs">Historial completo de tus envíos</p>
                    </div>
                    <button onclick="cerrarModalHistorial()" class="text-gray-400 hover:text-white text-2xl transition-all">
                        <i class="fas fa-times-circle"></i>
                    </button>
                </div>
                
                <div class="overflow-y-auto max-h-[60vh] p-4 space-y-3">
                    ${misPedidos.map(p => `
                        <div class="bg-gray-700 rounded-xl p-4 ${p.estado === 'completado' ? 'border-l-4 border-green-500' : p.estado === 'pendiente' ? 'border-l-4 border-yellow-500' : 'border-l-4 border-blue-500'}">
                            <div class="flex justify-between items-start mb-2">
                                <div>
                                    <span class="font-bold text-orange-400">#${p.id}</span>
                                    <span class="text-xs ml-2 px-2 py-0.5 rounded-full ${p.estado === 'completado' ? 'bg-green-500/20 text-green-400' : p.estado === 'pendiente' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}">
                                        ${p.estado === 'completado' ? '✅ Completado' : p.estado === 'pendiente' ? '⏳ Pendiente' : '🚚 En camino'}
                                    </span>
                                </div>
                                <span class="text-xs text-gray-400">${new Date(p.fecha).toLocaleDateString()}</span>
                            </div>
                            <p class="text-sm text-gray-300">
                                <i class="fas fa-circle text-orange-500 text-xs mr-1"></i> ${p.origen}
                            </p>
                            <p class="text-sm text-gray-300 mt-1">
                                <i class="fas fa-square text-blue-500 text-xs mr-1"></i> ${p.destino}
                            </p>
                            <div class="flex justify-between items-center mt-3 pt-2 border-t border-gray-600">
                                <div class="text-sm">
                                    <span class="text-gray-400">📏 ${p.distancia_real} km</span>
                                    <span class="text-gray-400 ml-3">💰 $${p.tarifa}</span>
                                </div>
                                <button onclick="eliminarEnvio(${p.id})" class="bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white px-3 py-1 rounded-lg text-sm transition-all">
                                    <i class="fas fa-trash-alt mr-1"></i> Eliminar
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <div class="border-t border-gray-700 p-4">
                    <div class="flex justify-between text-sm text-gray-400">
                        <span>Total: ${misPedidos.length}</span>
                        <span>✅ Completados: ${misPedidos.filter(p => p.estado === 'completado').length}</span>
                        <span>⏳ Pendientes: ${misPedidos.filter(p => p.estado === 'pendiente').length}</span>
                        <span>🚚 En camino: ${misPedidos.filter(p => p.estado === 'asignado').length}</span>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    } catch(e) {
        console.error('Error cargando historial:', e);
        mostrarToast("Error al cargar historial", true);
    }
}

function cerrarModalHistorial() {
    const modal = document.getElementById("modalHistorial");
    if (modal) modal.remove();
}

async function eliminarEnvio(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("Error de conexión", true);
        return;
    }
    
    const { data: pedido } = await supabase
        .from('pedidos')
        .select('*')
        .eq('id', pedidoId)
        .single();
    
    if (!pedido) {
        mostrarToast("Envío no encontrado", true);
        return;
    }
    
    let mensaje = "";
    if (pedido.estado === 'completado') {
        mensaje = "Este envío ya está completado. ¿Seguro que quieres eliminarlo del historial?";
    } else if (pedido.estado === 'asignado') {
        mensaje = "⚠️ Este envío está en camino. Si lo eliminas, el delivery ya no lo verá. ¿Estás seguro?";
    } else {
        mensaje = "¿Estás seguro de que quieres eliminar este envío? Esta acción no se puede deshacer.";
    }
    
    mostrarModalConfirmacion(
        "Eliminar envío",
        mensaje,
        async () => {
            try {
                const { error } = await supabase
                    .from('pedidos')
                    .delete()
                    .eq('id', pedidoId);
                
                if (error) throw error;
                
                mostrarToast(`🗑️ Envío #${pedidoId} eliminado correctamente`);
                
                if (document.getElementById("modalHistorial")) {
                    mostrarHistorialCompleto();
                }
            } catch(e) {
                console.error('Error eliminando:', e);
                mostrarToast("Error al eliminar el envío", true);
            }
        }
    );
}

function mostrarModalConfirmacion(titulo, mensaje, onConfirm) {
    let modalExistente = document.getElementById("modalConfirmacion");
    if (modalExistente) modalExistente.remove();
    
    const modal = document.createElement('div');
    modal.id = "modalConfirmacion";
    modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10000] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-3xl max-w-sm w-full modal-uber text-center p-6">
            <div class="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-exclamation-triangle text-3xl text-red-500"></i>
            </div>
            <h3 class="text-xl font-bold text-white mb-2">${titulo}</h3>
            <p class="text-gray-400 text-sm mb-6">${mensaje}</p>
            <div class="flex gap-3">
                <button onclick="cerrarModalConfirmacion()" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-xl transition-all">
                    Cancelar
                </button>
                <button id="confirmarBtn" class="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-xl transition-all">
                    Eliminar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    document.getElementById("confirmarBtn").onclick = () => {
        cerrarModalConfirmacion();
        if (onConfirm) onConfirm();
    };
}

function cerrarModalConfirmacion() {
    const modal = document.getElementById("modalConfirmacion");
    if (modal) modal.remove();
}

function verHistorial() { mostrarHistorialCompleto();}

function verPerfil() {
    const modalExistente = document.getElementById("modalPerfil");
    if (modalExistente) modalExistente.remove();
    
    const modal = document.createElement('div');
    modal.id = "modalPerfil";
    modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10001] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-3xl max-w-sm w-full modal-uber">
            <div class="text-center pt-6 pb-3 border-b border-gray-700">
                <div class="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-3">
                    <i class="fas fa-user-circle text-white text-3xl"></i>
                </div>
                <h2 class="text-xl font-bold text-white">Mi Perfil</h2>
                <p class="text-gray-400 text-sm mt-1">Datos de tu cuenta</p>
            </div>
            
            <div class="p-5 space-y-3">
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-user text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Nombre</div>
                        <div class="text-white font-medium">${currentUser?.nombre || 'No disponible'}</div>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-envelope text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Correo electrónico</div>
                        <div class="text-white font-medium">${currentUser?.email || 'No disponible'}</div>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-tag text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Rol</div>
                        <div class="text-white font-medium">
                            <span class="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full text-xs">Cliente</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="px-5 pb-5">
                <button onclick="cerrarModalPerfil()" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all">
                    Cerrar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function cerrarModalPerfil() {
    const modal = document.getElementById("modalPerfil");
    if (modal) modal.remove();
}

async function mostrarDeliveryEnMapa(deliveryId, deliveryNombre = null) {
    const supabase = supabaseClient;
    if (!supabase) return;
    
    try {
        let nombreDelivery = deliveryNombre;
        
        if (!nombreDelivery) {
            const { data: delivery, error } = await supabase
                .from('usuarios')
                .select('nombre')
                .eq('id', deliveryId)
                .single();
            
            if (!error && delivery) {
                nombreDelivery = delivery.nombre;
            }
        }
        
        if (nombreDelivery) {
            const deliveryInfo = document.getElementById("deliveryInfo");
            const deliveryNombreEl = document.getElementById("deliveryNombre");
            
            if (deliveryInfo) deliveryInfo.classList.remove("hidden");
            if (deliveryNombreEl) deliveryNombreEl.innerHTML = `<i class="fas fa-motorcycle"></i> ${nombreDelivery}`;
            
            limpiarRutaCliente();
            
            if (pedidoActual) {
                if (!pedidoActual.destinoCoords && pedidoActual.destino_lat) {
                    pedidoActual.destinoCoords = {
                        lat: pedidoActual.destino_lat,
                        lng: pedidoActual.destino_lng
                    };
                }
                if (!pedidoActual.origenCoords && pedidoActual.origen_lat) {
                    pedidoActual.origenCoords = {
                        lat: pedidoActual.origen_lat,
                        lng: pedidoActual.origen_lng
                    };
                }
            }
        }
    } catch(e) {
        console.error('Error mostrando delivery:', e);
    }
}

function cerrarSesion() { 
    mostrarModalConfirmacion(
        "Cerrar Sesión",
        "¿Estás seguro de que deseas cerrar sesión?",
        () => {
            // ✅ Limpiar intervalos de seguimiento
            if (seguimientoInterval) { 
                clearInterval(seguimientoInterval); 
                seguimientoInterval = null;
            }
            
            // ✅ Limpiar intervalo de ubicación
            if (ubicacionInterval) { 
                clearInterval(ubicacionInterval); 
                ubicacionInterval = null;
            }
            
            // ✅ Limpiar intervalo de deliverys
            if (deliverysInterval) { 
                clearInterval(deliverysInterval); 
                deliverysInterval = null;
            }
            
            // ✅ Limpiar marcadores de deliverys - USANDO window.deliveryMarkers
            if (window.deliveryMarkers && window.deliveryMarkers.length > 0) {
                window.deliveryMarkers.forEach(marker => {
                    if (marker && marker.remove) {
                        try {
                            marker.remove();
                        } catch(e) {
                            console.warn("Error eliminando marcador:", e);
                        }
                    }
                });
                window.deliveryMarkers = [];
            }
            
            // ✅ Limpiar marcador de delivery individual (cuando hay pedido activo)
            if (deliveryMarker) {
                try {
                    if (typeof deliveryMarker.remove === 'function') {
                        deliveryMarker.remove();
                    } else if (deliveryMarker && map) {
                        deliveryMarker.remove();
                    }
                } catch(e) {}
                deliveryMarker = null;
            }
            
            // ✅ Limpiar marcador de origen
            if (originMarker) {
                try {
                    originMarker.remove();
                } catch(e) {}
                originMarker = null;
            }
            
            // ✅ Limpiar marcador de destino
            if (destMarker) {
                try {
                    destMarker.remove();
                } catch(e) {}
                destMarker = null;
            }
            
            // ✅ Limpiar ruta
            if (currentRouteLayerId && map) {
                try {
                    if (map.getLayer(currentRouteLayerId)) {
                        map.removeLayer(currentRouteLayerId);
                    }
                    if (map.getSource(currentRouteLayerId)) {
                        map.removeSource(currentRouteLayerId);
                    }
                } catch(e) {}
            }
            
            // ✅ Limpiar cualquier otra capa de ruta
            limpiarRutaCliente();
            
            // ✅ Opcional: Actualizar estado online en Supabase (si el cliente estaba online)
            if (currentUser && currentUser.online && supabaseClient) {
                supabaseClient
                    .from('usuarios')
                    .update({ online: false })
                    .eq('id', currentUser.id)
                    .catch(e => console.warn("Error actualizando estado online:", e));
            }
            
            // ✅ Limpiar localStorage y redirigir
            localStorage.removeItem('sesion_activa'); 
            window.location.href = "index.html";
        }
    );
}

function mostrarToast(msg, err = false) {
    const toastsAnteriores = document.querySelectorAll('.toast-moderno');
    toastsAnteriores.forEach(toast => toast.remove());
    
    const toast = document.createElement('div');
    toast.className = 'toast-moderno';
    
    const isMobile = window.innerWidth < 768;
    const paddingY = isMobile ? '12px' : '14px';
    const paddingX = isMobile ? '20px' : '28px';
    const fontSize = isMobile ? '13px' : '14px';
    
    let icono = err ? 'fa-exclamation-triangle' : 'fa-check-circle';
    let colorFondo = err 
        ? 'linear-gradient(135deg, #dc2626, #b91c1c)' 
        : 'linear-gradient(135deg, #10b981, #059669)';
    
    if (msg.includes('📍')) icono = 'fa-location-dot';
    else if (msg.includes('🏁')) icono = 'fa-flag-checkered';
    else if (msg.includes('💰') || msg.includes('$')) icono = 'fa-money-bill-wave';
    else if (msg.includes('🚚') || msg.includes('delivery')) icono = 'fa-motorcycle';
    else if (msg.includes('✅')) icono = 'fa-circle-check';
    else if (msg.includes('❌')) icono = 'fa-circle-exclamation';
    
    toast.style.cssText = `
        position: fixed;
        bottom: ${isMobile ? '80px' : '20px'};
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: ${colorFondo};
        color: white;
        padding: ${paddingY} ${paddingX};
        border-radius: ${isMobile ? '30px' : '50px'};
        font-size: ${fontSize};
        font-weight: 500;
        z-index: 100000;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2), 0 8px 10px -6px rgba(0,0,0,0.1);
        display: flex;
        align-items: center;
        gap: 10px;
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        backdrop-filter: blur(4px);
        border: 1px solid rgba(255,255,255,0.2);
        max-width: ${isMobile ? '85%' : 'auto'};
        white-space: ${isMobile ? 'normal' : 'nowrap'};
        text-align: center;
        line-height: 1.4;
        word-break: break-word;
    `;
    
    toast.innerHTML = `
        <i class="fas ${icono}" style="font-size: ${isMobile ? '16px' : '18px'}; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.2));"></i>
        <span>${msg}</span>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toast.style.opacity = '1';
    }, 10);
    
    const duracion = err ? 3500 : (msg.length > 50 ? 3500 : 2500);
    
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, duracion);
}

// CORREGIR en cliente.js
function mostrarResumenRuta() {
    if (!originCoords || !destCoords) {
        mostrarToast("❌ Selecciona origen y destino primero", true);
        return;
    }
    
    const distancia = currentRouteData ? currentRouteData.distance : calcularDistancia();
    const tipo = document.getElementById("tipoEnvio")?.value || 'paquete';
    const rate = calculateShippingRate(distancia, tipo);
    const duracion = currentRouteData ? currentRouteData.duration : (distancia * 2);
    
    mostrarToast("📏 Calculando ruta real...");
    
    getRealDistanceAndTime(originCoords, destCoords).then(routeData => {
        const distanciaKm = routeData ? routeData.distanceKm : distancia.toFixed(2);
        const duracionTexto = routeData ? routeData.durationText : formatDuration(duracion);
        
        mostrarModalResumen(
            distanciaKm,
            duracionTexto,
            rate.total,
            tipo
        );
    }).catch(() => {
        mostrarModalResumen(
            distancia.toFixed(2),
            formatDuration(duracion),
            rate.total,
            tipo
        );
    });
}

function mostrarModalResumen(distancia, tiempo, tarifaBase, tipo) {
    const modalExistente = document.getElementById("modalResumenRuta");
    if (modalExistente) modalExistente.remove();
    
    tarifaBaseSinExtras = tarifaBase;
    
    const extrasGuardados = currentRouteData?.extras || { 
        lluvia: false, 
        noche: false, 
        espera: false 
    };
    
    let totalInicial = tarifaBase;
    if (extrasGuardados.lluvia) totalInicial += 10;
    if (extrasGuardados.noche) totalInicial += 10;
    if (extrasGuardados.espera) totalInicial += 10;
    
    const modal = document.createElement('div');
    modal.id = "modalResumenRuta";
    modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10001] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl max-w-sm w-full modal-uber">
            <div class="text-center pt-4 pb-2 border-b border-gray-700">
                <div class="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-2">
                    <i class="fas fa-route text-white text-xl"></i>
                </div>
                <h2 class="text-lg font-bold text-white">Resumen de Ruta</h2>
                <p class="text-gray-400 text-xs mt-1">Detalles de tu envío</p>
            </div>
            
            <div class="p-3 space-y-2">
                <div class="bg-gray-700 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-gray-400 text-xs">📍 Distancia real</span>
                    <span class="text-white font-bold text-sm">${distancia} km</span>
                </div>
                <div class="bg-gray-700 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-gray-400 text-xs">⏱️ Tiempo estimado</span>
                    <span class="text-white font-bold text-sm">${tiempo}</span>
                </div>
                <div class="bg-gray-700 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-gray-400 text-xs">📦 Tipo de envío</span>
                    <span class="text-white font-bold text-sm capitalize">${tipo}</span>
                </div>
                
                <div class="bg-gray-700 rounded-lg p-2">
                    <div class="text-gray-400 text-xs mb-2 flex items-center gap-1">
                        <i class="fas fa-plus-circle text-orange-500 text-xs"></i>
                        Extras (+$10 c/u)
                    </div>
                    
                    <div class="flex flex-wrap gap-2 justify-center">
                        <div class="flex flex-col items-center bg-gray-600 rounded-lg p-2 w-16 cursor-pointer hover:bg-gray-500 transition-all" onclick="toggleExtraEnResumen('lluvia')">
                            <i class="fas fa-cloud-rain text-blue-400 text-lg mb-0.5"></i>
                            <span class="text-white text-xs">Lluvia</span>
                            <span class="text-orange-400 text-xs">+$10</span>
                            <div id="checkLluviaResumen" class="mt-1 w-4 h-4 rounded-full border-2 ${extrasGuardados.lluvia ? 'bg-orange-500 border-orange-500' : 'border-gray-400'} flex items-center justify-center">
                                ${extrasGuardados.lluvia ? '<i class="fas fa-check text-white text-[8px]"></i>' : ''}
                            </div>
                        </div>
                        
                        <div class="flex flex-col items-center bg-gray-600 rounded-lg p-2 w-16 cursor-pointer hover:bg-gray-500 transition-all" onclick="toggleExtraEnResumen('noche')">
                            <i class="fas fa-moon text-yellow-400 text-lg mb-0.5"></i>
                            <span class="text-white text-xs">Noche</span>
                            <span class="text-orange-400 text-xs">+$10</span>
                            <div id="checkNocheResumen" class="mt-1 w-4 h-4 rounded-full border-2 ${extrasGuardados.noche ? 'bg-orange-500 border-orange-500' : 'border-gray-400'} flex items-center justify-center">
                                ${extrasGuardados.noche ? '<i class="fas fa-check text-white text-[8px]"></i>' : ''}
                            </div>
                        </div>
                        
                        <div class="flex flex-col items-center bg-gray-600 rounded-lg p-2 w-16 cursor-pointer hover:bg-gray-500 transition-all" onclick="toggleExtraEnResumen('espera')">
                            <i class="fas fa-clock text-purple-400 text-lg mb-0.5"></i>
                            <span class="text-white text-xs">Espera</span>
                            <span class="text-orange-400 text-xs">+$10</span>
                            <div id="checkEsperaResumen" class="mt-1 w-4 h-4 rounded-full border-2 ${extrasGuardados.espera ? 'bg-orange-500 border-orange-500' : 'border-gray-400'} flex items-center justify-center">
                                ${extrasGuardados.espera ? '<i class="fas fa-check text-white text-[8px]"></i>' : ''}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="bg-orange-500 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-white font-bold text-sm">💰 Total</span>
                    <span class="text-white font-bold text-lg" id="totalConExtrasResumen">$${totalInicial} MXN</span>
                </div>
                
                <div class="text-center text-[10px] text-gray-400">
                    <i class="fas fa-info-circle text-[8px]"></i> Los extras se pagan al delivery
                </div>
            </div>
            
            <div class="px-3 pb-3 flex gap-2">
                <button onclick="cerrarModalResumen()" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 rounded-lg text-sm transition-all">Cancelar</button>
                <button id="btnAceptarExtrasResumen" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 rounded-lg text-sm transition-all">✅ Aceptar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    window.extrasTemporales = { ...extrasGuardados };
    window.tarifaBaseActual = tarifaBase;
    
    document.getElementById("btnAceptarExtrasResumen").onclick = () => {
        confirmarExtrasDesdeResumen();
    };
}

function toggleExtraEnResumen(extra) {
    if (!window.extrasTemporales) {
        window.extrasTemporales = { lluvia: false, noche: false, espera: false };
    }
    window.extrasTemporales[extra] = !window.extrasTemporales[extra];
    
    const checkDiv = document.getElementById(`check${extra.charAt(0).toUpperCase() + extra.slice(1)}Resumen`);
    if (checkDiv) {
        if (window.extrasTemporales[extra]) {
            checkDiv.classList.remove('border-gray-400');
            checkDiv.classList.add('bg-orange-500', 'border-orange-500');
            checkDiv.innerHTML = '<i class="fas fa-check text-white text-[8px]"></i>';
        } else {
            checkDiv.classList.remove('bg-orange-500', 'border-orange-500');
            checkDiv.classList.add('border-gray-400');
            checkDiv.innerHTML = '';
        }
    }
    
    let total = window.tarifaBaseActual;
    if (window.extrasTemporales.lluvia) total += 10;
    if (window.extrasTemporales.noche) total += 10;
    if (window.extrasTemporales.espera) total += 10;
    
    const totalSpan = document.getElementById("totalConExtrasResumen");
    if (totalSpan) {
        totalSpan.innerHTML = `$${total} MXN`;
        totalSpan.style.transform = 'scale(1.05)';
        setTimeout(() => {
            totalSpan.style.transform = 'scale(1)';
        }, 150);
    }
    
    const card = document.querySelector(`[onclick="toggleExtraEnResumen('${extra}')"]`);
    if (card) {
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
            card.style.transform = 'scale(1)';
        }, 150);
    }
}

function actualizarTotalConExtras() {
    const checkLluvia = document.getElementById("checkLluviaExtras");
    const checkNoche = document.getElementById("checkNocheExtras");
    const checkEspera = document.getElementById("checkEsperaExtras");
    
    if (!checkLluvia || !checkNoche || !checkEspera) {
        return;
    }
    
    let total = tarifaBaseSinExtras;
    
    if (checkLluvia.checked) total += 10;
    if (checkNoche.checked) total += 10;
    if (checkEspera.checked) total += 10;
    
    const totalSpan = document.getElementById("totalConExtras");
    if (totalSpan) {
        totalSpan.innerHTML = `$${total} MXN`;
        totalSpan.style.transform = 'scale(1.05)';
        setTimeout(() => {
            totalSpan.style.transform = 'scale(1)';
        }, 150);
    }
    
    return total;
}

function toggleExtraSeleccion(extra) {
    const estadoActual = window.extrasTemporales ? window.extrasTemporales[extra] : false;
    
    if (!window.extrasTemporales) window.extrasTemporales = { lluvia: false, noche: false, espera: false };
    window.extrasTemporales[extra] = !estadoActual;
    
    const checkDiv = document.getElementById(`check${extra.charAt(0).toUpperCase() + extra.slice(1)}Resumen`);
    if (checkDiv) {
        if (window.extrasTemporales[extra]) {
            checkDiv.classList.remove('border-gray-400');
            checkDiv.classList.add('bg-orange-500', 'border-orange-500');
            checkDiv.innerHTML = '<i class="fas fa-check text-white text-xs"></i>';
        } else {
            checkDiv.classList.remove('bg-orange-500', 'border-orange-500');
            checkDiv.classList.add('border-gray-400');
            checkDiv.innerHTML = '';
        }
    }
    
    const card = document.querySelector(`.extra-card[data-extra="${extra}"]`);
    if (card) {
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
            card.style.transform = 'scale(1)';
        }, 150);
    }
}

function confirmarExtrasDesdeResumen() {
    console.log("✅ Confirmando extras...");
    
    const lluviaSeleccionada = window.extrasTemporales?.lluvia || false;
    const nocheSeleccionada = window.extrasTemporales?.noche || false;
    const esperaSeleccionada = window.extrasTemporales?.espera || false;
    
    extrasSeleccionados = {
        lluvia: lluviaSeleccionada,
        noche: nocheSeleccionada,
        espera: esperaSeleccionada
    };
    
    let totalFinal = tarifaBaseSinExtras;
    const extrasAplicados = [];
    
    if (extrasSeleccionados.lluvia) {
        totalFinal += 10;
        extrasAplicados.push("🌧️ Lluvia");
    }
    if (extrasSeleccionados.noche) {
        totalFinal += 10;
        extrasAplicados.push("🌙 Noche");
    }
    if (extrasSeleccionados.espera) {
        totalFinal += 10;
        extrasAplicados.push("⏱️ Espera");
    }
    
    if (currentRouteData) {
        currentRouteData.extras = { ...extrasSeleccionados };
        currentRouteData.totalConExtras = totalFinal;
    }
    
    const tarifaElement = document.getElementById("tarifaValue");
    if (tarifaElement) {
        tarifaElement.innerHTML = `$${totalFinal} MXN`;
    }
    
    const tarifaElementMobile = document.getElementById("tarifaValueMobile");
    if (tarifaElementMobile) {
        tarifaElementMobile.innerHTML = `$${totalFinal} MXN`;
    }
    
    if (pedidoPendiente) {
        pedidoPendiente.tarifa = totalFinal;
        pedidoPendiente.extras = { ...extrasSeleccionados };
    }
    
    if (extrasAplicados.length > 0) {
        mostrarToast(`✅ Extras: ${extrasAplicados.join(", ")} (+$${extrasAplicados.length * 10}) - Total: $${totalFinal}`);
    } else {
        mostrarToast(`✅ Total: $${totalFinal} MXN`);
    }
    cerrarModalResumen();  
}

function confirmarExtrasYPagar() { 
    console.log("🔍 Confirmando extras y procediendo al pago...");
    
    const checkLluvia = document.getElementById("checkLluviaExtras");
    const checkNoche = document.getElementById("checkNocheExtras");
    const checkEspera = document.getElementById("checkEsperaExtras");
    
    if (!checkLluvia || !checkNoche || !checkEspera) {
        console.error("❌ No se encontraron los checkboxes de extras");
        cerrarModalResumen();
        mostrarToast("❌ Error al leer los extras, intenta de nuevo", true);
        return;
    }
    
    const lluviaSeleccionada = checkLluvia.checked;
    const nocheSeleccionada = checkNoche.checked;
    const esperaSeleccionada = checkEspera.checked;
    
    extrasSeleccionados = {
        lluvia: lluviaSeleccionada,
        noche: nocheSeleccionada,
        espera: esperaSeleccionada
    };
    
    let totalConExtras = tarifaBaseSinExtras;
    const extrasAplicados = [];
    
    if (extrasSeleccionados.lluvia) {
        totalConExtras += 10;
        extrasAplicados.push("🌧️ Lluvia");
    }
    if (extrasSeleccionados.noche) {
        totalConExtras += 10;
        extrasAplicados.push("🌙 Noche");
    }
    if (extrasSeleccionados.espera) {
        totalConExtras += 10;
        extrasAplicados.push("⏱️ Espera");
    }
    
    console.log("📊 Resumen de tarifa:", {
        base: tarifaBaseSinExtras,
        extras: extrasSeleccionados,
        total: totalConExtras,
        extrasAplicados: extrasAplicados
    });
    
    if (currentRouteData) {
        currentRouteData.extras = { ...extrasSeleccionados };
        currentRouteData.totalConExtras = totalConExtras;
    }
    
    const tarifaElement = document.getElementById("tarifaValue");
    if (tarifaElement) {
        tarifaElement.innerHTML = `$${totalConExtras} MXN`;
    }
    
    const tarifaElementMobile = document.getElementById("tarifaValueMobile");
    if (tarifaElementMobile) {
        tarifaElementMobile.innerHTML = `$${totalConExtras} MXN`;
    }
    
    if (pedidoPendiente) {
        pedidoPendiente.tarifa = totalConExtras;
        pedidoPendiente.extras = { ...extrasSeleccionados };
    }
    
    if (extrasAplicados.length > 0) {
        mostrarToast(`✅ Extras: ${extrasAplicados.join(", ")} (+$${extrasAplicados.length * 10}) - Total: $${totalConExtras}`);
    } else {
        mostrarToast(`✅ Total: $${totalConExtras} MXN`);
    }
    
    cerrarModalResumen();
    
    const modalPago = document.getElementById("modalPago");
    if (modalPago) {
        modalPago.classList.remove("hidden");
        modalPago.classList.add("flex");
    } else {
        console.error("❌ No se encontró el modal de pago");
        mostrarToast("❌ Error al abrir el método de pago", true);
    }
}

function cerrarModalResumen() {
    const modal = document.getElementById("modalResumenRuta");
    if (modal) modal.remove();
}

// ==================== BÚSQUEDA DE DIRECCIONES ====================
let busquedaTimeout = null;

async function buscarDirecciones(query, tipo) {
    if (!query || query.length < 3) {
        document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
        return;
    }
    
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Ciudad del Carmen, Campeche')}&limit=5&addressdetails=1`);
        const data = await response.json();
        
        const sugerenciasDiv = document.getElementById(`${tipo}Sugerencias`);
        
        if (data.length === 0) {
            sugerenciasDiv.classList.add('hidden');
            return;
        }
        
        sugerenciasDiv.innerHTML = data.map(lugar => `
            <div class="sugerencia-item p-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 flex items-start gap-2" 
                 onclick="seleccionarDireccion('${tipo}', ${lugar.lat}, ${lugar.lon}, '${lugar.display_name.replace(/'/g, "\\'")}')">
                <i class="fas fa-map-marker-alt text-gray-400 mt-0.5 text-xs"></i>
                <div class="flex-1">
                    <div class="text-sm font-medium text-gray-800">${lugar.display_name.split(',')[0]}</div>
                    <div class="text-xs text-gray-500">${lugar.display_name.split(',').slice(1, 3).join(',')}</div>
                </div>
            </div>
        `).join('');
        
        sugerenciasDiv.classList.remove('hidden');
        
    } catch(e) {
        console.error('Error buscando direcciones:', e);
    }
}

function seleccionarDireccion(tipo, lat, lng, direccion) {
    const coords = { lat: parseFloat(lat), lng: parseFloat(lng) };
    
    if (coords.lat < 18.58 || coords.lat > 18.70 || coords.lng < -91.88 || coords.lng > -91.75) {
        mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
        document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
        return;
    }
    
    if (tipo === 'origen') {
        if (originMarker) {
            originMarker.setLngLat([coords.lng, coords.lat]);
        }
        originCoords = coords;
        document.getElementById("origen").value = direccion.split(',')[0];
    } else {
        if (destMarker) {
            destMarker.setLngLat([coords.lng, coords.lat]);
        }
        destCoords = coords;
        document.getElementById("destino").value = direccion.split(',')[0];
    }
    
    document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
    actualizarRutaYTarifa();
    mostrarToast(`📍 ${tipo === 'origen' ? 'Origen' : 'Destino'} actualizado`);
}

// ==================== VER DELIVERYS EN LÍNEA ====================
async function cargarDeliverysEnLinea() {
    // ✅ Esperar a que el mapa esté listo
    if (!map || !map.loaded()) {
        console.log("⏳ Mapa no listo, esperando...");
        setTimeout(() => cargarDeliverysEnLinea(), 1000);
        return;
    }
    
    if (!paginaVisible) {
        console.log("📴 Página oculta, omitiendo carga de deliverys");
        return;
    }
    
    // Throttling
    const ahora = Date.now();
    if (ahora - ultimaPeticionDeliverys < 5000) {
        console.log("⏳ Throttling: cargarDeliverysEnLinea - muy rápido, espera");
        return;
    }
    ultimaPeticionDeliverys = ahora;
    
    const supabase = supabaseClient;
    if (!supabase) {
        console.error('Supabase no disponible');
        return;
    }
    
    try {
        // Obtener deliverys en línea desde la tabla 'ubicaciones'
        const { data: deliverys, error } = await supabase
            .from('ubicaciones')
            .select('*')
            .eq('online', true)
            .order('updated_at', { ascending: false });
        
        if (error) throw error;
        
        console.log(`📍 ${deliverys?.length || 0} deliverys en línea`);
        
        // ✅ Limpiar marcadores anteriores - Usar array local O global consistente
        // Opción 1: Usar array global (si declaraste window.deliveryMarkers = [] al inicio)
        if (map && window.deliveryMarkers) {
            window.deliveryMarkers.forEach(marker => {
                if (marker && marker.remove) {
                    try {
                        marker.remove();
                    } catch(e) {
                        console.warn("Error eliminando marcador:", e);
                    }
                }
            });
            window.deliveryMarkers = [];
        }
        
        // Opción 2: Usar array local (recomendado si declaraste deliverysMarkers)
        // if (map && deliverysMarkers) {
        //     deliverysMarkers.forEach(marker => {
        //         if (marker && marker.remove) marker.remove();
        //     });
        //     deliverysMarkers = [];
        // }
        
        if (!deliverys || deliverys.length === 0) {
            console.log("📭 No hay deliverys en línea");
            return;
        }
        
        // ✅ Crear nuevos marcadores
        for (const delivery of deliverys) {
            // Verificar coordenadas válidas
            if (delivery.lat && delivery.lng && 
                typeof delivery.lat === 'number' && 
                typeof delivery.lng === 'number') {
                
                const marker = crearMarcadorDelivery({
                    id: delivery.delivery_id,
                    nombre: delivery.delivery_nombre,
                    lat: delivery.lat,
                    lng: delivery.lng,
                    online: delivery.online
                });
                
                if (marker) {
                    // Usar el mismo array que limpiaste arriba
                    window.deliveryMarkers.push(marker);
                    // O si usas local: deliverysMarkers.push(marker);
                }
            }
        }
        
        console.log(`✅ ${window.deliveryMarkers.length} marcadores de delivery creados`);
        
    } catch(e) {
        console.error("❌ Error cargando deliverys en línea:", e);
    }
}


async function tienePedidoActivo(deliveryId) {
    const supabase = supabaseClient;
    if (!supabase) return false;
    
    try {
        const { data, error } = await supabase
            .from('pedidos')
            .select('id')
            .eq('delivery_id', deliveryId)
            .in('estado', ['asignado', 'recogido'])
            .limit(1);
        
        if (error) throw error;
        return data && data.length > 0;
    } catch(e) {
        console.error('Error verificando pedido activo:', e);
        return false;
    }
}

// ==================== LIMPIAR RECURSOS AL CERRAR PESTAÑA ====================
function limpiarTodosLosIntervalos() {
    console.log("🧹 Limpiando intervalos y recursos...");
    
    if (seguimientoInterval) {
        clearInterval(seguimientoInterval);
        seguimientoInterval = null;
        console.log("✅ seguimientoInterval limpiado");
    }
    
    if (ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
        console.log("✅ ubicacionInterval limpiado");
    }
    
    if (deliverysInterval) {
        clearInterval(deliverysInterval);
        deliverysInterval = null;
        console.log("✅ deliverysInterval limpiado");
    }
    
    if (busquedaTimeout) {
        clearTimeout(busquedaTimeout);
        busquedaTimeout = null;
    }
    
    if (clienteRouteControl) {
        try {
            if (clienteRouteControl._map) {
                map.removeControl(clienteRouteControl);
            }
        } catch(e) {}
        clienteRouteControl = null;
    }
    
    if (deliveryMarker) {
        try { map.removeLayer(deliveryMarker); } catch(e) {}
        deliveryMarker = null;
    }
    
    console.log("✅ Todos los recursos liberados");
}

const originalCerrarSesionCliente = window.cerrarSesion;
window.cerrarSesion = function() {
    limpiarTodosLosIntervalos();
    if (originalCerrarSesionCliente) {
        originalCerrarSesionCliente();
    }
};

window.addEventListener('beforeunload', function() {
    console.log("🚪 Pestaña cerrando - Limpiando recursos...");
    limpiarTodosLosIntervalos();
});

window.addEventListener('unload', function() {
    console.log("💀 Página descargada - Recursos liberados");
    if (currentUser && currentUser.rol === 'cliente' && supabaseClient) {
        console.log("👋 Cliente desconectado");
    }
});

document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log("📱 Pestaña oculta - Reduciendo actividad");
    } else {
        console.log("🟢 Pestaña visible - Reanudando actividad normal");
    }
});

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', () => {
    const origenInput = document.getElementById('origen');
    const destinoInput = document.getElementById('destino');
    const btnCancelarPedido = document.getElementById('btnCancelarPedido');
    
    if (btnCancelarPedido) {
        btnCancelarPedido.addEventListener('click', cancelarPedido);
    }
    
    if (origenInput) {
        origenInput.addEventListener('input', (e) => {
            if (busquedaTimeout) clearTimeout(busquedaTimeout);
            busquedaTimeout = setTimeout(() => {
                buscarDirecciones(e.target.value, 'origen');
            }, 500);
        });
        
        origenInput.addEventListener('blur', () => {
            setTimeout(() => {
                document.getElementById('origenSugerencias')?.classList.add('hidden');
            }, 200);
        });
    }
    
    if (destinoInput) {
        destinoInput.addEventListener('input', (e) => {
            if (busquedaTimeout) clearTimeout(busquedaTimeout);
            busquedaTimeout = setTimeout(() => {
                buscarDirecciones(e.target.value, 'destino');
            }, 500);
        });
        
        destinoInput.addEventListener('blur', () => {
            setTimeout(() => {
                document.getElementById('destinoSugerencias')?.classList.add('hidden');
            }, 200);
        });
    }
});

window.onload = () => { 
    loadUser(); 
    initMap();
    if (currentUser && currentUser.rol === 'cliente') {
        setTimeout(() => cargarDeliverysEnLinea(), 2000);
        
        if (deliverysInterval) clearInterval(deliverysInterval);
        
        deliverysInterval = setInterval(() => {
            if (currentUser && currentUser.rol === 'cliente') {
                cargarDeliverysEnLinea();
            }
        }, 15000);
    }
};