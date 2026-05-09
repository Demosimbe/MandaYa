// delivery.js - VERSIÓN CORREGIDA

let map = null;
let currentUser = null;
let isOnline = false;
let pedidosDisponibles = [];
let misPedidosActivos = [];
let pedidoSeleccionado = null;
let ubicacionInterval = null;
let cargaPedidosInterval = null;
let userMarker = null;
let watchId = null;
let ultimaUbicacionEnviada = null;
let currentRouteLayerId = 'delivery-route';
let ultimoPedidoDibujado = null;
let ultimaEtapa = null;
let ultimaPeticionPedidos = 0;
let paginaVisible = true;

// ==================== INICIALIZACIÓN ====================
function initMap() {
    if (map) return;
    
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'osm-raster': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '&copy; OpenStreetMap contributors'
                }
            },
            layers: [{
                id: 'osm-raster-layer',
                type: 'raster',
                source: 'osm-raster'
            }]
        },
        center: [-91.8249, 18.6456],
        zoom: 13.5,
        minZoom: 12,
        maxZoom: 18
    });
    
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
        console.log('✅ Mapa Delivery cargado');
        cargarPedidos();
        startLocationTracking();
    });
}

// ==================== LIMPIAR RUTA ====================
function limpiarRutaDelivery() {
    if (!map) return;
    try {
        if (map.getLayer(currentRouteLayerId)) map.removeLayer(currentRouteLayerId);
        if (map.getSource(currentRouteLayerId)) map.removeSource(currentRouteLayerId);
    } catch(e) {}
}

// ==================== DIBUJAR RUTA ====================
async function dibujarRutaDelivery(origin, dest, color, weight = 5) {
    if (!map || !origin || !dest) return null;
    
    limpiarRutaDelivery();
    
    try {
        const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`
        );
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
            map.addSource(currentRouteLayerId, {
                type: 'geojson',
                data: data.routes[0].geometry
            });
            
            map.addLayer({
                id: currentRouteLayerId,
                type: 'line',
                source: currentRouteLayerId,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': color, 'line-width': weight, 'line-opacity': 0.85 }
            });
            
            const bounds = new maplibregl.LngLatBounds()
                .extend([origin.lng, origin.lat])
                .extend([dest.lng, dest.lat]);
            
            map.fitBounds(bounds, { padding: 80, duration: 1800, maxZoom: 16.5 });
            
            return {
                distance: data.routes[0].distance / 1000,
                duration: data.routes[0].duration / 60
            };
        }
    } catch(e) {
        console.error('Error:', e);
    }
    return null;
}

// ==================== FUNCIONES SUPABASE ====================
async function deliveryTienePedidoActivo(deliveryId) {
    const supabase = window.supabaseClient;
    if (!supabase) return false;
    
    const { data, error } = await supabase
        .from('pedidos')
        .select('id')
        .eq('delivery_id', deliveryId)
        .in('estado', ['asignado', 'recogido'])
        .maybeSingle();
    
    return !!data;
}

async function guardarUbicacionEnSupabase(deliveryId, deliveryNombre, lat, lng, online) {
    const supabase = window.supabaseClient;
    if (!supabase) return false;
    
    try {
        const { error } = await supabase
            .from('ubicaciones')
            .upsert({
                delivery_id: deliveryId,
                delivery_nombre: deliveryNombre,
                lat: lat,
                lng: lng,
                online: online,
                updated_at: new Date().toISOString()
            }, { onConflict: 'delivery_id' });
        
        return !error;
    } catch(e) {
        console.error('Error:', e);
        return false;
    }
}

// ==================== SEGUIMIENTO UBICACIÓN ====================
function startLocationTracking() {
    if (!map || !map.loaded()) {
        setTimeout(() => startLocationTracking(), 1000);
        return;
    }

    if (!navigator.geolocation) {
        mostrarToast("❌ Geolocalización no soportada", true);
        return;
    }

    if (watchId) navigator.geolocation.clearWatch(watchId);

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lng = pos.coords.longitude;
            const lat = pos.coords.latitude;

            if (userMarker) userMarker.remove();

            const primerNombre = (currentUser?.nombre || 'Delivery').split(' ')[0];

            const markerDiv = document.createElement('div');
            markerDiv.innerHTML = `
                <div style="position:relative; display:flex; flex-direction:column; align-items:center;">
                    <div style="background:rgba(0,0,0,0.8); color:white; font-size:12px; padding:4px 12px; border-radius:20px; margin-bottom:6px;">
                        ${primerNombre}
                    </div>
                    <div style="background:#10B981; width:38px; height:38px; border-radius:50%; border:3px solid white; display:flex; align-items:center; justify-content:center;">
                        <i class="fas fa-motorcycle" style="color:white; font-size:20px;"></i>
                    </div>
                </div>
            `;

            userMarker = new maplibregl.Marker({
                element: markerDiv,
                anchor: 'bottom'
            })
            .setLngLat([lng, lat])
            .addTo(map);

            map.flyTo({ center: [lng, lat], zoom: 16.8, duration: 1400 });

            if (currentUser && isOnline) {
                guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, lat, lng, true);
            }

            watchId = navigator.geolocation.watchPosition(
                (pos2) => {
                    if (!userMarker || !isOnline) return;
                    
                    const newLng = pos2.coords.longitude;
                    const newLat = pos2.coords.latitude;

                    if (ultimaUbicacionEnviada) {
                        const dist = calcularDistanciaMetros(ultimaUbicacionEnviada.lat, ultimaUbicacionEnviada.lng, newLat, newLng);
                        if (dist < 20) return;
                    }

                    ultimaUbicacionEnviada = { lat: newLat, lng: newLng };
                    userMarker.setLngLat([newLng, newLat]);
                    
                    guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, newLat, newLng, true);
                },
                (err) => console.error("Watch error:", err),
                { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
            );
        },
        (err) => {
            console.error("GPS error:", err);
            mostrarToast("❌ Error obteniendo ubicación", true);
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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
        `;
    }
    
    actualizarBadgeEstado();
    cargarPedidos();
}

