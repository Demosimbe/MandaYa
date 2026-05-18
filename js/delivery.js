// delivery.js - Al principio
import './shared.js';
import './security.js';
import './config.js';
import './map-utils.js'; 

// ==================== PRECARGAR SONIDO DE NOTIFICACIÓN ====================
const audioNotificacion = new Audio('/sounds/notification.mp3');
audioNotificacion.load(); // Precargar el sonido

// Constantes y variables globales
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

let map, userMarker, routeLine;
let currentUser = null, isOnline = false;
let pedidosDisponibles = [], misPedidosActivos = [];
let pedidoSeleccionado = null;
let watchId = null;
let ubicacionInterval = null;
let cargaPedidosInterval = null;
let ultimaUbicacionEnviada = null;

// Variables para rutas
let currentRoutingControl = null;
let recogidaMarker = null;
let destinoMarker = null;
let ultimoPedidoDibujado = null;
let ultimaEtapa = null;
let dibujandoRuta = false;
let ultimaPeticionPedidos = 0;

// Control de página visible
let paginaVisible = true;
// ==================== ROTACIÓN DEL MAPA ====================
let mapRotationAngle = 0;   // ← Mover aquí arriba

// ==================== UTILIDADES ====================
function vibrar(duracion = 200) {
    if (window.navigator.vibrate) {
        window.navigator.vibrate(duracion);
    }
}

// ==================== NOTIFICACIÓN DE NUEVO PEDIDO ====================
function notificarNuevoPedido() {
    // ✅ Vibrar si el dispositivo lo soporta
    if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate([300, 100, 300, 100, 300]);
        console.log("📳 Vibración activada");
    }
    
    // ✅ Reproducir sonido MP3
    try {
        const audio = new Audio('/sounds/notification.mp3');
        audio.volume = 0.8; // Ajusta el volumen (0.0 a 1.0)
        audio.play().catch(e => console.log("Error reproduciendo sonido:", e));
        console.log("🔔 Sonido de notificación reproducido");
    } catch(e) {
        console.log("Error al reproducir sonido MP3:", e);
        
        // Fallback: sonido con Web Audio API si el MP3 falla
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 880;
            gainNode.gain.value = 0.5;
            
            oscillator.start();
            gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5);
            oscillator.stop(audioContext.currentTime + 0.5);
            
            setTimeout(() => audioContext.close(), 1000);
        } catch(err) {
            console.log("Fallback también falló:", err);
        }
    }
}

document.addEventListener('visibilitychange', () => {
    paginaVisible = !document.hidden;
    if (paginaVisible) {
        console.log("🟢 Página visible - Reactivando actualizaciones");
        if (isOnline) cargarPedidos();
    } else {
        console.log("🔴 Página oculta - Reduciendo actualizaciones");
    }
});

// ==================== INICIALIZACIÓN PRINCIPAL ====================
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 Inicializando delivery...");
    
    // Verificar sesión antes de cualquier cosa
    const sesionValida = await verificarYProtegerSesion();
    if (!sesionValida) return;
    
    // Cargar usuario seguro
    loadUser();
    
    // Inicializar mapa
    initMap();
    
    // Actualizar estadísticas después de un momento
    setTimeout(() => actualizarEstadisticas(), 1000);
    
    // Si está online, iniciar localización y cargar pedidos
    if (isOnline) {
        setTimeout(() => {
            startLocationTracking();
            cargarPedidos(true);
        }, 500);
    }
});

