// delivery.js - VERSIÓN CORREGIDA

// Constantes y variables globales
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

let map, userMarker;
let currentUser = null, isOnline = false;
let pedidosDisponibles = [], misPedidosActivos = [];
let pedidoSeleccionado = null;
let watchId = null;
let ubicacionInterval = null;
let cargaPedidosInterval = null;
let ultimaUbicacionEnviada = null;
let primeraUbicacionObtenida = false;

// ==================== NUEVAS VARIABLES PARA RUTAS (MapLibre) ====================
let currentRouteLayerId = 'delivery-route';
let ultimoPedidoDibujado = null;
let ultimaEtapa = null;
let ultimaPeticionPedidos = 0;
let paginaVisible = true;

// ==================== FUNCIÓN CONVERTIR PEDIDO (DEBE IR ANTES DE CARGAR PEDIDOS) ====================
function convertirPedidoDeSupabase(pedido) {
    return {
        id: pedido.id,
        clienteId: pedido.cliente_id,
        clienteNombre: pedido.cliente_nombre,
        origen: pedido.origen,
        destino: pedido.destino,
        origenCoords: pedido.origen_lat ? { lat: pedido.origen_lat, lng: pedido.origen_lng } : null,
        destinoCoords: pedido.destino_lat ? { lat: pedido.destino_lat, lng: pedido.destino_lng } : null,
        distanciaReal: pedido.distancia_real,
        tarifa: pedido.tarifa,
        estado: pedido.estado,
        tipo: pedido.tipo
    };
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

// ==================== INICIALIZACIÓN CON MAPLIBRE ====================
function initMap() {
    if (map) {
        console.log("⚠️ Mapa ya inicializado");
        return;
    }
    
    console.log("🗺️ Creando mapa...");
    
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
        zoom: 14,
        minZoom: 12,
        maxZoom: 17
    });
    
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    
    // Limitar movimiento sin recursión
    let ajustandoBounds = false;
    map.on('move', () => {
        if (ajustandoBounds) return;
        
        const center = map.getCenter();
        const lng = center.lng;
        const lat = center.lat;
        
        if (lng < -91.88 || lng > -91.75 || lat < 18.58 || lat > 18.70) {
            ajustandoBounds = true;
            map.setCenter([-91.8249, 18.6456]);
            setTimeout(() => { ajustandoBounds = false; }, 100);
        }
    });
    
    // Cuando el mapa esté completamente cargado, iniciar tracking
    map.on('load', () => {
        console.log('✅ Mapa Delivery MapLibre cargado');
        // Iniciar seguimiento de ubicación DESPUÉS de que el mapa esté cargado
        setTimeout(() => {
            startLocationTracking();
        }, 500);
        cargarPedidos();
    });
    
    // También intentar cuando el estilo esté cargado
    map.on('styledata', () => {
        if (map.isStyleLoaded() && !window._trackingStarted) {
            window._trackingStarted = true;
            console.log("🎨 Estilo cargado, iniciando tracking...");
            setTimeout(() => {
                startLocationTracking();
            }, 500);
        }
    });
    
    console.log("✅ Mapa inicializado");
}

// ==================== LIMPIAR RUTA ====================
function limpiarRutaDelivery() {
    if (!map) return;
    
    try {
        if (map.getLayer(currentRouteLayerId)) {
            map.removeLayer(currentRouteLayerId);
        }
        if (map.getSource(currentRouteLayerId)) {
            map.removeSource(currentRouteLayerId);
        }
    } catch(e) {}
}

