// Constantes y variables globales
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

let map, originMarker, destMarker, routeLine, deliveryMarker;
let originCoords = null, destCoords = null;
let currentUser = null, pedidoActual = null;
let selectMode = 'origen';
let seguimientoInterval = null;
let ubicacionInterval = null;
let currentRouteData = null;
let deliverysMarkers = []; // Para los marcadores de deliverys en línea
let deliverysInterval = null;  // Para el intervalo de deliverys en línea

// ==================== INICIALIZACIÓN ====================
function initMap() {
    map = L.map('map').setView([18.6456, -91.8249], 13);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CartoDB',
    maxZoom: 18,
    subdomains: 'abcd'
    }).addTo(map);
    
    // ✅ Limitar mapa a Ciudad del Carmen
    limitarMapaACarmen(map);
    
    // Marcador de origen ARRASTRABLE
    const originIcon = L.divIcon({
        html: '<div style="background:#FF6200; width:28px; height:28px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-circle" style="color:white; font-size:12px;"></i></div>',
        iconSize: [28, 28],
        className: 'custom-marker'
    });
    
    originMarker = L.marker([18.6456, -91.8249], { icon: originIcon, draggable: true }).addTo(map);
    originMarker.bindPopup('📍 <b>Origen</b><br>Arrástrame para cambiar');
    
    // Marcador de destino ARRASTRABLE
    const destIcon = L.divIcon({
        html: '<div style="background:#3B82F6; width:28px; height:28px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-square" style="color:white; font-size:12px;"></i></div>',
        iconSize: [28, 28],
        className: 'custom-marker'
    });
    
    destMarker = L.marker([18.6556, -91.8149], { icon: destIcon, draggable: true }).addTo(map);
    destMarker.bindPopup('🏁 <b>Destino</b><br>Arrástrame para cambiar');
    
    // Eventos de arrastre con validación de límites
    originMarker.on('dragend', function(e) {
        const coords = e.target.getLatLng();
        if (coords.lat >= 18.58 && coords.lat <= 18.70 && coords.lng >= -91.88 && coords.lng <= -91.75) {
            originCoords = { lat: coords.lat, lng: coords.lng };
            reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
            actualizarRutaYTarifa();
            mostrarToast("📍 Origen actualizado");
        } else {
            mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
            if (originCoords) originMarker.setLatLng([originCoords.lat, originCoords.lng]);
        }
    });
    
    destMarker.on('dragend', function(e) {
        const coords = e.target.getLatLng();
        if (coords.lat >= 18.58 && coords.lat <= 18.70 && coords.lng >= -91.88 && coords.lng <= -91.75) {
            destCoords = { lat: coords.lat, lng: coords.lng };
            reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
            actualizarRutaYTarifa();
            mostrarToast("🏁 Destino actualizado");
        } else {
            mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
            if (destCoords) destMarker.setLatLng([destCoords.lat, destCoords.lng]);
        }
    });
    
    // Click en el mapa con validación
    map.on('click', (e) => {
        if (e.latlng.lat >= 18.58 && e.latlng.lat <= 18.70 && e.latlng.lng >= -91.88 && e.latlng.lng <= -91.75) {
            if (selectMode === 'origen') {
                originMarker.setLatLng(e.latlng);
                originCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
                reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
                actualizarRutaYTarifa();
                mostrarToast("📍 Origen actualizado");
            } else {
                destMarker.setLatLng(e.latlng);
                destCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
                reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
                actualizarRutaYTarifa();
                mostrarToast("🏁 Destino actualizado");
            }
        } else {
            mostrarToast("❌ Solo dentro de Ciudad del Carmen", true);
        }
    });
    
    // Inicializar coordenadas
    originCoords = { lat: 18.6456, lng: -91.8249 };
    destCoords = { lat: 18.6556, lng: -91.8149 };
    
    reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
    reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
    
    setTimeout(() => actualizarRutaYTarifa(), 500);
}

function loadUser() {
    const sesion = localStorage.getItem('sesion_activa');
    if (!sesion) { window.location.href = "index.html"; return; }
    currentUser = JSON.parse(sesion);
    if (currentUser.rol !== 'cliente') { window.location.href = "delivery.html"; return; }
    document.getElementById("userInfo").innerHTML = `<div class="flex items-center gap-2"><i class="fas fa-user-circle text-[#FF6200] text-xl"></i><span class="font-medium">${currentUser.nombre}</span><span class="text-gray-400 text-xs">(Cliente)</span></div>`;
}

function centrarMapa() {
    if(map) map.setView([18.6456, -91.8249], 13);
    mostrarToast("📍 Mapa centrado en Ciudad del Carmen");
}