// ==================== FUNCIÓN LOAD USER (SOLO UNA VEZ) ====================
function loadUser() {
    const usuario = securityManager.obtenerUsuarioActual();
    if (!usuario) { 
        window.location.href = "index.html"; 
        return; 
    }
    
    currentUser = usuario;
    
    if (currentUser.rol !== 'delivery') { 
        window.location.href = "cliente.html"; 
        return; 
    }
    
    isOnline = currentUser.online === true;
    
    document.getElementById("userInfo").innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-motorcycle text-[#FF6200] text-xl"></i>
            <span class="font-medium">${sanitizarHTML(currentUser.nombre)}</span>
            <span class="text-gray-400 text-xs">(Delivery)</span>
        </div>
        <div class="text-xs text-gray-500 mt-1">
            <i class="fas fa-star text-yellow-500"></i> Calificación: 4.9
        </div>
        <div id="estadoDeliveryBadge" class="mt-2 text-xs"></div>
    `;
    
    if(isOnline) {
        document.getElementById("onlineToggle").classList.remove("bg-gray-500");
        document.getElementById("onlineToggle").classList.add("bg-green-500");
        document.getElementById("onlineStatusText").innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
    }
}

// ==================== INICIALIZACIÓN DEL MAPA ====================
function initMap() {
    const cdDelCarmen = { lat: 18.6456, lng: -91.8249 };
    
    map = L.map('map', {
     maxBoundsViscosity: 1.0,
        rotate: true,
        rotateControl: true,
        zoomControl: true,
        attributionControl: true,
        touchZoom: true,
        dragging: true,
        tap: true,
        inertia: false
    }).setView([cdDelCarmen.lat, cdDelCarmen.lng], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
    
    limitarMapaACarmen(map);
    
    if (cargaPedidosInterval) clearInterval(cargaPedidosInterval);
    cargaPedidosInterval = setInterval(() => { 
        if (isOnline) cargarPedidos(); 
    }, 5000);

    // ==================== ROTACIÓN ====================
    map.on('rotate', function() {
        const transform = map.getContainer().style.transform || '';
        const match = transform.match(/rotate\(([-0-9.]+)deg\)/);
        if (match) {
            mapRotationAngle = parseFloat(match[1]);
        }
        actualizarRotacionMarcadores();
    });

    // Rotación inicial
    map.getContainer().style.transform = 'rotate(0deg)';
    mapRotationAngle = 0;

    console.log("🗺️ Mapa de Delivery inicializado con rotación activada");
}

// ==================== CIERRE DE SESIÓN CORREGIDO ====================
function cerrarSesion() {
    console.log("🔐 Mostrando modal de confirmación para delivery...");
    
    // Usar el modal directamente con callbacks
    mostrarModalConfirmacionDelivery(
        "Cerrar Sesión",
        "¿Estás seguro de que deseas cerrar sesión?",
        async () => {
            console.log("✅ Usuario confirmó cierre de sesión, procediendo...");
            
            try {
                // Usar la función centralizada de limpieza
                limpiarIntervalosDelivery();

                // Actualizar estado offline en Supabase
                if (currentUser && supabaseClient) {
                    await setDeliveryOnlineSupabase(currentUser.id, false)
                        .catch(err => console.warn("No se pudo actualizar offline:", err));
                }

                // Cerrar sesión con securityManager
                await securityManager.cerrarSesion();

            } catch (error) {
                console.error("❌ Error durante el cierre de sesión:", error);
                try {
                    await securityManager.cerrarSesion();
                } catch (e) {
                    window.location.href = "index.html";
                }
            }
        },
        () => {
            console.log("❌ Usuario canceló cierre de sesión");
        }
    );
}

async function actualizarBadgeEstado() {
    if (!currentUser) return;
    if (!paginaVisible) return; // ✅ No actualizar si página oculta
    
    const tienePedido = await deliveryTienePedidoActivo(currentUser.id);
    const badge = document.getElementById("estadoDeliveryBadge");
    
    if (badge) {
        if (tienePedido) {
            badge.innerHTML = '<span class="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full"><i class="fas fa-motorcycle mr-1"></i> Ocupado - En entrega</span>';
        } else {
            badge.innerHTML = '<span class="bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full"><i class="fas fa-check-circle mr-1"></i> Disponible para entregas</span>';
        }
    }
}

// ==================== LIMPIAR RUTAS Y MARCADORES ====================
function limpiarRutasYMarcadores() {
    // Limpiar Routing Control de forma segura
    if (currentRoutingControl) {
        try {
            if (currentRoutingControl._map) {
                map.removeControl(currentRoutingControl);
            } else if (currentRoutingControl.getPlan) {
                currentRoutingControl.getPlan().setWaypoints([]);
            }
        } catch (e) {
            console.warn("Error limpiando routing control:", e.message);
        }
        currentRoutingControl = null;
    }

    // Limpiar marcadores
    [recogidaMarker, destinoMarker].forEach(marker => {
        if (marker) {
            try { map.removeLayer(marker); } catch(e) {}
        }
    });

    recogidaMarker = null;
    destinoMarker = null;

    console.log("🧹 Rutas y marcadores limpiados");
}

async function dibujarRutaRecogida(pedido) {
    // ✅ Evitar redibujar si ya estamos en la misma ruta
    if (ultimoPedidoDibujado === pedido.id && ultimaEtapa === 'recogida') {
        console.log("🟢 Ruta de recogida ya activa, omitiendo redibujo");
        return;
    }
    
    if (dibujandoRuta) {
        console.log("⏳ Ya dibujando una ruta, espera...");
        return;
    }
    
    dibujandoRuta = true;
    limpiarRutasYMarcadores();
    ultimoPedidoDibujado = pedido.id;
    ultimaEtapa = 'recogida';
    
    if (!pedido.origenCoords) {
        mostrarToast("❌ No hay coordenadas de origen", true);
        dibujandoRuta = false;
        return;
    }
    
    let ubicacionActual = null;
    if (userMarker) {
        const latLng = userMarker.getLatLng();
        ubicacionActual = { lat: latLng.lat, lng: latLng.lng };
    }
    
    let waypoints = [];
    if (ubicacionActual) {
        waypoints = [
            L.latLng(ubicacionActual.lat, ubicacionActual.lng),
            L.latLng(pedido.origenCoords.lat, pedido.origenCoords.lng)
        ];
    } else {
        waypoints = [
            L.latLng(pedido.origenCoords.lat, pedido.origenCoords.lng)
        ];
    }
    
    currentRoutingControl = L.Routing.control({
        waypoints: waypoints,
        routeWhileDragging: false,
        showAlternatives: false,
        fitSelectedRoutes: true,
        lineOptions: {
            styles: [{ color: '#10B981', weight: 6, opacity: 0.9 }]
        },
        router: L.Routing.osrmv1({
            serviceUrl: 'https://router.project-osrm.org/route/v1'
        }),
        show: false,
        addWaypoints: false,
        draggableWaypoints: false
    }).addTo(map);
    
    setTimeout(() => {
        if (ubicacionActual) {
            map.fitBounds([
                [ubicacionActual.lat, ubicacionActual.lng],
                [pedido.origenCoords.lat, pedido.origenCoords.lng]
            ], { padding: [50, 50] });
        } else {
            map.setView([pedido.origenCoords.lat, pedido.origenCoords.lng], 15);
        }
        map.invalidateSize();
        dibujandoRuta = false;
    }, 300);
    
    if (recogidaMarker) map.removeLayer(recogidaMarker);
    recogidaMarker = L.marker([pedido.origenCoords.lat, pedido.origenCoords.lng], {
        icon: L.divIcon({
            html: '<div style="background:#10B981; width:36px; height:36px; border-radius:50%; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-box" style="color:white; font-size:16px;"></i></div>',
            iconSize: [36, 36]
        })
    }).addTo(map);
    recogidaMarker.bindPopup(`<b>📍 RECOGER AQUÍ</b><br>${sanitizarHTML(pedido.origen)}`);
    
    mostrarToast(`📍 Ruta de RECOGIDA - Dirígete a: ${sanitizarHTML(pedido.destino)}`);
}

// ==================== RUTA DE ENTREGA (origen -> destino) ====================
async function dibujarRutaEntrega(pedido) {
    // ✅ Validar que estamos en el pedido correcto
    if (ultimoPedidoDibujado === pedido.id && ultimaEtapa === 'entrega') {
        console.log("🟢 Ruta de entrega ya activa, omitiendo redibujo");
        return;
    }
    
    if (dibujandoRuta) {
        console.log("⏳ Ya dibujando una ruta, espera...");
        return;
    }
    
    dibujandoRuta = true;
    
    // ✅ Limpiar rutas anteriores
    limpiarRutasYMarcadores();
    ultimoPedidoDibujado = pedido.id;
    ultimaEtapa = 'entrega';
    
    // ✅ Validar coordenadas del origen (recogida) y destino
    if (!pedido.origenCoords || !pedido.destinoCoords) {
        console.error("❌ Faltan coordenadas para ruta de entrega:", {
            origen: pedido.origenCoords,
            destino: pedido.destinoCoords
        });
        mostrarToast("❌ No se pueden dibujar coordenadas de destino. Intenta recargar.", true);
        dibujandoRuta = false;
        return;
    }
    
    console.log("📍 Dibujando ruta de ENTREGA:", {
        desde: pedido.origenCoords,
        hasta: pedido.destinoCoords
    });
    
    // ✅ Crear la ruta desde origen (recogida) hasta destino
    try {
        currentRoutingControl = L.Routing.control({
            waypoints: [
                L.latLng(pedido.origenCoords.lat, pedido.origenCoords.lng),
                L.latLng(pedido.destinoCoords.lat, pedido.destinoCoords.lng)
            ],
            routeWhileDragging: false,
            showAlternatives: false,
            fitSelectedRoutes: true,
            lineOptions: {
                styles: [{ color: '#FF6200', weight: 6, opacity: 0.9 }]
            },
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1'
            }),
            show: false,
            addWaypoints: false,
            draggableWaypoints: false
        }).addTo(map);
        
        // ✅ Ajustar el mapa para ver toda la ruta
        setTimeout(() => {
            map.fitBounds([
                [pedido.origenCoords.lat, pedido.origenCoords.lng],
                [pedido.destinoCoords.lat, pedido.destinoCoords.lng]
            ], { padding: [50, 50] });
            map.invalidateSize();
            dibujandoRuta = false;
        }, 300);
        
    } catch(e) {
        console.error("❌ Error dibujando ruta de entrega:", e);
        mostrarToast("❌ Error al dibujar la ruta", true);
        dibujandoRuta = false;
    }
    
    // ✅ Crear marcador de destino si no existe
    if (destinoMarker) map.removeLayer(destinoMarker);
    destinoMarker = L.marker([pedido.destinoCoords.lat, pedido.destinoCoords.lng], {
        icon: L.divIcon({
            html: '<div style="background:#3B82F6; width:36px; height:36px; border-radius:50%; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-flag-checkered" style="color:white; font-size:16px;"></i></div>',
            iconSize: [36, 36]
        })
    }).addTo(map);
    destinoMarker.bindPopup(`<b>🏁 ENTREGAR AQUÍ</b><br>${sanitizarHTML(pedido.destino)}`).openPopup();
    
    mostrarToast(`🚚 Ruta de ENTREGA - Desde ${sanitizarHTML(pedido.origen)} hasta ${sanitizarHTML(pedido.destino)}`);
    
    // ✅ Opcional: cerrar popup después de 5 segundos
    setTimeout(() => {
        if (destinoMarker) destinoMarker.closePopup();
    }, 5000);
}

// ==================== MARCAR PAQUETE COMO RECOGIDO ====================
async function marcarPaqueteRecogido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    mostrarToast("📦 Actualizando estado del paquete...");
    
    try {
        // ✅ Actualizar en Supabase
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'recogido',
                paquete_recogido_en: new Date().toISOString()
            })
            .eq('id', pedidoId);
        
        if (error) throw error;
        
        mostrarToast(`✅ ¡Paquete #${sanitizarHTML(pedidoId)} RECOGIDO! Ahora dirígete al destino.`);
        vibrar(200);  // <-- AGREGAR
        
          // ✅ Forzar recarga para obtener el nuevo estado 'recogido'
        await cargarPedidos(true);
        
        // ✅ Buscar el pedido actualizado y dibujar ruta de entrega
        const pedidoActualizado = misPedidosActivos.find(p => p.id === pedidoId);
        if (pedidoActualizado && pedidoActualizado.estado === 'recogido') {
            await dibujarRutaEntrega(pedidoActualizado);
            await actualizarColorMarcador();
            
            // ✅ Mostrar popup con instrucciones
            if (userMarker) {
                userMarker.bindPopup(`🏍️ <b>${sanitizarHTML(currentUser.nombre)}</b><br>📦 En camino a ENTREGAR`).openPopup();
                setTimeout(() => userMarker.closePopup(), 3000);
            }
        } else {
            console.error("❌ No se encontró el pedido actualizado", pedidoId);
            mostrarToast("⚠️ El pedido se actualizó, pero no se pudo dibujar la ruta", true);
        }
        
    } catch(e) {
        console.error('Error marcando paquete recogido:', e);
        mostrarToast("❌ Error al registrar la recogida: " + (e.message || "Verifica tu conexión"), true);
    }
}