// ==================== DIBUJAR RUTA CON MAPLIBRE + OSRM ====================
async function dibujarRutaDelivery(origin, dest, color, weight = 5) {
    if (!map || !origin || !dest) return null;
    
    limpiarRutaDelivery();
    
    try {
        const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`
        );
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            
            map.addSource(currentRouteLayerId, {
                type: 'geojson',
                data: route.geometry
            });
            
            map.addLayer({
                id: currentRouteLayerId,
                type: 'line',
                source: currentRouteLayerId,
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
            
            // Ajustar bounds
            const bounds = new maplibregl.LngLatBounds()
                .extend([origin.lng, origin.lat])
                .extend([dest.lng, dest.lat]);
            map.fitBounds(bounds, { padding: 50 });
            
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

// ==================== RUTA DE RECOGIDA ====================
async function dibujarRutaRecogida(pedido) {
    if (ultimoPedidoDibujado === pedido.id && ultimaEtapa === 'recogida') {
        console.log("🟢 Ruta de recogida ya activa");
        return;
    }
    
    if (!pedido.origenCoords) {
        mostrarToast("❌ No hay coordenadas de origen", true);
        return;
    }
    
    let ubicacionActual = null;
    if (userMarker) {
        const lngLat = userMarker.getLngLat();
        ubicacionActual = { lat: lngLat.lat, lng: lngLat.lng };
    }
    
    if (ubicacionActual) {
        await dibujarRutaDelivery(ubicacionActual, pedido.origenCoords, '#10B981', 6);
    } else {
        const bounds = new maplibregl.LngLatBounds()
            .extend([pedido.origenCoords.lng, pedido.origenCoords.lat]);
        map.fitBounds(bounds, { padding: 50 });
    }
    
    ultimoPedidoDibujado = pedido.id;
    ultimaEtapa = 'recogida';
    mostrarToast(`📍 Ruta de RECOGIDA - Dirígete a: ${pedido.origen}`);
}

// ==================== RUTA DE ENTREGA ====================
async function dibujarRutaEntrega(pedido) {
    if (ultimoPedidoDibujado === pedido.id && ultimaEtapa === 'entrega') {
        console.log("🟢 Ruta de entrega ya activa");
        return;
    }
    
    if (!pedido.origenCoords || !pedido.destinoCoords) {
        console.error("❌ Faltan coordenadas para ruta de entrega");
        mostrarToast("❌ No se pueden dibujar coordenadas de destino", true);
        return;
    }
    
    await dibujarRutaDelivery(pedido.origenCoords, pedido.destinoCoords, '#FF6200', 6);
    
    ultimoPedidoDibujado = pedido.id;
    ultimaEtapa = 'entrega';
    mostrarToast(`🚚 Ruta de ENTREGA - Desde ${pedido.origen} hasta ${pedido.destino}`);
}

// ==================== RUTA ÓPTIMA PARA PEDIDO SELECCIONADO ====================
async function dibujarRutaOptimaPedido(pedido) {
    if (pedido.origenCoords && pedido.destinoCoords) {
        await dibujarRutaDelivery(pedido.origenCoords, pedido.destinoCoords, '#FF6200', 5);
        mostrarToast(`📏 Distancia: ${pedido.distanciaReal} km • 💰 $${pedido.tarifa}`);
    }
}

// ==================== INICIAR SEGUIMIENTO DE UBICACIÓN ====================
function startLocationTracking() {
    // Esperar a que el mapa esté completamente cargado
    if (!map) {
        console.log("⏳ Esperando a que el mapa esté listo...");
        setTimeout(() => startLocationTracking(), 500);
        return;
    }
    
    // Verificar que el mapa tenga el método addLayer (está completamente cargado)
    if (!map.addLayer) {
        console.log("⏳ Mapa no completamente cargado, esperando...");
        setTimeout(() => startLocationTracking(), 500);
        return;
    }
    
    console.log("📍 Iniciando seguimiento de ubicación...");
    
    if ("geolocation" in navigator) {
        const options = {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        };
        
        // Obtener ubicación inicial
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                console.log("📍 Ubicación inicial obtenida:", coords);
                ultimaUbicacionEnviada = coords;
                
                // Verificar que map existe antes de agregar el marcador
                if (!map) {
                    console.error("❌ Mapa no disponible para crear marcador");
                    return;
                }
                
                // Crear marcador directamente
                const html = `
                    <div style="text-align: center;">
                        <div style="background:rgba(0,0,0,0.85); color:white; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:14px; margin-bottom:4px; white-space:nowrap;">
                            ${currentUser?.nombre || 'Delivery'}
                        </div>
                        <div style="background:#10B981; width:38px; height:38px; border-radius:50%; border:3px solid white; display:flex; align-items:center; justify-content:center;">
                            <i class="fas fa-motorcycle" style="color:white; font-size:20px;"></i>
                        </div>
                    </div>
                `;
                
                const div = document.createElement('div');
                div.innerHTML = html;
                const markerElement = div.firstChild;
                
                try {
                    userMarker = new maplibregl.Marker({ element: markerElement, draggable: false })
                        .setLngLat([coords.lng, coords.lat])
                        .addTo(map);
                    
                    const popup = new maplibregl.Popup({ offset: [0, -35] })
                        .setHTML(`🏍️ <b>${currentUser?.nombre}</b><br>🟢 Disponible`);
                    userMarker.setPopup(popup);
                    
                    map.setCenter([coords.lng, coords.lat]);
                    map.setZoom(15);
                    mostrarToast("📍 Ubicación detectada");
                    
                    if (currentUser && isOnline) {
                        await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, true);
                    }
                } catch(e) {
                    console.error("❌ Error creando marcador:", e);
                }
            },
            (err) => {
                console.error("Error en ubicación inicial:", err);
                if (err.code === 1) {
                    mostrarToast("❌ Permite el acceso a tu ubicación en el navegador", true);
                }
            },
            options
        );
        
        // Watch continuo
        if (watchId) navigator.geolocation.clearWatch(watchId);
        
        watchId = navigator.geolocation.watchPosition(
            async (pos) => {
                const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                
                if (ultimaUbicacionEnviada) {
                    const R = 6371;
                    const dLat = (coords.lat - ultimaUbicacionEnviada.lat) * Math.PI / 180;
                    const dLon = (coords.lng - ultimaUbicacionEnviada.lng) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                              Math.cos(ultimaUbicacionEnviada.lat * Math.PI / 180) * Math.cos(coords.lat * Math.PI / 180) *
                              Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const distanciaMetros = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1000;
                    if (distanciaMetros < 15) return;
                }
                
                ultimaUbicacionEnviada = coords;
                
                if (userMarker) {
                    try {
                        userMarker.setLngLat([coords.lng, coords.lat]);
                    } catch(e) {
                        console.error("Error actualizando marcador:", e);
                    }
                }
                
                if (currentUser && isOnline) {
                    await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, true);
                }
            },
            (err) => console.error("Error GPS:", err),
            options
        );
        
        mostrarToast("🟢 Buscando tu ubicación...");
    } else {
        mostrarToast("⚠️ Tu navegador no soporta geolocalización", true);
    }
}

// ==================== LOAD USER ====================
function loadUser() {
    const sesion = localStorage.getItem('sesion_activa');
    if (!sesion) { window.location.href = "index.html"; return; }
    currentUser = JSON.parse(sesion);
    if (currentUser.rol !== 'delivery') { window.location.href = "cliente.html"; return; }
    isOnline = currentUser.online === true;
    
    const userInfoDiv = document.getElementById("userInfo");
    if (userInfoDiv) {
        userInfoDiv.innerHTML = `
            <div class="flex items-center gap-2">
                <i class="fas fa-motorcycle text-[#FF6200] text-xl"></i>
                <span class="font-medium">${currentUser.nombre}</span>
                <span class="text-gray-400 text-xs">(Delivery)</span>
            </div>
            <div class="text-xs text-gray-500 mt-1">
                <i class="fas fa-star text-yellow-500"></i> Calificación: 4.9
            </div>
            <div id="estadoDeliveryBadge" class="mt-2 text-xs"></div>
        `;
    }
    
    if (isOnline) {
        const onlineToggle = document.getElementById("onlineToggle");
        if (onlineToggle) {
            onlineToggle.classList.remove("bg-gray-500");
            onlineToggle.classList.add("bg-green-500");
        }
        const statusText = document.getElementById("onlineStatusText");
        if (statusText) statusText.innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
        setTimeout(() => actualizarColorMarcador(), 1000);
    }
    cargarPedidos();
}

// ==================== ACTUALIZAR BADGE ESTADO ====================
async function actualizarBadgeEstado() {
    if (!currentUser) return;
    
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

// ==================== ACTUALIZAR COLOR MARCADOR ====================
async function actualizarColorMarcador() {
    if (!userMarker || !currentUser) return;
    
    const tienePedido = await deliveryTienePedidoActivo(currentUser.id);
    const color = tienePedido ? '#FF6200' : '#10B981';
    const estadoTexto = tienePedido ? '🟠 En una entrega' : '🟢 Disponible';
    
    const lngLat = userMarker.getLngLat();
    const lat = lngLat.lat;
    const lng = lngLat.lng;
    
    userMarker.remove();
    
    const html = `
        <div style="text-align: center;">
            <div style="background:rgba(0,0,0,0.85); color:white; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:14px; margin-bottom:4px; white-space:nowrap;">
                ${currentUser.nombre}
            </div>
            <div style="background:${color}; width:38px; height:38px; border-radius:50%; border:3px solid white; display:flex; align-items:center; justify-content:center;">
                <i class="fas fa-motorcycle" style="color:white; font-size:20px;"></i>
            </div>
        </div>
    `;
    
    const div = document.createElement('div');
    div.innerHTML = html;
    
    userMarker = new maplibregl.Marker({ element: div.firstChild, draggable: false })
        .setLngLat([lng, lat])
        .addTo(map);
    
    const popup = new maplibregl.Popup({ offset: [0, -35] })
        .setHTML(`🏍️ <b>${currentUser.nombre}</b><br>${estadoTexto}`);
    userMarker.setPopup(popup);
}

// ==================== CENTRAR MAPA ====================
function centrarMapa() {
    if (map) {
        map.setCenter([-91.8249, 18.6456]);
        map.setZoom(13);
    }
    mostrarToast("📍 Mapa centrado en Ciudad del Carmen");
}

// ==================== CARGAR PEDIDOS ====================
async function cargarPedidos(force = false) {
    if (!force && !paginaVisible) {
        console.log("📴 Página oculta, no se cargan pedidos");
        return;
    }
    
    const ahora = Date.now();
    if (!force && (ahora - ultimaPeticionPedidos < 5000)) {
        console.log(`⏳ Throttling: cargarPedidos - demasiado rápido`);
        return;
    }
    ultimaPeticionPedidos = ahora;
    
    const supabase = supabaseClient;
    if (!supabase) {
        console.error('Supabase no disponible');
        return;
    }
    
    try {
        const { data: pedidosPendientes, error: errorPendientes } = await supabase
            .from('pedidos')
            .select('*')
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: true });
        
        if (errorPendientes) throw errorPendientes;
        
        const { data: pedidosAsignados, error: errorAsignados } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .in('estado', ['asignado', 'recogido'])
            .order('fecha', { ascending: true });
        
        if (errorAsignados) throw errorAsignados;
        
        const nuevosDisponibles = (pedidosPendientes || []).map(p => convertirPedidoDeSupabase(p));
        const nuevosActivos = (pedidosAsignados || []).map(p => convertirPedidoDeSupabase(p));
        
        const estadoAnteriorActivo = misPedidosActivos.length > 0 ? misPedidosActivos[0]?.estado : null;
        
        pedidosDisponibles = nuevosDisponibles;
        misPedidosActivos = nuevosActivos;
        
        actualizarListaPedidos();
        
        if (misPedidosActivos.length > 0) {
            const pedidoActivo = misPedidosActivos[0];
            const estadoActual = pedidoActivo.estado;
            
            if (estadoAnteriorActivo === 'asignado' && estadoActual === 'recogido') {
                await dibujarRutaEntrega(pedidoActivo);
            } else if (estadoActual === 'recogido' && ultimaEtapa !== 'entrega') {
                await dibujarRutaEntrega(pedidoActivo);
            } else if (estadoActual === 'asignado' && ultimaEtapa !== 'recogida') {
                await dibujarRutaRecogida(pedidoActivo);
            }
        } else {
            limpiarRutaDelivery();
            if (pedidoSeleccionado) {
                dibujarRutaOptimaPedido(pedidoSeleccionado);
            }
        }
        
        await actualizarColorMarcador();
        await actualizarBadgeEstado();
        
        console.log(`📦 ${pedidosDisponibles.length} pedidos disponibles, ${misPedidosActivos.length} activos`);
        
    } catch(e) {
        console.error('Error cargando pedidos:', e);
    }
}

// ==================== SELECCIONAR PEDIDO ====================
function seleccionarPedido(pedidoId) {
    pedidoSeleccionado = pedidosDisponibles.find(p => p.id === pedidoId);
    limpiarRutaDelivery();
    if (pedidoSeleccionado) {
        dibujarRutaOptimaPedido(pedidoSeleccionado);
    }
    actualizarListaPedidos();
    mostrarToast(`📍 Pedido #${pedidoId} seleccionado - Ruta mostrada en mapa`);
}

// ==================== AGARRAR PEDIDO ====================
async function agarrarPedido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    mostrarToast("🔍 Verificando disponibilidad...");
    
    try {
        const tienePedidoActivo = await deliveryTienePedidoActivo(currentUser.id);
        
        if (tienePedidoActivo) {
            const pedidoActivo = await getPedidoActivoDelDelivery(currentUser.id);
            mostrarToast(`❌ Ya tienes un pedido activo (#${pedidoActivo?.id}). Complétalo primero.`, true);
            return;
        }
        
        const { data: pedidoActual, error: errorPedido } = await supabase
            .from('pedidos')
            .select('estado')
            .eq('id', pedidoId)
            .single();
        
        if (errorPedido) throw errorPedido;
        
        if (pedidoActual.estado !== 'pendiente') {
            mostrarToast(`❌ El pedido #${pedidoId} ya no está disponible`, true);
            await cargarPedidos(true);
            return;
        }
        
        const confirmado = await mostrarModalConfirmacionDelivery(
            "Confirmar pedido",
            `¿Seguro que quieres AGARRAR el pedido #${pedidoId}?`
        );
        
        if (!confirmado) {
            mostrarToast("❌ Acción cancelada");
            return;
        }
        
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'asignado',
                delivery_id: currentUser.id,
                delivery_nombre: currentUser.nombre,
                fecha_asignado: new Date().toISOString()
            })
            .eq('id', pedidoId)
            .eq('estado', 'pendiente');
        
        if (error) throw error;
        
        mostrarToast(`✅ Pedido #${pedidoId} AGARRADO! Dirígete al origen.`);
        
        pedidoSeleccionado = null;
        await cargarPedidos(true);
        await actualizarColorMarcador();
        
        const pedidoAsignado = misPedidosActivos.find(p => p.id === pedidoId);
        if (pedidoAsignado) {
            await dibujarRutaRecogida(pedidoAsignado);
            setTimeout(() => {
                if (pedidoAsignado.origenCoords) {
                    map.setCenter([pedidoAsignado.origenCoords.lng, pedidoAsignado.origenCoords.lat]);
                    map.setZoom(14);
                }
            }, 500);
        }
        
    } catch(e) {
        console.error('Error agarrando pedido:', e);
        mostrarToast("❌ Error al agarrar el pedido", true);
    }
}