function setSelectMode(mode) {
    selectMode = mode;
    document.getElementById('btnOrigen').className = mode === 'origen' ? 'mode-btn active' : 'mode-btn inactive';
    document.getElementById('btnDestino').className = mode === 'destino' ? 'mode-btn active' : 'mode-btn inactive';
    
    if (mode === 'origen') {
        originMarker.openPopup();
        mostrarToast("📍 Modo ORIGEN - Haz clic en el mapa o arrastra el marcador naranja");
    } else {
        destMarker.openPopup();
        mostrarToast("🏁 Modo DESTINO - Haz clic en el mapa o arrastra el marcador azul");
    }
}

async function actualizarRutaYTarifa() {
    if (originCoords && destCoords) {
        const tarifaContainer = document.getElementById("tarifaContainer");
        tarifaContainer.classList.remove("hidden");
        document.getElementById("tarifaValue").innerHTML = '<div class="loading-spinner"></div> Calculando...';
        
        if (routeLine) {
            if (typeof routeLine.remove === 'function') {
                routeLine.remove();
            } else if (routeLine._map) {
                try { map.removeControl(routeLine); } catch(e) {}
            }
            routeLine = null;
        }
        
        const tipoEnvio = document.getElementById("tipoEnvio").value || 'paquete';
        const routeResult = await drawRealRoute(map, originCoords, destCoords, '#FF6200', 5);
        
        if (routeResult && routeResult.routeData) {
            routeLine = routeResult.line;
            const distance = routeResult.routeData.distance;
            const duration = routeResult.routeData.duration;
            const rate = calculateShippingRate(distance, tipoEnvio);
            
            document.getElementById("tarifaValue").innerHTML = `$${rate.total} MXN`;
            mostrarToast(`📏 Distancia: ${distance.toFixed(2)} km • ⏱️ ${formatDuration(duration)}`);
            
            currentRouteData = { distance: distance, duration: duration };
        } else {
            const distance = calcularDistancia();
            const rate = calculateShippingRate(distance, tipoEnvio);
            document.getElementById("tarifaValue").innerHTML = `$${rate.total} MXN (estimado)`;
            currentRouteData = null;
            
            routeLine = L.polyline([
                [originCoords.lat, originCoords.lng],
                [destCoords.lat, destCoords.lng]
            ], { color: '#FF6200', weight: 5, opacity: 0.6, dashArray: '5, 10' }).addTo(map);
        }
    }
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

async function solicitarEnvio() {
    const origen = document.getElementById("origen").value;
    const destino = document.getElementById("destino").value;
    const tipo = document.getElementById("tipoEnvio").value;
    
    if (!origen || !destino) {
        mostrarToast("❌ Selecciona origen y destino", true);
        return;
    }
    if (!tipo) {
        mostrarToast("❌ Selecciona el tipo de envío", true);
        return;
    }
    
    let distancia = currentRouteData ? currentRouteData.distance : calcularDistancia();
    const rate = calculateShippingRate(distancia, tipo);
    const tarifa = rate.total;
    
    const nuevoPedido = {
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
        tarifa: tarifa,
        estado: 'pendiente',
        fecha: new Date().toISOString()
    };
    
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
        // ✅ Guardar SOLO en Supabase
        const { error } = await supabase
            .from('pedidos')
            .insert([nuevoPedido]);
        
        if (error) throw error;
        pedidoActual = nuevoPedido;
        mostrarToast(`✅ ¡Envío solicitado! Tarifa: $${tarifa} MXN (${distancia.toFixed(2)} km)`);
        iniciarSeguimientoDelivery();
        
    } catch(e) {
        console.error('Error creando pedido:', e);
        mostrarToast("❌ Error al crear el pedido", true);
    }
}