function startLocationTracking() {
    if(!("geolocation" in navigator)) {
        mostrarToast("⚠️ Tu navegador no soporta geolocalización", true);
        return;
    }
    
    // ✅ Evitar múltiples instancias
    if (window.iniciandoLocalizacion) {
        console.log("⏳ Ya se está iniciando la localización");
        return;
    }
    
    // ✅ Verificar que el usuario es delivery
    if (!currentUser || currentUser.rol !== 'delivery') {
        console.log("❌ No se puede iniciar localización: usuario no es delivery");
        return;
    }
    
    window.iniciandoLocalizacion = true;
    mostrarToast("📍 Obteniendo ubicación...");
    
    const options = {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000
    };
    
    // ✅ PRIMERO: Obtener ubicación rápida con getCurrentPosition
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            try {
                const coords = { 
                    lat: pos.coords.latitude, 
                    lng: pos.coords.longitude 
                };
                
                console.log("📍 Ubicación inicial obtenida en:", new Date().toISOString());
                
                // ✅ Validar límites
                if (coords.lat < 18.58 || coords.lat > 18.70 || 
                    coords.lng < -91.88 || coords.lng > -91.75) {
                    mostrarToast("⚠️ Estás fuera de Ciudad del Carmen. Acércate a la zona de servicio", true);
                    window.iniciandoLocalizacion = false;
                    return;
                }
                
                // Guardar inmediatamente
                ultimaUbicacionEnviada = coords;
                
                // Crear marcador si no existe
                if(!userMarker) {
                    userMarker = crearMarcadorDelivery(
                        coords.lat, 
                        coords.lng, 
                        currentUser.nombre, 
                        isOnline ? '#10B981' : '#9CA3AF'
                    );
                    userMarker.addTo(map);
                } else {
                    userMarker.setLatLng(coords);
                }
                
                // Centrar mapa inmediatamente
                map.setView([coords.lat, coords.lng], 15);
                
                // ✅ Guardar en Supabase SOLO si está online
                if(currentUser && isOnline && supabaseClient) {
                    await guardarUbicacionEnSupabase(
                        currentUser.id,
                        currentUser.nombre,
                        coords.lat,
                        coords.lng,
                        true
                    );
                    console.log("✅ Ubicación guardada en Supabase");
                }
                
                mostrarToast("✅ Ubicación detectada");
                window.iniciandoLocalizacion = false;
                
            } catch (error) {
                console.error("❌ Error procesando ubicación inicial:", error);
                window.iniciandoLocalizacion = false;
                // ✅ Segundo intento después de 2 segundos
                setTimeout(() => {
                    if (!ultimaUbicacionEnviada && isOnline) {
                        obtenerUbicacionAlternativa();
                    }
                }, 2000);
            }
        },
        (err) => {
            console.error("Error en ubicación inicial:", err);
            window.iniciandoLocalizacion = false;
            
            if(err.code === 1) {
                mostrarToast("❌ Permite el acceso a tu ubicación en la configuración del navegador", true);
            } else {
                mostrarToast("⚠️ No se pudo obtener ubicación. Intentando de nuevo...", true);
                // ✅ Segundo intento después de 2 segundos
                setTimeout(() => {
                    if (!ultimaUbicacionEnviada && isOnline) {
                        obtenerUbicacionAlternativa();
                    }
                }, 2000);
            }
        },
        options
    );
    
    // ✅ DESPUÉS: Iniciar watch para seguimiento continuo
    if(watchId) navigator.geolocation.clearWatch(watchId);
    
    watchId = navigator.geolocation.watchPosition(
        async (pos) => {
            const coords = { 
                lat: pos.coords.latitude, 
                lng: pos.coords.longitude 
            };
            
            // ✅ Validar límites
            if (coords.lat < 18.58 || coords.lat > 18.70 || 
                coords.lng < -91.88 || coords.lng > -91.75) {
                return; // No actualizar si está fuera de zona
            }
            
            // ✅ Reducir frecuencia: solo actualizar si movió más de 20 metros
            if (ultimaUbicacionEnviada) {
                const distancia = calcularDistanciaMetros(ultimaUbicacionEnviada, coords);
                if (distancia < 20) {
                    return; // No actualizar si movió menos de 20 metros
                }
            }
            
            ultimaUbicacionEnviada = coords;
            
            if(userMarker) {
                userMarker.setLatLng(coords);
            }
            
            // ✅ Guardar en Supabase con throttling
            if(currentUser && isOnline && supabaseClient) {
                await guardarUbicacionConThrottle(
                    currentUser.id, 
                    currentUser.nombre, 
                    coords.lat, 
                    coords.lng, 
                    true
                );
            }
        },
        (err) => {
            console.error("Error en watchPosition:", err);
        },
        { 
            enableHighAccuracy: true, 
            maximumAge: 5000,
            timeout: 10000
        }
    );
}

// ✅ Función auxiliar: calcular distancia en metros
function calcularDistanciaMetros(punto1, punto2) {
    const R = 6371e3; // Metros
    const φ1 = punto1.lat * Math.PI/180;
    const φ2 = punto2.lat * Math.PI/180;
    const Δφ = (punto2.lat - punto1.lat) * Math.PI/180;
    const Δλ = (punto2.lng - punto1.lng) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

// ✅ Variable para throttle de ubicación
let ultimoGuardadoUbicacion = 0;

// ✅ Función con throttle para guardar ubicación
async function guardarUbicacionConThrottle(deliveryId, deliveryNombre, lat, lng, online) {
    const ahora = Date.now();
    if (ahora - ultimoGuardadoUbicacion < 5000) {
        return; // Guardar máximo cada 5 segundos
    }
    ultimoGuardadoUbicacion = ahora;
    
    await guardarUbicacionEnSupabase(deliveryId, deliveryNombre, lat, lng, online);
}

// ✅ Función alternativa para obtener ubicación (si falla la primera)
function obtenerUbicacionAlternativa() {
    // ✅ Evitar múltiples intentos simultáneos
    if (window.obteniendoUbicacionAlternativa) {
        console.log("⏳ Ya hay un intento de ubicación en curso");
        return;
    }
    
    window.obteniendoUbicacionAlternativa = true;
    mostrarToast("🔄 Reintentando obtener ubicación...");
    
    // ✅ Verificar que el usuario sigue siendo delivery y está online
    if (!currentUser || currentUser.rol !== 'delivery') {
        console.log("❌ Usuario no es delivery, cancelando obtención de ubicación");
        window.obteniendoUbicacionAlternativa = false;
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            try {
                const coords = { 
                    lat: pos.coords.latitude, 
                    lng: pos.coords.longitude 
                };
                
                // ✅ Validar que las coordenadas estén dentro de Ciudad del Carmen
                if (coords.lat < 18.58 || coords.lat > 18.70 || 
                    coords.lng < -91.88 || coords.lng > -91.75) {
                    console.warn("📍 Ubicación fuera de Ciudad del Carmen:", coords);
                    mostrarToast("⚠️ Estás fuera de la zona de servicio (Ciudad del Carmen)", true);
                    window.obteniendoUbicacionAlternativa = false;
                    return;
                }
                
                console.log("📍 Ubicación obtenida en segundo intento:", coords);
                ultimaUbicacionEnviada = coords;
                
                // ✅ Crear o actualizar marcador
                if (!map) {
                    console.error("❌ Mapa no inicializado");
                    window.obteniendoUbicacionAlternativa = false;
                    return;
                }
                
                if (!userMarker) {
                    userMarker = crearMarcadorDelivery(
                        coords.lat, 
                        coords.lng, 
                        currentUser.nombre, 
                        isOnline ? '#10B981' : '#9CA3AF'
                    );
                    userMarker.addTo(map);
                } else {
                    userMarker.setLatLng(coords);
                }
                
                // ✅ Centrar mapa suavemente
                map.setView([coords.lat, coords.lng], 15);
                
                // ✅ Guardar en Supabase SOLO si está online
                if (currentUser && isOnline && supabaseClient) {
                    await guardarUbicacionEnSupabase(
                        currentUser.id,
                        currentUser.nombre,
                        coords.lat,
                        coords.lng,
                        true
                    );
                    console.log("✅ Ubicación guardada en Supabase (segundo intento)");
                }
                
                mostrarToast("✅ Ubicación detectada correctamente");
                
                // ✅ Forzar carga de pedidos después de obtener ubicación
                if (isOnline && typeof cargarPedidos === 'function') {
                    setTimeout(() => cargarPedidos(true), 1000);
                }
                
            } catch (error) {
                console.error("❌ Error procesando ubicación:", error);
                mostrarToast("⚠️ Error al procesar la ubicación", true);
            } finally {
                window.obteniendoUbicacionAlternativa = false;
            }
        },
        (err) => {
            console.error("Error en segundo intento:", err);
            window.obteniendoUbicacionAlternativa = false;
            
            // ✅ Mensajes más descriptivos según el error
            let mensajeError = "⚠️ No se pudo obtener tu ubicación";
            if (err.code === 1) {
                mensajeError = "❌ Permiso de ubicación denegado. Actívalo en la configuración de tu navegador";
            } else if (err.code === 2) {
                mensajeError = "⚠️ Ubicación no disponible. Verifica que el GPS esté activado";
            } else if (err.code === 3) {
                mensajeError = "⏰ Tiempo de espera agotado. Intenta recargar la página";
            }
            
            mostrarToast(mensajeError, true);
            
            // ✅ Sugerencia para el usuario
            setTimeout(() => {
                mostrarToast("💡 Sugerencia: Activa el GPS y recarga la página", false);
            }, 2000);
        },
        { 
            enableHighAccuracy: true, 
            timeout: 10000,  // Aumentado a 10 segundos
            maximumAge: 0    // No usar caché
        }
    );
}