// ==================== MARCAR PAQUETE RECOGIDO ====================
async function marcarPaqueteRecogido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    mostrarToast("📦 Actualizando estado del paquete...");
    
    try {
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'recogido',
                paquete_recogido_en: new Date().toISOString()
            })
            .eq('id', pedidoId);
        
        if (error) throw error;
        
        mostrarToast(`✅ ¡Paquete #${pedidoId} RECOGIDO! Ahora dirígete al destino.`);
        
        await cargarPedidos(true);
        
        const pedidoActualizado = misPedidosActivos.find(p => p.id === pedidoId);
        if (pedidoActualizado && pedidoActualizado.estado === 'recogido') {
            await dibujarRutaEntrega(pedidoActualizado);
            await actualizarColorMarcador();
        }
        
    } catch(e) {
        console.error('Error marcando paquete recogido:', e);
        mostrarToast("❌ Error al registrar la recogida", true);
    }
}

// ==================== COMPLETAR PEDIDO ====================
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
        
        mostrarToast(`✅ Pedido #${pedidoId} ENTREGADO! Ganaste $${pedido?.tarifa || 0} MXN`);
        
        limpiarRutaDelivery();
        
        if (ubicacionInterval) {
            clearInterval(ubicacionInterval);
            ubicacionInterval = null;
        }
        
        ultimoPedidoDibujado = null;
        ultimaEtapa = null;
        
        await cargarPedidos(true);
        await actualizarColorMarcador();
        await actualizarBadgeEstado();
        
        setTimeout(() => {
            cargarPedidos(true);
        }, 1000);
        
    } catch(e) {
        console.error('Error completando pedido:', e);
        mostrarToast("❌ Error al completar el pedido", true);
    }
}