async function actualizarBadgeEstado() {
    if (!currentUser) return;
    
    try {
        const tienePedido = await deliveryTienePedidoActivo(currentUser.id);
        const badge = document.getElementById("estadoDeliveryBadge");
        
        if (badge) {
            if (!isOnline) {
                badge.innerHTML = '<span class="bg-gray-500/20 text-gray-400 px-2 py-0.5 rounded-full"><i class="fas fa-plug mr-1"></i> Desconectado</span>';
            } else if (tienePedido) {
                badge.innerHTML = '<span class="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full"><i class="fas fa-motorcycle mr-1"></i> Ocupado</span>';
            } else {
                badge.innerHTML = '<span class="bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full"><i class="fas fa-check-circle mr-1"></i> Disponible</span>';
            }
        }
    } catch(e) {}
}

// ==================== CARGAR PEDIDOS ====================
async function cargarPedidos() {
    if (!paginaVisible) return;
    
    const ahora = Date.now();
    if (ahora - ultimaPeticionPedidos < 5000) return;
    ultimaPeticionPedidos = ahora;
    
    const supabase = window.supabaseClient;
    if (!supabase) return;
    
    try {
        const { data: pendientes } = await supabase
            .from('pedidos')
            .select('*')
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: true });
        
        const { data: activos } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .in('estado', ['asignado', 'recogido']);
        
        pedidosDisponibles = (pendientes || []).map(p => convertirPedido(p));
        misPedidosActivos = (activos || []).map(p => convertirPedido(p));
        
        actualizarListaPedidos();
        
        if (misPedidosActivos.length > 0) {
            const pedidoActivo = misPedidosActivos[0];
            if (pedidoActivo.estado === 'asignado') {
                await dibujarRutaRecogida(pedidoActivo);
            } else if (pedidoActivo.estado === 'recogido') {
                await dibujarRutaEntrega(pedidoActivo);
            }
        } else {
            limpiarRutaDelivery();
            if (pedidoSeleccionado) {
                await dibujarRutaOptimaPedido(pedidoSeleccionado);
            }
        }
        
        await actualizarBadgeEstado();
        
    } catch(e) {
        console.error('Error:', e);
    }
}