function centrarMapa() {
    if(map) map.setView([18.6456, -91.8249], 13);
    mostrarToast("📍 Mapa centrado en Ciudad del Carmen");
}

async function cargarPedidos(force = false) {
    // ✅ Si no es forzado y la página está oculta, salir
    if (!force && !paginaVisible) {
        console.log("📴 Página oculta, no se cargan pedidos");
        return;
    }
    
    // ✅ Throttling INTELIGENTE: 2 segundos si está online, 5 si está offline
    const ahora = Date.now();
    let tiempoEspera = 5000;
    
    if (!force) {
        if (isOnline) {
            tiempoEspera = 2000;
        } else {
            tiempoEspera = 5000;
        }
        
        if (ahora - ultimaPeticionPedidos < tiempoEspera) {
            console.log(`⏳ Throttling: cargarPedidos - demasiado rápido (${sanitizarHTML(tiempoEspera/1000)}s)`);
            return;
        }
    }
    ultimaPeticionPedidos = ahora;
    
    const supabase = supabaseClient;
    if (!supabase) {
        console.error('Supabase no disponible');
        return;
    }
    
    try {
        // ✅ Cargar pedidos pendientes
        const { data: pedidosPendientes, error: errorPendientes } = await supabase
            .from('pedidos')
            .select('*')
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: true });
        
        if (errorPendientes) throw errorPendientes;
        
        // ✅ Cargar pedidos asignados a este delivery
        const { data: pedidosAsignados, error: errorAsignados } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .in('estado', ['asignado', 'recogido'])
            .order('fecha', { ascending: true });
        
        if (errorAsignados) throw errorAsignados;
        
        // ✅ Guardar cantidad anterior de pedidos disponibles para notificación
        const pedidosAnteriores = pedidosDisponibles.length;
        
        // ✅ Convertir pedidos
        const nuevosDisponibles = (pedidosPendientes || []).map(p => convertirPedidoDeSupabase(p));
        const nuevosActivos = (pedidosAsignados || []).map(p => convertirPedidoDeSupabase(p));
        
        // ✅ Guardar estado anterior para detectar cambios
        const estadoAnteriorActivo = misPedidosActivos.length > 0 ? misPedidosActivos[0]?.estado : null;
        
        pedidosDisponibles = nuevosDisponibles;
        misPedidosActivos = nuevosActivos;
        
        // ✅ NOTIFICAR SI HAY NUEVOS PEDIDOS (y no hay pedido activo)
        if (!misPedidosActivos.length && pedidosDisponibles.length > pedidosAnteriores && pedidosDisponibles.length > 0) {
            console.log("🔔 ¡Nuevo pedido disponible!");
            notificarNuevoPedido();
            mostrarToast("🔔 ¡Nuevo pedido disponible! Revísalo", false);
        }
        
        // ✅ Actualizar UI
        actualizarListaPedidos();
        
        // ✅ Manejar cambios de estado para rutas
        if (misPedidosActivos.length > 0) {
            const pedidoActivo = misPedidosActivos[0];
            const estadoActual = pedidoActivo.estado;
            
            // 🔄 SIEMPRE recalcular ruta si hay pedido activo (para actualizar con nueva ubicación)
            if (estadoActual === 'asignado' && pedidoActivo.origenCoords) {
                // Verificar si la ruta actual es válida o necesita recálculo por movimiento
                const necesitaRecalculo = !currentRoutingControl || 
                                          ultimaEtapa !== 'recogida' ||
                                          ultimoPedidoDibujado !== pedidoActivo.id;
                
                if (necesitaRecalculo || estadoAnteriorActivo !== estadoActual) {
                    console.log("🟢 Dibujando/Actualizando ruta de RECOGIDA...");
                    await dibujarRutaRecogida(pedidoActivo);
                }
            }
            else if (estadoActual === 'recogido' && pedidoActivo.destinoCoords) {
                const necesitaRecalculo = !currentRoutingControl || 
                                          ultimaEtapa !== 'entrega' ||
                                          ultimoPedidoDibujado !== pedidoActivo.id;
                
                if (necesitaRecalculo || estadoAnteriorActivo !== estadoActual) {
                    console.log("🟠 Dibujando/Actualizando ruta de ENTREGA...");
                    await dibujarRutaEntrega(pedidoActivo);
                }
            }
        } else {
            limpiarRutasYMarcadores();
            if (pedidoSeleccionado) {
                dibujarRutaOptimaPedido(pedidoSeleccionado);
            }
        }
        
        // ✅ Actualizar color del marcador y badge
        await actualizarColorMarcador();
        await actualizarBadgeEstado();
        
        console.log(`📦 ${sanitizarHTML(pedidosDisponibles.length)} pedidos disponibles, ${sanitizarHTML(misPedidosActivos.length)} activos`);
        
    } catch(e) {
        console.error('Error cargando pedidos:', e);
    }
}

function seleccionarPedido(pedidoId) {
    pedidoSeleccionado = pedidosDisponibles.find(p => p.id === pedidoId);
    limpiarRutasYMarcadores();
    dibujarRutaOptimaPedido(pedidoSeleccionado);
    actualizarListaPedidos();
    mostrarToast(`📍 Pedido #${sanitizarHTML(pedidoId)} seleccionado - Ruta mostrada en mapa`);
}

async function dibujarRutaOptimaPedido(pedido) { limpiarRutasYMarcadores();
    
    if (pedido.origenCoords && pedido.destinoCoords) {
        currentRoutingControl = L.Routing.control({
            waypoints: [
                L.latLng(pedido.origenCoords.lat, pedido.origenCoords.lng),
                L.latLng(pedido.destinoCoords.lat, pedido.destinoCoords.lng)
            ],
            routeWhileDragging: false,
            showAlternatives: false,
            lineOptions: {
                styles: [{ color: '#FF6200', weight: 5, opacity: 0.8 }]
            },
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1'
            }),
            show: false,
            addWaypoints: false,
            draggableWaypoints: false
        }).addTo(map);
        
        map.fitBounds([
            [pedido.origenCoords.lat, pedido.origenCoords.lng],
            [pedido.destinoCoords.lat, pedido.destinoCoords.lng]
        ], { padding: [50, 50] });
        
        mostrarToast(`📏 Distancia: ${sanitizarHTML(pedido.distanciaReal)} km • 💰 $${sanitizarHTML(pedido.tarifa)}`);
    }
}