// ==================== TOGGLE ONLINE ====================
async function toggleOnline() {
    isOnline = !isOnline;
    const btn = document.getElementById("onlineToggle");
    const span = document.getElementById("onlineStatusText");
    
    if (isOnline) {
        btn.classList.remove("bg-gray-500");
        btn.classList.add("bg-green-500", "hover:bg-green-600");
        span.innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
        mostrarToast("✅ Estás en línea - Los clientes verán que estás disponible");
        
        if (currentUser) {
            currentUser.online = true;
            localStorage.setItem('sesion_activa', JSON.stringify(currentUser));
            await setDeliveryOnlineSupabase(currentUser.id, true);
            
            if (userMarker) {
                const { lng, lat } = userMarker.getLngLat();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, lat, lng, true);
            }
        }
        cargarPedidos(true);
        
        if (ubicacionInterval) clearInterval(ubicacionInterval);
        ubicacionInterval = setInterval(async () => {
            if (userMarker && currentUser && isOnline) {
                const { lng, lat } = userMarker.getLngLat();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, lat, lng, true);
            }
        }, 4000);
    } else {
        btn.classList.remove("bg-green-500", "hover:bg-green-600");
        btn.classList.add("bg-gray-500");
        span.innerHTML = 'Conectarse';
        mostrarToast("📴 Estás offline - No recibirás pedidos");
        
        if (currentUser) {
            currentUser.online = false;
            localStorage.setItem('sesion_activa', JSON.stringify(currentUser));
            await setDeliveryOnlineSupabase(currentUser.id, false);
            
            if (userMarker) {
                const { lng, lat } = userMarker.getLngLat();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, lat, lng, false);
            }
        }
        if (ubicacionInterval) clearInterval(ubicacionInterval);
    }
    await actualizarColorMarcador();
}