// En cliente.js - reemplaza la función iniciarSeguimientoDelivery()
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
            // ✅ Obtener el pedido ACTUALIZADO desde Supabase
            const { data: pedidoActualizado, error } = await supabase
                .from('pedidos')
                .select('*')
                .eq('id', pedidoActual.id)
                .single();
            
            if (error) throw error;
            
            // ✅ ACTUALIZAR la variable global con los datos más recientes
            if (pedidoActualizado) {
                pedidoActual = pedidoActualizado;
            }
            
            // Estado: asignado - delivery en camino
            if (pedidoActualizado && pedidoActualizado.estado === 'asignado' && pedidoActualizado.delivery_id) {
                clearInterval(seguimientoInterval);
                seguimientoInterval = null;
                mostrarToast(`✅ Delivery asignado: ${pedidoActualizado.delivery_nombre}`);
                mostrarDeliveryEnMapa(pedidoActualizado.delivery_id);
                seguirUbicacionDelivery(pedidoActualizado.delivery_id);
            } 
            // Estado: completado
            else if (pedidoActualizado && pedidoActualizado.estado === 'completado') {
                clearInterval(seguimientoInterval);
                seguimientoInterval = null;
                mostrarToast(`🎉 ¡Envío completado! Gracias por usar MandaYa`);
                ocultarDeliveryInfo();
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

    ubicacionInterval = setInterval(async () => {
        let ubicacion = null;
        
        if (typeof obtenerUbicacionDeSupabase !== 'undefined') {
            const supabaseUbicacion = await obtenerUbicacionDeSupabase(deliveryId);
            if (supabaseUbicacion) {
                ubicacion = { lat: supabaseUbicacion.lat, lng: supabaseUbicacion.lng };
            }
        }
        
        // También obtener el nombre del delivery
        let deliveryNombre = 'Delivery';
        const supabase = supabaseClient;
        if (supabase && deliveryId) {
            const { data: delivery } = await supabase
                .from('usuarios')
                .select('nombre')
                .eq('id', deliveryId)
                .single();
            if (delivery) deliveryNombre = delivery.nombre;
        }
        
        if (ubicacion) {
            if (deliveryMarker) map.removeLayer(deliveryMarker);
            
            // ✅ Usar marcador con nombre (naranja porque está ocupado)
            deliveryMarker = crearMarcadorDelivery(
                ubicacion.lat, 
                ubicacion.lng, 
                deliveryNombre, 
                '#FF6200'
            );
            deliveryMarker.addTo(map);
            deliveryMarker.bindPopup('<b>🏍️ Delivery en camino</b><br>Tu pedido está siendo entregado');
            
            if (destCoords && ubicacion) {
                const distanciaADestino = calcularDistanciaEntrePuntos(ubicacion, destCoords);
                if (distanciaADestino < 0.5) {
                    document.getElementById("deliveryEstado").innerHTML = "🟢 Muy cerca de tu destino 🎯";
                } else if (distanciaADestino < 1) {
                    document.getElementById("deliveryEstado").innerHTML = "🟡 Cerca de tu destino";
                } else {
                    document.getElementById("deliveryEstado").innerHTML = `🔴 A ${distanciaADestino.toFixed(1)} km de tu destino`;
                }
            }
        }
        
        // Verificar estado completado...
        if (supabase && pedidoActual) {
            const { data: pedidoActualizado } = await supabase
                .from('pedidos')
                .select('estado')
                .eq('id', pedidoActual.id)
                .single();
            
            if (pedidoActualizado?.estado === 'completado') {
                clearInterval(ubicacionInterval);
                mostrarToast("🎉 ¡Envío completado! Gracias por usar MandaYa");
                setTimeout(() => ocultarDeliveryInfo(), 5000);
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

async function mostrarHistorialCompleto() {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("Error de conexión", true);
        return;
    }
    
    try {
        // ✅ Cargar historial desde Supabase
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
    
    // Primero obtener el pedido para ver su estado
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
                // ✅ Eliminar de Supabase
                const { error } = await supabase
                    .from('pedidos')
                    .delete()
                    .eq('id', pedidoId);
                
                if (error) throw error;
                
                mostrarToast(`🗑️ Envío #${pedidoId} eliminado correctamente`);
                
                // Recargar historial si está abierto
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

function verHistorial() {
    mostrarHistorialCompleto();
}

function verPerfil() { 
    alert(`👤 ${currentUser?.nombre}\n📧 ${currentUser?.email}\n💰 Cliente`); 
}

async function mostrarDeliveryEnMapa(deliveryId) {
    const supabase = supabaseClient;
    if (!supabase) return;
    
    try {
        const { data: delivery, error } = await supabase
            .from('usuarios')
            .select('nombre')
            .eq('id', deliveryId)
            .single();
        
        if (error) throw error;
        
        if (delivery) {
            document.getElementById("deliveryInfo").classList.remove("hidden");
            document.getElementById("deliveryNombre").innerHTML = `<i class="fas fa-motorcycle"></i> ${delivery.nombre}`;
            document.getElementById("deliveryEstado").innerHTML = "🟠 En camino a recoger tu paquete";
            
            // El marcador del delivery asignado será NARANJA
            const naranjaIcon = L.divIcon({
                html: '<div style="background:#FF6200; width:32px; height:32px; border-radius:50%; border:2px solid white; display:flex; align-items:center; justify-content:center;"><i class="fas fa-motorcycle" style="color:white; font-size:16px;"></i></div>',
                iconSize: [32, 32],
                className: 'moto-marker'
            });
            
            if (deliveryMarker) {
                deliveryMarker.setIcon(naranjaIcon);
            }
        }
    } catch(e) {
        console.error('Error mostrando delivery:', e);
    }
}

// En cliente.js - función cerrarSesion()
function cerrarSesion() { 
    if(confirm("¿Cerrar sesión?")){
        // ✅ LIMPIAR TODOS LOS INTERVALOS
        if(seguimientoInterval) { clearInterval(seguimientoInterval); seguimientoInterval = null;}
        if(ubicacionInterval) { clearInterval(ubicacionInterval); ubicacionInterval = null;}
        if(deliverysInterval) { clearInterval(deliverysInterval); deliverysInterval = null; }
        
        localStorage.removeItem('sesion_activa'); 
        window.location.href = "index.html"; 
    } 
}

function mostrarToast(msg, err=false){ 
    const t=document.createElement('div'); 
    t.className='toast-message'; 
    t.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: ${err ? 'linear-gradient(135deg, #dc2626, #ef4444)' : 'linear-gradient(135deg, #10b981, #059669)'};
        color: white;
        padding: 14px 28px;
        border-radius: 50px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transition: all 0.3s ease;
    `;
    t.innerHTML = `<i class="fas ${err ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i> ${msg}`;
    document.body.appendChild(t);
    
    setTimeout(() => {
        t.style.transform = 'translateX(-50%) translateY(0)';
        t.style.opacity = '1';
    }, 10);
    
    setTimeout(() => {
        t.style.transform = 'translateX(-50%) translateY(20px)';
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

function mostrarResumenRuta() {
    if (!originCoords || !destCoords) {
        mostrarToast("Selecciona origen y destino primero", true);
        return;
    }
    
    mostrarToast("🔄 Calculando ruta óptima...");
    
    getRealDistanceAndTime(originCoords, destCoords).then(routeData => {
        if (routeData) {
            const tipo = document.getElementById("tipoEnvio").value || 'paquete';
            const rate = calculateShippingRate(routeData.distance, tipo);
            const msg = `📊 RESUMEN DE RUTA:\n\n` +
                       `📍 Distancia real: ${routeData.distanceKm} km\n` +
                       `⏱️ Tiempo estimado: ${routeData.durationText}\n` +
                       `💰 Tarifa: $${rate.total} MXN\n` +
                       `📦 Tipo: ${tipo}\n\n` +
                       `💡 TIP: Arrastra los marcadores naranja y azul para ajustar origen y destino.`;
            alert(msg);
        } else {
            mostrarToast("No se pudo calcular la ruta real", true);
        }
    });
}

// ==================== VER DELIVERYS EN LÍNEA ====================
async function cargarDeliverysEnLinea() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
    
    try {
        const { data: ubicaciones, error } = await supabaseClient
            .from('ubicaciones')
            .select('*')
            .eq('online', true)
            .order('updated_at', { ascending: false });
        
        if (error) throw error;
        
        // Para cada delivery, verificar si tiene pedido activo
        const deliverysConEstado = await Promise.all(ubicaciones.map(async (delivery) => {
            const tienePedido = await tienePedidoActivo(delivery.delivery_id);
            return { ...delivery, tienePedido };
        }));
        
        // Limpiar marcadores anteriores
        deliverysMarkers.forEach(marker => map.removeLayer(marker));
        deliverysMarkers = [];
        
        // Mostrar cada delivery con su nombre arriba
        deliverysConEstado.forEach(delivery => {
            const tienePedido = delivery.tienePedido;
            const color = tienePedido ? '#FF6200' : '#10B981';
            const estadoTexto = tienePedido ? '🟠 En entrega' : '🟢 Disponible';
            
            // ✅ Usar marcador con nombre
            const marker = crearMarcadorDelivery(
                delivery.lat, 
                delivery.lng, 
                delivery.delivery_nombre, 
                color
            );
            
            marker.bindPopup(`<b>🏍️ ${delivery.delivery_nombre}</b><br>${estadoTexto}`);
            marker.addTo(map);
            deliverysMarkers.push(marker);
        });
        
        console.log(`✅ ${deliverysConEstado.length} deliverys mostrados (${deliverysConEstado.filter(d => d.tienePedido).length} ocupados, ${deliverysConEstado.filter(d => !d.tienePedido).length} disponibles)`);
        
    } catch(e) {
        console.error('Error cargando deliverys:', e);
    }
}

window.onload = () => { 
    loadUser(); 
    initMap();
    if (currentUser && currentUser.rol === 'cliente') {
        setTimeout(() => cargarDeliverysEnLinea(), 2000);
        
        // ✅ Limpiar intervalo anterior si existe
        if (deliverysInterval) clearInterval(deliverysInterval);
        
        // ✅ Guardar referencia del intervalo
        deliverysInterval = setInterval(() => {
            if (currentUser && currentUser.rol === 'cliente') {
                cargarDeliverysEnLinea();
            }
        }, 5000);
    }
};