function dibujarRutaSeleccionada() {
    if (pedidoSeleccionado) {
        dibujarRutaOptimaPedido(pedidoSeleccionado);
    }
}

async function agarrarPedido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    // ✅ PREVENIR DOBLE CLIC
    if (window.agarrandoPedido) {
        mostrarToast("⏳ Procesando solicitud, espera...", true);
        return;
    }
    window.agarrandoPedido = true;
    
    mostrarToast("🔍 Verificando disponibilidad...");
    
    try {
        // ========== 1. VERIFICAR QUE EL DELIVERY NO TENGA PEDIDO ACTIVO ==========
        const tienePedidoActivo = await deliveryTienePedidoActivo(currentUser.id);
        
        if (tienePedidoActivo) {
            const pedidoActivo = await getPedidoActivoDelDelivery(currentUser.id);
            mostrarToast(`❌ Ya tienes un pedido activo (#${sanitizarHTML(pedidoActivo?.id)}). Complétalo primero.`, true);
            
            if (pedidoActivo) {
                const elementoActivo = document.querySelector(`[data-pedido-id="${sanitizarHTML(pedidoActivo.id)}"]`);
                if (elementoActivo) {
                    elementoActivo.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    elementoActivo.style.border = '2px solid #FF6200';
                    setTimeout(() => {
                        elementoActivo.style.border = '';
                    }, 3000);
                }
            }
            window.agarrandoPedido = false;
            return;
        }
        
        // ========== 2. VERIFICAR QUE EL PEDIDO SIGA PENDIENTE ==========
        const { data: pedidoActual, error: errorPedido } = await supabase
            .from('pedidos')
            .select('id, estado, cliente_nombre, origen, destino, tarifa')
            .eq('id', pedidoId)
            .single();
        
        if (errorPedido) throw errorPedido;
        
        if (!pedidoActual) {
            mostrarToast(`❌ El pedido #${sanitizarHTML(pedidoId)} no existe`, true);
            window.agarrandoPedido = false;
            return;
        }
        
        if (pedidoActual.estado !== 'pendiente') {
            mostrarToast(`❌ El pedido #${sanitizarHTML(pedidoId)} ya no está disponible (fue agarrado por otro delivery)`, true);
            await cargarPedidos(true);
            window.agarrandoPedido = false;
            return;
        }
        
        // ========== 3. CONFIRMAR CON MODAL ==========
        const confirmado = await mostrarModalConfirmacionDelivery(
            "Confirmar pedido",
            `¿Seguro que quieres AGARRAR el pedido #${sanitizarHTML(pedidoId)}?\n\n📦 ${sanitizarHTML(pedidoActual.cliente_nombre)}\n📍 ${sanitizarHTML(pedidoActual.origen)}\n💰 $${pedidoActual.tarifa}`
        );
        
        console.log("Confirmado:", confirmado); // ✅ Debería mostrar true o false
        
        if (!confirmado) {
            mostrarToast("❌ Acción cancelada");
            window.agarrandoPedido = false;
            return;
        }
        
        // ========== 4. AGARRAR PEDIDO CON DOBLE VERIFICACIÓN ==========
        // 🔴 CRÍTICO: Usar transacción/condición para evitar race condition
        const { data: updatedPedido, error: updateError } = await supabase
            .from('pedidos')
            .update({
                estado: 'asignado',
                delivery_id: currentUser.id,
                delivery_nombre: currentUser.nombre,
                fecha_asignado: new Date().toISOString()
            })
            .eq('id', pedidoId)
            .eq('estado', 'pendiente')  // ← CLAVE: solo si sigue pendiente
            .select();  // ← Devolver el registro actualizado
        
        // ========== 5. VERIFICAR SI LA ACTUALIZACIÓN FUE EXITOSA ==========
        if (updateError) throw updateError;
        
        // Si no se actualizó ningún registro, alguien más lo agarró
        if (!updatedPedido || updatedPedido.length === 0) {
            mostrarToast(`❌ El pedido #${sanitizarHTML(pedidoId)} fue agarrado por otro delivery justo ahora`, true);
            await cargarPedidos(true);
            window.agarrandoPedido = false;
            return;
        }
        
        // ========== 6. ACTUALIZAR ESTADO LOCAL ==========
        const pedidoAsignado = updatedPedido[0];
        
        // Mostrar éxito
        mostrarToast(`✅ Pedido #${sanitizarHTML(pedidoId)} AGARRADO! Dirígete al origen para recoger.`);
        vibrar(300);
        
        // Limpiar selección
        pedidoSeleccionado = null;
        
        // ========== 7. ACTUALIZAR LISTAS ==========
        // Recargar pedidos desde Supabase
        await cargarPedidos(true);
        
        // Actualizar color del marcador (a naranja porque está ocupado)
        await actualizarColorMarcador();
        
        // ========== 8. MOSTRAR RUTA DE RECOGIDA ==========
        // Buscar el pedido en misPedidosActivos (ya debería estar después de cargarPedidos)
        const pedidoActivo = misPedidosActivos.find(p => p.id === pedidoId);
        
        if (pedidoActivo && pedidoActivo.origenCoords) {
            await dibujarRutaRecogida(pedidoActivo);
            
            // Centrar mapa en el origen
            setTimeout(() => {
                if (map && pedidoActivo.origenCoords) {
                    map.setView([pedidoActivo.origenCoords.lat, pedidoActivo.origenCoords.lng], 14);
                    // Mostrar popup en el origen
                    if (recogidaMarker) {
                        recogidaMarker.openPopup();
                        setTimeout(() => recogidaMarker.closePopup(), 5000);
                    }
                }
            }, 500);
        } else {
            console.warn("⚠️ No se encontró el pedido asignado en misPedidosActivos");
            // Forzar una recarga adicional después de 1 segundo
            setTimeout(() => cargarPedidos(true), 1000);
        }
        
        // ========== 9. ACTUALIZAR BADGE DE ESTADO ==========
        await actualizarBadgeEstado();
        
    } catch(e) {
        console.error('❌ Error agarrando pedido:', e);
        mostrarToast(`❌ Error al agarrar el pedido: ${e.message || "Intenta de nuevo"}`, true);
    } finally {
        // Liberar el lock después de 2 segundos (para prevenir doble clic)
        setTimeout(() => {
            window.agarrandoPedido = false;
        }, 2000);
    }
}

async function completarPedido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
        mostrarToast("🏁 Marcando pedido como entregado...");
        
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'completado',
                fecha_completado: new Date().toISOString()
            })
            .eq('id', pedidoId);
        
        if (error) throw error;
        
        const { data: pedido } = await supabase
            .from('pedidos')
            .select('tarifa')
            .eq('id', pedidoId)
            .single();
        
        mostrarToast(`✅ Pedido #${sanitizarHTML(pedidoId)} ENTREGADO! Ganaste ${sanitizarHTML(pedido?.tarifa || 0)} MXN`);
        vibrar(200);  // <-- AGREGAR

         // ✅ AGREGAR: Actualizar estadísticas después de completar
        await actualizarEstadisticas();
        
        // Limpiar rutas y marcadores
        limpiarRutasYMarcadores();
        
        // Limpiar intervalo de ubicación si existe
        if (ubicacionInterval) {
            clearInterval(ubicacionInterval);
            ubicacionInterval = null;
        }
        
        // Resetear variables de seguimiento
        ultimoPedidoDibujado = null;
        ultimaEtapa = null;
        dibujandoRuta = false;
        
        // Recargar pedidos FORZADAMENTE
        await cargarPedidos(true);
        
        // Actualizar color del marcador
        await actualizarColorMarcador();
        
        // Actualizar badge de estado
        await actualizarBadgeEstado();
        
        // Forzar una actualización adicional después de 1 segundo
        setTimeout(() => {
            cargarPedidos(true);
        }, 1000);
        
    } catch(e) {
        console.error('Error completando pedido:', e);
        mostrarToast("❌ Error al completar el pedido", true);
    }
}