// ==================== ACTUALIZAR LISTA DE PEDIDOS (UI) ====================
function actualizarListaPedidos() {
    const containerDisponibles = document.getElementById("pedidosDisponibles");
    const containerActivos = document.getElementById("pedidosActivos");
    const tienePedidoActivo = misPedidosActivos.length > 0;
    
    if (containerDisponibles) {
        if (pedidosDisponibles.length === 0) {
            containerDisponibles.innerHTML = '<div class="text-center text-gray-400 py-8"><i class="fas fa-box-open text-4xl mb-2 block"></i>No hay pedidos disponibles</div>';
        } else {
            containerDisponibles.innerHTML = pedidosDisponibles.map(p => `
                <div class="bg-white border rounded-xl p-4 shadow-sm pedido-card ${pedidoSeleccionado?.id === p.id ? 'pedido-seleccionado' : ''}" onclick="seleccionarPedido(${p.id})">
                    <div class="flex justify-between items-start mb-2">
                        <span class="font-bold text-[#FF6200]">#${p.id}</span>
                        <span class="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">Pendiente</span>
                    </div>
                    <p class="text-sm"><i class="fas fa-circle text-[#FF6200] text-xs mr-1"></i> ${p.origen}</p>
                    <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> ${p.destino}</p>
                    <p class="text-xs text-gray-500 mt-2">📏 ${p.distanciaReal} km • 💰 $${p.tarifa}</p>
                    <p class="text-xs text-gray-500">👤 Cliente: ${p.clienteNombre}</p>
                    ${tienePedidoActivo ? 
                        `<button disabled class="w-full mt-3 bg-gray-400 cursor-not-allowed text-white py-2 rounded-lg text-sm font-medium transition-all">
                            <i class="fas fa-lock mr-1"></i> Completar pedido actual primero
                        </button>` :
                        `<button onclick="event.stopPropagation(); agarrarPedido(${p.id})" class="w-full mt-3 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
                            <i class="fas fa-hand-paper mr-1"></i> AGARRAR PEDIDO
                        </button>`
                    }
                </div>
            `).join('');
        }
    }
    
    if (containerActivos) {
        if (misPedidosActivos.length === 0) {
            containerActivos.innerHTML = '<div class="text-center text-gray-400 py-4"><i class="fas fa-check-circle text-2xl mb-1 block"></i>No hay pedidos activos</div>';
        } else {
            containerActivos.innerHTML = misPedidosActivos.map(p => {
                const esRecogido = p.estado === 'recogido';
                const estaAsignado = p.estado === 'asignado';
                
                return `
                <div class="bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm" data-pedido-id="${p.id}">
                    <div class="flex justify-between items-start mb-2">
                        <span class="font-bold text-[#FF6200]">#${p.id}</span>
                        <span class="text-xs px-2 py-1 rounded-full ${esRecogido ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}">
                            ${esRecogido ? '📦 Paquete recogido' : '🟡 En camino a recoger'}
                        </span>
                    </div>
                    <p class="text-sm"><i class="fas fa-circle text-green-500 text-xs mr-1"></i> <strong>Recoger en:</strong> ${p.origen}</p>
                    <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> <strong>Entregar en:</strong> ${p.destino}</p>
                    <p class="text-xs text-gray-500 mt-2">📏 ${p.distanciaReal} km • 💰 $${p.tarifa}</p>
                    <p class="text-xs text-gray-500">👤 Cliente: ${p.clienteNombre}</p>
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
    
    // Sincronizar mobile
    const containerDisponiblesMobile = document.getElementById("pedidosDisponiblesMobile");
    const containerActivosMobile = document.getElementById("pedidosActivosMobile");
    if (containerDisponiblesMobile) containerDisponiblesMobile.innerHTML = containerDisponibles?.innerHTML || '';
    if (containerActivosMobile) containerActivosMobile.innerHTML = containerActivos?.innerHTML || '';
}

// ==================== HISTORIAL ====================
async function verHistorial() {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("Error de conexión", true);
        return;
    }
    
    try {
        const { data: completados, error } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .eq('estado', 'completado');
        
        if (error) throw error;
        
        if (!completados || completados.length === 0) {
            mostrarToast("No tienes entregas completadas");
        } else {
            let total = 0;
            let msg = "✅ Entregas completadas:\n";
            completados.forEach(p => { 
                total += p.tarifa; 
                msg += `• #${p.id}: ${p.distancia_real}km - $${p.tarifa}\n`;
            });
            msg += `\n💰 Total ganado: $${total} MXN`;
            alert(msg);
        }
    } catch(e) {
        console.error('Error:', e);
        mostrarToast("Error al cargar historial", true);
    }
}