function convertirPedido(pedido) {
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

// ==================== RUTAS ====================
async function dibujarRutaRecogida(pedido) {
    if (ultimoPedidoDibujado === pedido.id && ultimaEtapa === 'recogida') return;
    
    if (!pedido.origenCoords) return;
    
    if (userMarker) {
        const lngLat = userMarker.getLngLat();
        await dibujarRutaDelivery(
            { lng: lngLat.lng, lat: lngLat.lat },
            pedido.origenCoords,
            '#10B981', 6
        );
    }
    
    ultimoPedidoDibujado = pedido.id;
    ultimaEtapa = 'recogida';
    mostrarToast(`📍 Recoger en: ${pedido.origen}`);
}

async function dibujarRutaEntrega(pedido) {
    if (ultimoPedidoDibujado === pedido.id && ultimaEtapa === 'entrega') return;
    
    if (!pedido.origenCoords || !pedido.destinoCoords) return;
    
    await dibujarRutaDelivery(pedido.origenCoords, pedido.destinoCoords, '#FF6200', 6);
    
    ultimoPedidoDibujado = pedido.id;
    ultimaEtapa = 'entrega';
    mostrarToast(`🚚 Entregar en: ${pedido.destino}`);
}

async function dibujarRutaOptimaPedido(pedido) {
    if (pedido.origenCoords && pedido.destinoCoords) {
        await dibujarRutaDelivery(pedido.origenCoords, pedido.destinoCoords, '#FF6200', 5);
    }
}

// ==================== ACCIONES DE PEDIDOS ====================
function seleccionarPedido(pedidoId) {
    pedidoSeleccionado = pedidosDisponibles.find(p => p.id === pedidoId);
    limpiarRutaDelivery();
    if (pedidoSeleccionado) {
        dibujarRutaOptimaPedido(pedidoSeleccionado);
    }
    actualizarListaPedidos();
    mostrarToast(`📍 Pedido #${pedidoId} seleccionado`);
}

async function agarrarPedido(pedidoId) {
    const supabase = window.supabaseClient;
    if (!supabase) return;
    
    const tienePedido = await deliveryTienePedidoActivo(currentUser.id);
    if (tienePedido) {
        mostrarToast("❌ Ya tienes un pedido activo", true);
        return;
    }
    
    if (!confirm(`¿Agarrar pedido #${pedidoId}?`)) return;
    
    try {
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
        
        mostrarToast(`✅ Pedido #${pedidoId} agarrado`);
        await cargarPedidos();
        
        const pedidoAsignado = misPedidosActivos.find(p => p.id === pedidoId);
        if (pedidoAsignado) {
            await dibujarRutaRecogida(pedidoAsignado);
        }
        
    } catch(e) {
        console.error('Error:', e);
        mostrarToast("❌ Error al agarrar pedido", true);
    }
}

async function marcarPaqueteRecogido(pedidoId) {
    const supabase = window.supabaseClient;
    if (!supabase) return;
    
    try {
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'recogido',
                paquete_recogido_en: new Date().toISOString()
            })
            .eq('id', pedidoId);
        
        if (error) throw error;
        
        mostrarToast(`📦 Paquete #${pedidoId} recogido`);
        await cargarPedidos();
        
        const pedidoActualizado = misPedidosActivos.find(p => p.id === pedidoId);
        if (pedidoActualizado) {
            await dibujarRutaEntrega(pedidoActualizado);
        }
        
    } catch(e) {
        console.error('Error:', e);
        mostrarToast("❌ Error al marcar recogido", true);
    }
}

async function completarPedido(pedidoId) {
    const supabase = window.supabaseClient;
    if (!supabase) return;
    
    try {
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'completado',
                fecha_completado: new Date().toISOString()
            })
            .eq('id', pedidoId);
        
        if (error) throw error;
        
        mostrarToast(`✅ Pedido #${pedidoId} entregado`);
        limpiarRutaDelivery();
        ultimoPedidoDibujado = null;
        ultimaEtapa = null;
        await cargarPedidos();
        
    } catch(e) {
        console.error('Error:', e);
        mostrarToast("❌ Error al completar", true);
    }
}

// ==================== TOGGLE ONLINE ====================
async function toggleOnline() {
    isOnline = !isOnline;
    const btn = document.getElementById("onlineToggle");
    const span = document.getElementById("onlineStatusText");
    
    if (isOnline) {
        if (btn) {
            btn.classList.remove("bg-gray-500");
            btn.classList.add("bg-green-500");
        }
        if (span) span.innerHTML = '🟢 En línea';
        mostrarToast("✅ Estás en línea");
        
        if (currentUser) {
            currentUser.online = true;
            localStorage.setItem('sesion_activa', JSON.stringify(currentUser));
            
            if (userMarker) {
                const { lng, lat } = userMarker.getLngLat();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, lat, lng, true);
            }
        }
        
        if (ubicacionInterval) clearInterval(ubicacionInterval);
        ubicacionInterval = setInterval(async () => {
            if (userMarker && isOnline && currentUser) {
                const { lng, lat } = userMarker.getLngLat();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, lat, lng, true);
            }
        }, 5000);
        
        cargarPedidos();
        
    } else {
        if (btn) {
            btn.classList.remove("bg-green-500");
            btn.classList.add("bg-gray-500");
        }
        if (span) span.innerHTML = 'Conectarse';
        mostrarToast("📴 Estás offline");
        
        if (currentUser) {
            currentUser.online = false;
            localStorage.setItem('sesion_activa', JSON.stringify(currentUser));
            
            if (userMarker) {
                const { lng, lat } = userMarker.getLngLat();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, lat, lng, false);
            }
        }
        
        if (ubicacionInterval) clearInterval(ubicacionInterval);
    }
    
    await actualizarBadgeEstado();
}