function actualizarListaPedidos() {
    const containerDisponibles = document.getElementById("pedidosDisponibles");
    // Verificar si el delivery ya tiene pedido activo (para UI)
    const tienePedidoActivo = misPedidosActivos.length > 0;
    
    if(pedidosDisponibles.length === 0) {
        containerDisponibles.innerHTML = '<div class="text-center text-gray-400 py-8"><i class="fas fa-box-open text-4xl mb-2 block"></i>No hay pedidos disponibles</div>';
    } else {
        containerDisponibles.innerHTML = pedidosDisponibles.map(p => `
            <div class="bg-white border rounded-xl p-4 shadow-sm pedido-card ${sanitizarHTML(pedidoSeleccionado?.id === p.id ? 'pedido-seleccionado' : '')}" onclick="seleccionarPedido(${sanitizarHTML(p.id)})">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-bold text-[#FF6200]">#${sanitizarHTML(p.id)}</span>
                    <span class="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">Pendiente</span>
            </div>
                <p class="text-sm"><i class="fas fa-circle text-[#FF6200] text-xs mr-1"></i> ${sanitizarHTML(p.origen)}</p>
                <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> ${sanitizarHTML(p.destino)}</p>
                <p class="text-xs text-gray-500 mt-2">📏 ${sanitizarHTML(p.distanciaReal)} km • 💰 $${sanitizarHTML(p.tarifa)}</p>
                <p class="text-xs text-gray-500">👤 Cliente: ${sanitizarHTML(p.clienteNombre)}</p>
                ${tienePedidoActivo ? 
                    `<button disabled class="w-full mt-3 bg-gray-400 cursor-not-allowed text-white py-2 rounded-lg text-sm font-medium transition-all">
                        <i class="fas fa-lock mr-1"></i> Completar pedido actual primero
                    </button>` :
                    `<button onclick="event.stopPropagation(); agarrarPedido(${sanitizarHTML(p.id)})" class="w-full mt-3 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
                        <i class="fas fa-hand-paper mr-1"></i> AGARRAR PEDIDO
                    </button>`
                }
            </div>
        `).join('');
    }
    
    // Resto del código para pedidos activos...
    const containerActivos = document.getElementById("pedidosActivos");
    if(misPedidosActivos.length === 0) {
        containerActivos.innerHTML = '<div class="text-center text-gray-400 py-4"><i class="fas fa-check-circle text-2xl mb-1 block"></i>No hay pedidos activos</div>';
    } else {
        containerActivos.innerHTML = misPedidosActivos.map(p => {
            const esRecogido = p.estado === 'recogido';
            const estaAsignado = p.estado === 'asignado';
            
            return `
            <div class="bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm" data-pedido-id="${sanitizarHTML(p.id)}">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-bold text-[#FF6200]">#${sanitizarHTML(p.id)}</span>
                    <span class="text-xs px-2 py-1 rounded-full ${esRecogido ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}">
                        ${esRecogido ? '📦 Paquete recogido' : '🟡 En camino a recoger'}
                    </span>
                </div>
                <p class="text-sm"><i class="fas fa-circle text-green-500 text-xs mr-1"></i> <strong>Recoger en:</strong> ${sanitizarHTML(p.origen)}</p>
                <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> <strong>Entregar en:</strong> ${sanitizarHTML(p.destino)}</p>
                <p class="text-xs text-gray-500 mt-2">📏 ${sanitizarHTML(p.distanciaReal)} km • 💰 $${sanitizarHTML(p.tarifa)}</p>
                <p class="text-xs text-gray-500">👤 Cliente: ${sanitizarHTML(p.clienteNombre)}</p>
                <div class="mt-3 text-xs text-center text-gray-500">
                    <i class="fas fa-info-circle"></i> Debes completar este pedido antes de agarrar otro
                </div>
                ${estaAsignado ? 
                    `<button onclick="marcarPaqueteRecogido(${p.id})" class="w-full mt-3 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
                        <i class="fas fa-box-open mr-1"></i> 📦 MARCAR PAQUETE RECOGIDO
                    </button>` : 
                    (esRecogido ?
                    `<button onclick="completarPedido(${p.id})" class="w-full mt-3 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
                        <i class="fas fa-check-circle mr-1"></i> 🏁 MARCAR ENTREGADO
                    </button>` : '')
                }
            </div>
            `;
        }).join('');
    }
}

async function toggleOnline() {
    isOnline = !isOnline;
    const btn = document.getElementById("onlineToggle");
    const span = document.getElementById("onlineStatusText");
    
    if(isOnline) {
        // ✅ Cambiar UI inmediatamente (sin esperar)
        btn.classList.remove("bg-gray-500");
        btn.classList.add("bg-green-500", "hover:bg-green-600");
        span.innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
        mostrarToast("✅ Conectado - Buscando ubicación...");
        
        if(currentUser) {
            currentUser.online = true;
            localStorage.setItem('sesion_activa', JSON.stringify(currentUser));
            
            // ✅ No esperar a Supabase para continuar
            setDeliveryOnlineSupabase(currentUser.id, true).catch(console.error);
            
            // ✅ Obtener ubicación INMEDIATAMENTE
            if (userMarker) {
                const coords = userMarker.getLatLng();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, true);
                mostrarToast("📍 Ubicación compartida");
            } else {
                // ✅ Si no hay marcador, forzar obtención de ubicación
                setTimeout(() => {
                    if (!userMarker) {
                        startLocationTracking();
                    }
                }, 500);
            }
        }
        
        // ✅ Cargar pedidos inmediatamente (sin esperar throttling)
        await cargarPedidos(true);
        
        // ✅ Iniciar intervalo de actualización de ubicación (cada 8 segundos, no 4)
        if(ubicacionInterval) clearInterval(ubicacionInterval);
        ubicacionInterval = setInterval(async () => {
            if(userMarker && currentUser && isOnline && ultimaUbicacionEnviada) {
                await guardarUbicacionConThrottle(
                    currentUser.id, 
                    currentUser.nombre, 
                    ultimaUbicacionEnviada.lat, 
                    ultimaUbicacionEnviada.lng, 
                    true
                );
            }
        }, 8000); // ✅ Reducido de 4s a 8s
        
    } else {
        btn.classList.remove("bg-green-500", "hover:bg-green-600");
        btn.classList.add("bg-gray-500");
        span.innerHTML = 'Conectarse';
        mostrarToast("📴 Offline - No recibirás pedidos");
        
        if(currentUser) {
            currentUser.online = false;
            localStorage.setItem('sesion_activa', JSON.stringify(currentUser));
            
            setDeliveryOnlineSupabase(currentUser.id, false).catch(console.error);
            
            if (userMarker && ultimaUbicacionEnviada) {
                await guardarUbicacionEnSupabase(
                    currentUser.id, 
                    currentUser.nombre, 
                    ultimaUbicacionEnviada.lat, 
                    ultimaUbicacionEnviada.lng, 
                    false
                );
            }
        }
        if(ubicacionInterval) clearInterval(ubicacionInterval);
    }
    await actualizarColorMarcador();
}