function verPerfil() { 
    alert(`👤 ${currentUser?.nombre}\n📧 ${currentUser?.email}\n🏍️ Delivery`); 
}

// ==================== CERRAR SESIÓN ====================
function cerrarSesion() { 
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (ubicacionInterval) clearInterval(ubicacionInterval);
    if (cargaPedidosInterval) clearInterval(cargaPedidosInterval);
    
    limpiarRutaDelivery();
    
    if (currentUser && userMarker) {
        const { lng, lat } = userMarker.getLngLat();
        guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, lat, lng, false);
    }
    
    if (confirm("¿Cerrar sesión?")) { 
        localStorage.removeItem('sesion_activa'); 
        window.location.href = "index.html"; 
    } 
}

// ==================== TOAST ====================
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
    
    if (msg.includes('🏍️')) icono = 'fa-motorcycle';
    else if (msg.includes('📦')) icono = 'fa-box';
    else if (msg.includes('💰')) icono = 'fa-coins';
    else if (msg.includes('✅')) icono = 'fa-circle-check';
    else if (msg.includes('❌')) icono = 'fa-circle-exclamation';
    else if (msg.includes('📍')) icono = 'fa-location-dot';
    
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
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2);
    `;
    
    toast.innerHTML = `<i class="fas ${icono}" style="font-size: ${isMobile ? '16px' : '18px'}"></i><span>${msg}</span>`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toast.style.opacity = '1';
    }, 10);
    
    const duracion = err ? 3500 : 2500;
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, duracion);
}

// ==================== MODAL CONFIRMACIÓN ====================
function mostrarModalConfirmacionDelivery(titulo, mensaje) {
    return new Promise((resolve) => {
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
                <h3 class="text-xl font-bold text-white mb-2">${titulo}</h3>
                <p class="text-gray-400 text-sm mb-6">${mensaje}</p>
                <div class="flex gap-3">
                    <button id="btnCancelarConfirm" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl transition-all font-medium">Cancelar</button>
                    <button id="btnAceptarConfirm" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl transition-all font-medium"><i class="fas fa-hand-paper mr-2"></i>Aceptar</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById("btnAceptarConfirm").onclick = () => {
            modal.remove();
            resolve(true);
        };
        
        document.getElementById("btnCancelarConfirm").onclick = () => {
            modal.remove();
            resolve(false);
        };
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        });
    });
}

// ==================== LIMPIAR INTERVALOS ====================
function limpiarIntervalosDelivery() {
    if (ubicacionInterval) clearInterval(ubicacionInterval);
    if (cargaPedidosInterval) clearInterval(cargaPedidosInterval);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    limpiarRutaDelivery();
    
    if (currentUser && isOnline && supabaseClient) {
        setDeliveryOnlineSupabase(currentUser.id, false).catch(console.error);
        if (userMarker) {
            const { lng, lat } = userMarker.getLngLat();
            guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, lat, lng, false).catch(console.error);
        }
    }
}

const originalCerrarSesionDelivery = window.cerrarSesion;
window.cerrarSesion = function() {
    limpiarIntervalosDelivery();
    if (originalCerrarSesionDelivery) originalCerrarSesionDelivery();
};

window.addEventListener('beforeunload', () => limpiarIntervalosDelivery());
window.addEventListener('unload', () => console.log("💀 Delivery: página descargada"));

window.onload = () => { 
    loadUser(); 
    initMap();
};