// ==================== ACTUALIZAR UI ====================
function actualizarListaPedidos() {
    const containerDisponibles = document.getElementById("pedidosDisponibles");
    const containerActivos = document.getElementById("pedidosActivos");
    const tienePedidoActivo = misPedidosActivos.length > 0;
    
    if (containerDisponibles) {
        if (pedidosDisponibles.length === 0) {
            containerDisponibles.innerHTML = '<div class="text-center text-gray-400 py-8">No hay pedidos disponibles</div>';
        } else {
            containerDisponibles.innerHTML = pedidosDisponibles.map(p => `
                <div class="bg-white border rounded-xl p-4 shadow-sm mb-3 cursor-pointer hover:shadow-md transition" onclick="seleccionarPedido(${p.id})">
                    <div class="flex justify-between items-start mb-2">
                        <span class="font-bold text-[#FF6200]">#${p.id}</span>
                        <span class="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">Pendiente</span>
                    </div>
                    <p class="text-sm"><i class="fas fa-circle text-[#FF6200] text-xs mr-1"></i> ${p.origen}</p>
                    <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> ${p.destino}</p>
                    <p class="text-xs text-gray-500 mt-2">💰 $${p.tarifa} • 📏 ${p.distanciaReal} km</p>
                    ${tienePedidoActivo ? 
                        `<button disabled class="w-full mt-3 bg-gray-400 cursor-not-allowed text-white py-2 rounded-lg">Ocupado</button>` :
                        `<button onclick="event.stopPropagation(); agarrarPedido(${p.id})" class="w-full mt-3 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg">AGARRAR</button>`
                    }
                </div>
            `).join('');
        }
    }
    
    if (containerActivos) {
        if (misPedidosActivos.length === 0) {
            containerActivos.innerHTML = '<div class="text-center text-gray-400 py-4">Sin pedidos activos</div>';
        } else {
            containerActivos.innerHTML = misPedidosActivos.map(p => `
                <div class="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-3">
                    <div class="flex justify-between items-start mb-2">
                        <span class="font-bold text-[#FF6200]">#${p.id}</span>
                        <span class="text-xs px-2 py-1 rounded-full ${p.estado === 'recogido' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}">
                            ${p.estado === 'recogido' ? '📦 Recogido' : '🟡 En camino'}
                        </span>
                    </div>
                    <p class="text-sm"><strong>Recoger:</strong> ${p.origen}</p>
                    <p class="text-sm mt-1"><strong>Entregar:</strong> ${p.destino}</p>
                    <p class="text-xs text-gray-500 mt-2">💰 $${p.tarifa}</p>
                    ${p.estado === 'asignado' ? 
                        `<button onclick="marcarPaqueteRecogido(${p.id})" class="w-full mt-3 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg">📦 MARCAR RECOGIDO</button>` : 
                        `<button onclick="completarPedido(${p.id})" class="w-full mt-3 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg">🏁 MARCAR ENTREGADO</button>`
                    }
                </div>
            `).join('');
        }
    }
}

// ==================== FUNCIONES GENERALES ====================
function centrarMapa() {
    if (map) {
        map.setCenter([-91.8249, 18.6456]);
        map.setZoom(13);
    }
}

function verHistorial() {
    mostrarToast("📋 Historial en desarrollo");
}

function verPerfil() {
    mostrarToast(`👤 ${currentUser?.nombre}\n📧 ${currentUser?.email}`);
}

function cerrarSesion() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
    if (ubicacionInterval) clearInterval(ubicacionInterval);
    if (cargaPedidosInterval) clearInterval(cargaPedidosInterval);
    limpiarRutaDelivery();
    localStorage.removeItem('sesion_activa');
    window.location.href = "index.html";
}

function mostrarToast(msg, err = false) {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-20 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-full shadow-lg z-50 text-sm ${err ? 'bg-red-500' : 'bg-gray-800'} text-white`;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ==================== INICIALIZACIÓN ====================
document.addEventListener('visibilitychange', () => {
    paginaVisible = !document.hidden;
    if (paginaVisible) cargarPedidos();
});

window.onload = () => { 
    loadUser(); 
    initMap();
    setInterval(() => { if (paginaVisible) cargarPedidos(); }, 10000);
};