async function verHistorial() {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("Error de conexión", true);
        return;
    }
    
    mostrarToast("📊 Cargando historial...");
    
    try {
        const { data: completados, error } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .eq('estado', 'completado')
            .order('fecha_completado', { ascending: false });
        
        if (error) throw error;
        
        let totalGanado = 0;
        if (completados && completados.length > 0) {
            completados.forEach(p => { totalGanado += p.tarifa; });
        }
        
        // Eliminar modal existente
        let modalExistente = document.getElementById("modalHistorialDelivery");
        if (modalExistente) modalExistente.remove();
        
        const modal = document.createElement('div');
        modal.id = "modalHistorialDelivery";
        modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[100000] p-2";
        modal.style.overflowY = "auto";
        
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-2xl max-w-md w-full mx-2 my-4 overflow-hidden" style="max-height: 90vh; display: flex; flex-direction: column;">
                <!-- Cabecera compacta -->
                <div class="bg-orange-500 p-3 flex justify-between items-center sticky top-0 z-10">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-history text-white text-xl"></i>
                        <div>
                            <h3 class="font-bold text-white text-base">Mi Historial</h3>
                            <p class="text-white/70 text-xs">Entregas completadas</p>
                        </div>
                    </div>
                    <button onclick="cerrarModalHistorialDelivery()" class="bg-black/30 rounded-full w-8 h-8 flex items-center justify-center active:bg-black/50">
                        <i class="fas fa-times text-white text-sm"></i>
                    </button>
                </div>
                
                <!-- Lista de entregas - scrollable -->
                <div class="overflow-y-auto p-3" style="flex: 1;">
                    ${!completados || completados.length === 0 ? `
                        <div class="text-center text-gray-400 py-8">
                            <i class="fas fa-box-open text-4xl mb-2 block opacity-50"></i>
                            <p class="text-sm">No hay entregas</p>
                        </div>
                    ` : `
                        <div class="space-y-2">
                            ${completados.map(p => `
                                <div class="bg-gray-700 rounded-xl p-3">
                                    <div class="flex justify-between items-start mb-1">
                                        <div class="flex items-center gap-2">
                                            <span class="font-mono text-orange-400 text-xs font-bold">#${sanitizarHTML(p.id.toString().slice(-8))}</span>
                                            <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">✅ Completo</span>
                                        </div>
                                        <span class="text-[10px] text-gray-400">${new Date(sanitizarHTML(p.fecha_completado) || sanitizarHTML(p.fecha)).toLocaleDateString()}</span>
                                    </div>
                                    
                                    <div class="flex items-start gap-1 my-1">
                                        <i class="fas fa-circle text-[8px] text-orange-500 mt-1"></i>
                                        <span class="text-xs text-gray-300 flex-1 line-clamp-1">${sanitizarHTML(p.origen || 'Origen')}</span>
                                    </div>
                                    
                                    <div class="flex items-start gap-1 mb-1">
                                        <i class="fas fa-square text-[8px] text-blue-500 mt-1"></i>
                                        <span class="text-xs text-gray-300 flex-1 line-clamp-1">${sanitizarHTML(p.destino || 'Destino')}</span>
                                    </div>
                                    
                                    <div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-600">
                                        <div class="flex gap-3">
                                            <span class="text-xs text-gray-400">📏 ${sanitizarHTML(p.distancia_real)} km</span>
                                            <span class="text-xs text-gray-400">💰 $${sanitizarHTML(p.tarifa)}</span>
                                        </div>
                                        <span class="text-[10px] text-gray-500 capitalize">${sanitizarHTML(p.tipo || 'paquete')}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
                
                <!-- Resumen fijo abajo -->
                <div class="border-t border-gray-700 p-3 bg-gray-800">
                    <div class="flex justify-between items-center bg-orange-500/10 rounded-xl p-2">
                        <div>
                            <span class="text-gray-400 text-xs">💰 Total ganado</span>
                            <div class="text-xl font-bold text-orange-500">$${totalGanado}</div>
                        </div>
                        <div class="text-right">
                            <span class="text-gray-400 text-xs">📦 Entregas</span>
                            <div class="text-xl font-bold text-white">${sanitizarHTML(completados?.length || 0)}</div>
                        </div>
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

function cerrarModalHistorialDelivery() {
    const modal = document.getElementById("modalHistorialDelivery");
    if (modal) modal.remove();
}

function verPerfil() {
    let modalExistente = document.getElementById("modalPerfilDelivery");
    if (modalExistente) modalExistente.remove();
    
    const modal = document.createElement('div');
    modal.id = "modalPerfilDelivery";
    modal.className = "fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-[100001] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-3xl max-w-sm w-full modal-uber">
            <div class="text-center pt-6 pb-3 border-b border-gray-700">
                <div class="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-3">
                    <i class="fas fa-user-circle text-white text-3xl"></i>
                </div>
                <h2 class="text-xl font-bold text-white">Mi Perfil</h2>
                <p class="text-gray-400 text-sm mt-1">Delivery Partner</p>
            </div>
            
            <div class="p-5 space-y-3">
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-user text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Nombre</div>
                        <div class="text-white font-medium">${sanitizarHTML(currentUser?.nombre || 'No disponible')}</div>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-envelope text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Correo electrónico</div>
                        <div class="text-white font-medium">${sanitizarHTML(currentUser?.email || 'No disponible')}</div>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-tag text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Rol</div>
                        <div class="text-white font-medium">
                            <span class="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full text-xs">Delivery</span>
                        </div>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-star text-yellow-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Calificación</div>
                        <div class="text-white font-medium">
                            <span class="text-yellow-400">★★★★☆</span> 4.9
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="px-5 pb-5">
                <button onclick="cerrarModalPerfilDelivery()" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all">
                    Cerrar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function cerrarModalPerfilDelivery() {
    const modal = document.getElementById("modalPerfilDelivery");
    if (modal) modal.remove();
}

// ==================== FUNCIÓN ACTUALIZAR ESTADÍSTICAS CORREGIDA ====================
async function actualizarEstadisticas() {
    const supabase = supabaseClient;
    if (!supabase || !currentUser) {
        console.log("❌ No se pueden actualizar estadísticas: supabase o usuario no disponible");
        return;
    }
    
    try {
        console.log("📊 Actualizando estadísticas para delivery:", currentUser.id);
        
        // Obtener todos los pedidos completados por este delivery
        const { data: completados, error } = await supabase
            .from('pedidos')
            .select('tarifa, estado')
            .eq('delivery_id', currentUser.id)
            .eq('estado', 'completado');
        
        if (error) throw error;
        
        const totalEntregas = completados?.length || 0;
        const totalGanado = completados?.reduce((sum, p) => sum + (p.tarifa || 0), 0) || 0;
        
        // Actualizar elementos del DOM
        const totalEntregasEl = document.getElementById("totalEntregas");
        const totalGanadoEl = document.getElementById("totalGanado");
        
        if (totalEntregasEl) {
            totalEntregasEl.innerText = sanitizarHTML(String(totalEntregas));
            console.log(`✅ Total entregas actualizado: ${sanitizarHTML(totalEntregas)}`);
        } else {
            console.warn("⚠️ Elemento totalEntregas no encontrado");
        }
        
        if (totalGanadoEl) {
            totalGanadoEl.innerText = sanitizarHTML(String(totalGanado));
            console.log(`✅ Total ganado actualizado: ${sanitizarHTML(totalGanado)}`);
        } else {
            console.warn("⚠️ Elemento totalGanado no encontrado");
        }
        
        // También actualizar calificación si quieres (simulada por ahora)
        const calificacionEl = document.getElementById("calificacion");
        if (calificacionEl) {
            // Podrías calcular calificación real desde una tabla 'calificaciones'
            calificacionEl.innerText = "4.9";
        }
        
    } catch(e) {
        console.error('❌ Error actualizando estadísticas:', e);
    }
}

// ==================== MODAL DE CONFIRMACIÓN ====================
function mostrarModalConfirmacionDelivery(titulo, mensaje, onConfirm, onCancel) {
    return new Promise((resolve) => {
        // Eliminar modal existente si hay
        const modalExistente = document.getElementById("modalConfirmacionDelivery");
        if (modalExistente) modalExistente.remove();
        
        const modal = document.createElement('div');
        modal.id = "modalConfirmacionDelivery";
        modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[100000] p-4";
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-3xl max-w-sm w-full modal-uber text-center p-6">
                <div class="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fas fa-motorcycle text-3xl text-orange-500"></i>
                </div>
                <h3 class="text-xl font-bold text-white mb-2">${sanitizarHTML(titulo)}</h3>
                <p class="text-gray-400 text-sm mb-6">${sanitizarHTML(mensaje)}</p>
                <div class="flex gap-3">
                    <button id="btnCancelarConfirm" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl transition-all font-medium">
                        Cancelar
                    </button>
                    <button id="btnAceptarConfirm" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl transition-all font-medium">
                        <i class="fas fa-hand-paper mr-2"></i>Aceptar
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById("btnAceptarConfirm").onclick = () => {
            modal.remove();
            if (onConfirm) onConfirm();
            resolve(true);  // ✅ IMPORTANTE: resolver la Promise
        };
        
        document.getElementById("btnCancelarConfirm").onclick = () => {
            modal.remove();
            if (onCancel) onCancel();
            resolve(false); // ✅ IMPORTANTE: resolver la Promise
        };
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                if (onCancel) onCancel();
                resolve(false);
            }
        });
    });
}

async function actualizarColorMarcador() {
    if (!userMarker || !currentUser) return;
    
    const tienePedido = await deliveryTienePedidoActivo(currentUser.id);

    let color;
    let estadoTexto;
    
    if (tienePedido) {
        color = '#FF6200';
        estadoTexto = '🟠 En una entrega';
    } else {
        color = '#10B981';
        estadoTexto = '🟢 Disponible';
    }
    
    const nombreMostrar = obtenerPrimerNombre(currentUser.nombre);
    
    const nuevoIcono = L.divIcon({
        html: `
            <div style="text-align: center;">
                <div style="
                    background: rgba(0, 0, 0, 0.85);
                    color: white;
                    font-size: 11px;
                    font-weight: bold;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    padding: 3px 8px;
                    border-radius: 14px;
                    margin-bottom: 4px;
                    white-space: nowrap;
                    display: inline-block;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                    border: 0.5px solid rgba(255,255,255,0.2);
                ">
                    ${sanitizarHTML(nombreMostrar)}
                </div>
                <div style="
                    background: ${sanitizarHTML(color)};
                    width: 34px;
                    height: 34px;
                    border-radius: 50%;
                    border: 2.5px solid white;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto;
                ">
                    <i class="fas fa-motorcycle" style="color:white; font-size:18px;"></i>
                </div>
            </div>
        `,
        iconSize: [50, 60],
        className: 'moto-marker',
        popupAnchor: [0, -25]
    });
    
    userMarker.setIcon(nuevoIcono);
    userMarker.setPopupContent(`🏍️ <b>${sanitizarHTML(currentUser.nombre)}</b><br>${estadoTexto}`);
    console.log(`🎨 Marcador actualizado: ${sanitizarHTML(tienePedido ? 'NARANJA' : 'VERDE')} - ${sanitizarHTML(nombreMostrar)}`);
}

async function actualizarEstadoYColor() { await actualizarColorMarcador();}

// ==================== LIMPIAR RECURSOS AL CERRAR PESTAÑA (DELIVERY) ====================
function limpiarIntervalosDelivery() {
    console.log("🧹 Limpiando todos los recursos del delivery...");

    // Limpiar intervalos
    if (ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
    }
    
    if (cargaPedidosInterval) {
        clearInterval(cargaPedidosInterval);
        cargaPedidosInterval = null;
    }

    // Limpiar geolocalización
    if (watchId) {
        try {
            navigator.geolocation.clearWatch(watchId);
        } catch (e) {
            console.warn("Error al limpiar watchPosition:", e);
        }
        watchId = null;
    }

    // Limpiar rutas y marcadores del mapa
    limpiarRutasYMarcadores();

    // Actualizar estado offline en Supabase (solo si es necesario)
    if (currentUser && supabaseClient) {
        // Siempre marcar como offline al cerrar
        setDeliveryOnlineSupabase(currentUser.id, false)
            .catch(err => console.warn("No se pudo actualizar estado offline:", err));

        // Guardar última ubicación como offline
        if (userMarker && typeof userMarker.getLatLng === 'function') {
            try {
                const coords = userMarker.getLatLng();
                if (coords) {
                    guardarUbicacionEnSupabase(
                        currentUser.id, 
                        currentUser.nombre, 
                        coords.lat, 
                        coords.lng, 
                        false
                    ).catch(err => console.warn("Error guardando última ubicación:", err));
                }
            } catch (e) {
                console.warn("Error obteniendo coords del marcador:", e);
            }
        }
    }

    console.log("✅ Recursos de delivery liberados correctamente");
}

// ==================== EVENTOS DE CIERRE DE PÁGINA ====================

// Limpieza al intentar cerrar/recargar la pestaña
window.addEventListener('beforeunload', function(e) {
    console.log("🚪 Delivery: pestaña cerrando o recargando...");
    limpiarIntervalosDelivery();
});

// Mejor alternativa moderna a 'unload'
window.addEventListener('pagehide', function() {
    console.log("💀 Delivery: página ocultada o descargada (pagehide)");
    limpiarIntervalosDelivery();
});

// Opcional: Visibilidad de la página (muy útil)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log("📴 Delivery: pestaña en segundo plano");
        // Aquí podrías pausar algunos intervalos menos críticos
    } else {
        console.log("🟢 Delivery: pestaña visible nuevamente");
        if (isOnline) {
            // Reactivar actualizaciones
            cargarPedidos();
        }
    }
});

// ==================== ROTACIÓN DEL MAPA (2D) ====================
function rotateMapLeft() {
    if (!map) return;
    mapRotationAngle = (mapRotationAngle - 45) % 360;
    applyMapRotationDelivery();
    mostrarToast(`🧭 Mapa girado ${sanitizarHTML(mapRotationAngle)}°`);
}

function rotateMapRight() {
    if (!map) return;
    mapRotationAngle = (mapRotationAngle + 45) % 360;
    applyMapRotationDelivery();
    mostrarToast(`🧭 Mapa girado ${sanitizarHTML(mapRotationAngle)}°`);
}

function resetMapRotation() {
    if (!map) return;
    mapRotationAngle = 0;
    applyMapRotationDelivery();
    mostrarToast("🧭 Orientación restablecida");
}

function applyMapRotationDelivery() {
    const mapContainer = map.getContainer();
    const currentCenter = map.getCenter();
    
    mapContainer.style.transform = `rotate(${sanitizarHTML(mapRotationAngle)}deg)`;
    mapContainer.style.transition = 'transform 0.4s ease';
    
    if (mapRotationAngle !== 0) {
        mapContainer.style.width = '150%';
        mapContainer.style.height = '150%';
        mapContainer.style.margin = '-25%';
    } else {
        mapContainer.style.width = '100%';
        mapContainer.style.height = '100%';
        mapContainer.style.margin = '0';
    }
    
    // Rotar marcadores
    if (userMarker && typeof userMarker.setRotationAngle === 'function') {
        userMarker.setRotationAngle(mapRotationAngle);
    }
    if (recogidaMarker && typeof recogidaMarker.setRotationAngle === 'function') {
        recogidaMarker.setRotationAngle(mapRotationAngle);
    }
    if (destinoMarker && typeof destinoMarker.setRotationAngle === 'function') {
        destinoMarker.setRotationAngle(mapRotationAngle);
    }
    
    setTimeout(() => {
        map.invalidateSize();
        map.setView(currentCenter);
    }, 80);
}

function actualizarRotacionMarcadores() {
    if (userMarker && typeof userMarker.setRotationAngle === 'function') {
        userMarker.setRotationAngle(mapRotationAngle);
    }
    if (recogidaMarker && typeof recogidaMarker.setRotationAngle === 'function') {
        recogidaMarker.setRotationAngle(mapRotationAngle);
    }
    if (destinoMarker && typeof destinoMarker.setRotationAngle === 'function') {
        destinoMarker.setRotationAngle(mapRotationAngle);
    }
}

// ==================== EXPORTAR FUNCIONES GLOBALMENTE ====================
window.centrarMapa = centrarMapa;
window.rotateMapLeft = rotateMapLeft;
window.rotateMapRight = rotateMapRight;
window.resetMapRotation = resetMapRotation;
window.toggleOnline = toggleOnline;
window.verHistorial = verHistorial;
window.verPerfil = verPerfil;
window.cerrarSesion = cerrarSesion;
window.seleccionarPedido = seleccionarPedido;
window.agarrarPedido = agarrarPedido;
window.marcarPaqueteRecogido = marcarPaqueteRecogido;
window.completarPedido = completarPedido;
window.cerrarModalHistorialDelivery = cerrarModalHistorialDelivery;
window.mostrarModalConfirmacionDelivery = mostrarModalConfirmacionDelivery; // ← Mantener exportación
window.cerrarModalPerfilDelivery = cerrarModalPerfilDelivery;
window.limpiarIntervalosDelivery = limpiarIntervalosDelivery;