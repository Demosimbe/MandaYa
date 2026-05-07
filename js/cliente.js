import { 
    supabaseClient, 
    crearPedidoEnSupabase,
    guardarUbicacionEnSupabase,
    tienePedidoActivo,
    MAPBOX_TOKEN
} from './config.js';

import { 
    drawRealRoute, 
    calculateShippingRate, 
    formatDuration,
    convertirPedidoDeSupabase,
    limitarMapaACarmen,
    crearMarcadorDelivery,
    obtenerPrimerNombre,
    getRealDistanceAndTime,
    geocodificarDireccion,
    reverseGeocodingMapbox,
    crearMarcadorArrastrable
} from './map-utils.js';

// ==================== VARIABLES GLOBALES ====================
let map, originMarker, destMarker, routeLine, deliveryMarker;
let originCoords = null, destCoords = null;
let currentUser = null, pedidoActual = null;
let selectMode = 'origen';
let currentRouteData = null;
let deliverysMarkers = [];
let deliverysInterval = null;
let busquedaTimeout = null;
let mapboxMap = null;
let usandoMapbox = false;
let paginaVisible = true;
let clienteRouteControl = null;
let ultimaPeticionDeliverys = 0;  // ← Variable faltante agregada

// ==================== FUNCIONES GLOBALES ====================
window.mostrarToast = function(msg, err = false) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: ${err ? '#dc2626' : '#10b981'};
        color: white;
        padding: 14px 28px;
        border-radius: 50px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        opacity: 0;
        transition: all 0.3s ease;
    `;
    toast.innerHTML = `<i class="fas ${err ? 'fa-exclamation-circle' : 'fa-check-circle'} mr-2"></i>${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toast.style.opacity = '1';
    }, 10);
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

window.mostrarModalConfirmacion = function(titulo, mensaje, onConfirm) {
    const confirmar = confirm(`${titulo}\n\n${mensaje}`);
    if (confirmar && onConfirm) onConfirm();
};

window.verPerfil = function() {
    if (currentUser) {
        alert(`👤 ${currentUser.nombre}\n📧 ${currentUser.email}\n📍 Cliente MandaYa`);
    }
};

window.cerrarSesion = function() {
    if (confirm("¿Cerrar sesión?")) {
        if (deliverysInterval) clearInterval(deliverysInterval);
        localStorage.removeItem('sesion_activa');
        window.location.href = "index.html";
    }
};

window.verHistorial = async function() {
    const supabase = supabaseClient;
    if (!supabase || !currentUser) {
        window.mostrarToast("Error de conexión", true);
        return;
    }
    
    try {
        const { data, error } = await supabase
            .from('pedidos')
            .select('*')
            .eq('cliente_id', currentUser.id)
            .order('fecha', { ascending: false });
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            window.mostrarToast("No tienes envíos registrados");
        } else {
            let msg = "📦 MIS ENVÍOS:\n\n";
            data.forEach(p => {
                msg += `#${p.id}: ${p.origen} → ${p.destino}\n💰 $${p.tarifa}\n📅 ${new Date(p.fecha).toLocaleDateString()}\nEstado: ${p.estado}\n━━━━━━━━━━━━\n`;
            });
            alert(msg);
        }
    } catch(e) {
        console.error('Error:', e);
        window.mostrarToast("Error al cargar historial", true);
    }
};

window.setSelectMode = function(mode) {
    selectMode = mode;
    document.getElementById('btnOrigen').className = mode === 'origen' ? 'mode-btn active' : 'mode-btn inactive';
    document.getElementById('btnDestino').className = mode === 'destino' ? 'mode-btn active' : 'mode-btn inactive';
    window.mostrarToast(mode === 'origen' ? "📍 Modo ORIGEN activado" : "🏁 Modo DESTINO activado");
};

window.solicitarEnvio = async function() {
    const origen = document.getElementById("origen").value;
    const destino = document.getElementById("destino").value;
    const tipo = document.getElementById("tipoEnvio").value;
    const tarifaTexto = document.getElementById("tarifaValue").innerText;
    const tarifa = parseFloat(tarifaTexto.replace('$', '').replace(' MXN', '').replace('(estimado)', '').trim());
    
    if (!origen || !destino) {
        window.mostrarToast("❌ Selecciona origen y destino", true);
        return;
    }
    if (!tipo) {
        window.mostrarToast("❌ Selecciona el tipo de envío", true);
        return;
    }
    if (!originCoords || !destCoords) {
        window.mostrarToast("❌ Coordenadas no disponibles", true);
        return;
    }
    
    const supabase = supabaseClient;
    if (!supabase) {
        window.mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    const pedido = {
        id: Date.now().toString(),
        clienteId: currentUser.id,
        clienteNombre: currentUser.nombre,
        origen: origen,
        destino: destino,
        origenCoords: originCoords,
        destinoCoords: destCoords,
        tipo: tipo,
        distanciaReal: currentRouteData?.distance?.toFixed(2) || calcularDistancia().toFixed(2),
        tarifa: isNaN(tarifa) ? 50 : tarifa,
        estado: 'pendiente',
        fecha: new Date().toISOString()
    };
    
    const resultado = await crearPedidoEnSupabase(pedido);
    
    if (resultado?.error) {
        window.mostrarToast("❌ Error al crear pedido", true);
    } else {
        window.mostrarToast(`✅ Pedido #${pedido.id} creado exitosamente`);
        document.getElementById("panelEstadoPedido").classList.remove("hidden");
        document.getElementById("pedidoIdLabel").innerText = pedido.id;
        document.getElementById("pedidoIdLabelMobile").innerText = pedido.id;
        document.getElementById("panelEstadoPedidoMobile")?.classList.remove("hidden");
        setTimeout(() => window.location.reload(), 2000);
    }
};

function calcularDistancia() {
    if (!originCoords || !destCoords) return 0;
    const R = 6371;
    const dLat = (destCoords.lat - originCoords.lat) * Math.PI / 180;
    const dLon = (destCoords.lng - originCoords.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(originCoords.lat * Math.PI / 180) * Math.cos(destCoords.lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function loadUser() {
    const sesion = localStorage.getItem('sesion_activa');
    if (!sesion) { window.location.href = "index.html"; return; }
    currentUser = JSON.parse(sesion);
    if (currentUser.rol !== 'cliente') { window.location.href = "delivery.html"; return; }
    document.getElementById("userInfo").innerHTML = `<div class="flex items-center gap-2"><i class="fas fa-user-circle text-[#FF6200] text-xl"></i><span class="font-medium">${currentUser.nombre}</span><span class="text-gray-400 text-xs">(Cliente)</span></div>`;
}

function initMap() {
    if (typeof mapboxgl !== 'undefined' && MAPBOX_TOKEN && MAPBOX_TOKEN !== 'TU_TOKEN_AQUI') {
        try {
            mapboxgl.accessToken = MAPBOX_TOKEN;
            mapboxMap = new mapboxgl.Map({
                container: 'map',
                style: 'mapbox://styles/mapbox/streets-v12',
                center: [-91.8249, 18.6456],
                zoom: 13,
                maxZoom: 17,
                minZoom: 12
            });
            
            mapboxMap.setMaxBounds([
                [-91.88, 18.58],
                [-91.75, 18.70]
            ]);
            
            map = mapboxMap;
            usandoMapbox = true;
            console.log("✅ Usando Mapbox");
            
            mapboxMap.addControl(new mapboxgl.GeolocateControl({
                positionOptions: { enableHighAccuracy: true },
                trackUserLocation: true,
                showUserHeading: true
            }));
            
            originMarker = crearMarcadorArrastrable(-91.8249, 18.6456, '#FF6200', '📍 Origen');
            destMarker = crearMarcadorArrastrable(-91.8149, 18.6556, '#3B82F6', '🏁 Destino');
            
            if (originMarker) originMarker.addTo(mapboxMap);
            if (destMarker) destMarker.addTo(mapboxMap);
            
            if (originMarker) {
                originMarker.on('dragend', async () => {
                    const lngLat = originMarker.getLngLat();
                    originCoords = { lat: lngLat.lat, lng: lngLat.lng };
                    const direccion = await reverseGeocodingMapbox(lngLat.lat, lngLat.lng);
                    document.getElementById("origen").value = direccion;
                    actualizarRutaYTarifa();
                });
            }
            
            if (destMarker) {
                destMarker.on('dragend', async () => {
                    const lngLat = destMarker.getLngLat();
                    destCoords = { lat: lngLat.lat, lng: lngLat.lng };
                    const direccion = await reverseGeocodingMapbox(lngLat.lat, lngLat.lng);
                    document.getElementById("destino").value = direccion;
                    actualizarRutaYTarifa();
                });
            }
            
            mapboxMap.on('click', (e) => {
                const { lng, lat } = e.lngLat;
                if (selectMode === 'origen') {
                    if (originMarker) originMarker.setLngLat([lng, lat]);
                    originCoords = { lat, lng };
                    reverseGeocodingMapbox(lat, lng).then(addr => {
                        document.getElementById("origen").value = addr;
                    });
                } else {
                    if (destMarker) destMarker.setLngLat([lng, lat]);
                    destCoords = { lat, lng };
                    reverseGeocodingMapbox(lat, lng).then(addr => {
                        document.getElementById("destino").value = addr;
                    });
                }
                actualizarRutaYTarifa();
            });
            
            originCoords = { lat: 18.6456, lng: -91.8249 };
            destCoords = { lat: 18.6556, lng: -91.8149 };
            
            reverseGeocodingMapbox(18.6456, -91.8249).then(addr => {
                document.getElementById("origen").value = addr;
            });
            reverseGeocodingMapbox(18.6556, -91.8149).then(addr => {
                document.getElementById("destino").value = addr;
            });
            
            setTimeout(() => actualizarRutaYTarifa(), 500);
            
        } catch(e) {
            console.log("Error cargando Mapbox, usando Leaflet:", e);
            iniciarLeaflet();
        }
    } else {
        console.log("Mapbox no configurado, usando Leaflet");
        iniciarLeaflet();
    }
}

function iniciarLeaflet() {
    usandoMapbox = false;
    map = L.map('map').setView([18.6456, -91.8249], 13);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OSM & CartoDB',
        maxZoom: 18,
        subdomains: 'abcd'
    }).addTo(map);
    
    limitarMapaACarmen(map);
    
    const originIcon = L.divIcon({
        html: '<div style="background:#FF6200; width:28px; height:28px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-circle" style="color:white; font-size:12px;"></i></div>',
        iconSize: [28, 28],
        className: 'custom-marker'
    });
    
    originMarker = L.marker([18.6456, -91.8249], { icon: originIcon, draggable: true }).addTo(map);
    originMarker.bindPopup('📍 <b>Origen</b><br>Arrástrame para cambiar');
    
    const destIcon = L.divIcon({
        html: '<div style="background:#3B82F6; width:28px; height:28px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-square" style="color:white; font-size:12px;"></i></div>',
        iconSize: [28, 28],
        className: 'custom-marker'
    });
    
    destMarker = L.marker([18.6556, -91.8149], { icon: destIcon, draggable: true }).addTo(map);
    destMarker.bindPopup('🏁 <b>Destino</b><br>Arrástrame para cambiar');
    
    originMarker.on('dragend', function(e) {
        const coords = e.target.getLatLng();
        if (coords.lat >= 18.58 && coords.lat <= 18.70 && coords.lng >= -91.88 && coords.lng <= -91.75) {
            originCoords = { lat: coords.lat, lng: coords.lng };
            reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
            actualizarRutaYTarifa();
            window.mostrarToast("📍 Origen actualizado");
        } else {
            window.mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
            if (originCoords) originMarker.setLatLng([originCoords.lat, originCoords.lng]);
        }
    });
    
    destMarker.on('dragend', function(e) {
        const coords = e.target.getLatLng();
        if (coords.lat >= 18.58 && coords.lat <= 18.70 && coords.lng >= -91.88 && coords.lng <= -91.75) {
            destCoords = { lat: coords.lat, lng: coords.lng };
            reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
            actualizarRutaYTarifa();
            window.mostrarToast("🏁 Destino actualizado");
        } else {
            window.mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
            if (destCoords) destMarker.setLatLng([destCoords.lat, destCoords.lng]);
        }
    });
    
    map.on('click', (e) => {
        if (e.latlng.lat >= 18.58 && e.latlng.lat <= 18.70 && e.latlng.lng >= -91.88 && e.latlng.lng <= -91.75) {
            if (selectMode === 'origen') {
                originMarker.setLatLng(e.latlng);
                originCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
                reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
                actualizarRutaYTarifa();
                window.mostrarToast("📍 Origen actualizado");
            } else {
                destMarker.setLatLng(e.latlng);
                destCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
                reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
                actualizarRutaYTarifa();
                window.mostrarToast("🏁 Destino actualizado");
            }
        } else {
            window.mostrarToast("❌ Solo dentro de Ciudad del Carmen", true);
        }
    });
    
    originCoords = { lat: 18.6456, lng: -91.8249 };
    destCoords = { lat: 18.6556, lng: -91.8149 };
    
    reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
    reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
    
    setTimeout(() => actualizarRutaYTarifa(), 500);
}

window.centrarMapa = function() {
    if (mapboxMap) {
        mapboxMap.setCenter([-91.8249, 18.6456]).setZoom(13);
    } else if (map) {
        map.setView([18.6456, -91.8249], 13);
    }
    window.mostrarToast("📍 Mapa centrado en Ciudad del Carmen");
};

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

async function buscarDirecciones(query, tipo) {
    if (!query || query.length < 3) {
        document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
        return;
    }
    
    let resultados = [];
    
    if (usandoMapbox && typeof geocodificarDireccion === 'function') {
        resultados = await geocodificarDireccion(query);
    }
    
    if (resultados.length === 0) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Ciudad del Carmen, Campeche')}&limit=5&addressdetails=1`);
            const data = await response.json();
            resultados = data.map(lugar => ({
                nombre: lugar.display_name.split(',')[0],
                direccion: lugar.display_name,
                lat: parseFloat(lugar.lat),
                lng: parseFloat(lugar.lon)
            }));
        } catch(e) {
            console.error('Error buscando direcciones:', e);
        }
    }
    
    const sugerenciasDiv = document.getElementById(`${tipo}Sugerencias`);
    
    if (resultados.length === 0) {
        sugerenciasDiv.classList.add('hidden');
        return;
    }
    
    sugerenciasDiv.innerHTML = resultados.map(lugar => `
        <div class="sugerencia-item p-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 flex items-start gap-2" 
             onclick="seleccionarDireccion('${tipo}', ${lugar.lat}, ${lugar.lng}, '${lugar.nombre.replace(/'/g, "\\'")}')">
            <i class="fas fa-map-marker-alt text-gray-400 mt-0.5 text-xs"></i>
            <div class="flex-1">
                <div class="text-sm font-medium text-gray-800">${lugar.nombre}</div>
                <div class="text-xs text-gray-500">${lugar.direccion.substring(0, 60)}...</div>
            </div>
        </div>
    `).join('');
    
    sugerenciasDiv.classList.remove('hidden');
}

window.seleccionarDireccion = function(tipo, lat, lng, direccion) {
    const coords = { lat: parseFloat(lat), lng: parseFloat(lng) };
    
    if (coords.lat < 18.58 || coords.lat > 18.70 || coords.lng < -91.88 || coords.lng > -91.75) {
        window.mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
        document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
        return;
    }
    
    if (!usandoMapbox) {
        if (tipo === 'origen') {
            originMarker.setLatLng([coords.lat, coords.lng]);
            originCoords = coords;
            document.getElementById("origen").value = direccion.split(',')[0];
        } else {
            destMarker.setLatLng([coords.lat, coords.lng]);
            destCoords = coords;
            document.getElementById("destino").value = direccion.split(',')[0];
        }
    } else {
        if (tipo === 'origen') {
            if (originMarker) originMarker.setLngLat([coords.lng, coords.lat]);
            originCoords = coords;
            document.getElementById("origen").value = direccion.split(',')[0];
        } else {
            if (destMarker) destMarker.setLngLat([coords.lng, coords.lat]);
            destCoords = coords;
            document.getElementById("destino").value = direccion.split(',')[0];
        }
    }
    
    document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
    actualizarRutaYTarifa();
    window.mostrarToast(`📍 ${tipo === 'origen' ? 'Origen' : 'Destino'} actualizado`);
};

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', () => {
    loadUser();
    initMap();
});

window.onload = () => {
    console.log("Cliente app cargada");
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

// ==================== VER DELIVERYS EN LÍNEA ====================
async function cargarDeliverysEnLinea() {
    // ✅ 1. Verificar si la página está visible (ahorrar recursos)
    if (!paginaVisible) {
        console.log("📴 Página oculta, omitiendo carga de deliverys");
        return;
    }
    
    // ✅ 2. Throttling: mínimo 15 segundos entre peticiones
    const ahora = Date.now();
    if (ultimaPeticionDeliverys && (ahora - ultimaPeticionDeliverys) < 15000) {
        console.log("⏳ Throttling: cargarDeliverysEnLinea - muy rápido, espera");
        return;
    }
    ultimaPeticionDeliverys = ahora;
    
    // ✅ 3. Verificar Supabase
    if (typeof supabaseClient === 'undefined' || !supabaseClient) {
        console.log("❌ Supabase no disponible");
        return;
    }
    
    try {
        // ✅ 4. Obtener deliverys online desde Supabase
        const { data: ubicaciones, error } = await supabaseClient
            .from('ubicaciones')
            .select('*')
            .eq('online', true)
            .order('updated_at', { ascending: false });
        
        if (error) throw error;
        
        if (!ubicaciones || ubicaciones.length === 0) {
            // No hay deliverys online, limpiar marcadores existentes
            deliverysMarkers.forEach(marker => {
                try { if (map && marker.remove) marker.remove(); } catch(e) {}
            });
            deliverysMarkers = [];
            console.log("📭 No hay deliverys en línea");
            return;
        }
        
        // ✅ 5. Verificar cuáles deliverys tienen pedido activo
        const deliverysConEstado = await Promise.all(ubicaciones.map(async (delivery) => {
            const tienePedido = await tienePedidoActivo(delivery.delivery_id);
            return { ...delivery, tienePedido };
        }));
        
        // ✅ 6. Limpiar marcadores antiguos
        deliverysMarkers.forEach(marker => {
            try { if (map && marker.remove) marker.remove(); } catch(e) {}
        });
        deliverysMarkers = [];
        
        // ✅ 7. Crear nuevos marcadores para cada delivery
        deliverysConEstado.forEach(delivery => {
            const tienePedido = delivery.tienePedido;
            const color = tienePedido ? '#FF6200' : '#10B981';
            const estadoTexto = tienePedido ? '🟠 En entrega' : '🟢 Disponible';
            
            const marker = crearMarcadorDelivery(
                delivery.lat, 
                delivery.lng, 
                delivery.delivery_nombre, 
                color
            );
            
            marker.bindPopup(`
                <b>🏍️ ${delivery.delivery_nombre}</b><br>
                ${estadoTexto}<br>
                <small>Última actualización: ${new Date(delivery.updated_at).toLocaleTimeString()}</small>
            `);
            
            marker.addTo(map);
            deliverysMarkers.push(marker);
        });
        
        console.log(`✅ ${deliverysConEstado.length} deliverys mostrados (${deliverysConEstado.filter(d => d.tienePedido).length} ocupados, ${deliverysConEstado.filter(d => !d.tienePedido).length} disponibles)`);
        
    } catch(e) {
        console.error('❌ Error cargando deliverys en línea:', e);
    }
}

// ==================== FUNCIÓN PARA VERIFICAR PEDIDO ACTIVO DEL DELIVERY ====================
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

// ==================== FUNCIÓN LIMPIAR Y RESETEAR UI ====================
function limpiarYResetearUI() {
    pedidoActual = null;
    const panelEstado = document.getElementById("panelEstadoPedido");
    const panelEstadoMobile = document.getElementById("panelEstadoPedidoMobile");
    
    if (panelEstado) panelEstado.classList.add("hidden");
    if (panelEstadoMobile) panelEstadoMobile.classList.add("hidden");
    
    document.getElementById("pedidoIdLabel").innerText = "---";
    document.getElementById("pedidoIdLabelMobile").innerText = "---";
}

// ==================== FUNCIÓN CANCELAR PEDIDO ====================
async function cancelarPedido() {
    if (!pedidoActual || pedidoActual.estado !== 'pendiente') {
        window.mostrarToast("❌ No se puede cancelar este pedido porque ya está en camino o completado", true);
        return;
    }
    
    const confirmar = confirm(`Cancelar pedido\n\n¿Estás seguro de cancelar el pedido #${pedidoActual.id}? Esta acción no se puede deshacer.`);
    
    if (!confirmar) return;
    
    const supabase = supabaseClient;
    if (!supabase) {
        window.mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
        const { error } = await supabase
            .from('pedidos')
            .delete()
            .eq('id', pedidoActual.id);
        
        if (error) throw error;
        
        window.mostrarToast(`✅ Pedido #${pedidoActual.id} cancelado correctamente`);
        limpiarYResetearUI();
        
    } catch(e) {
        console.error('Error cancelando pedido:', e);
        window.mostrarToast("❌ Error al cancelar el pedido", true);
    }
}

// ==================== ACTUALIZAR RUTA Y TARIFA ====================
async function actualizarRutaYTarifa() {
    if (originCoords && destCoords) {
        const tarifaContainer = document.getElementById("tarifaContainer");
        if (tarifaContainer) tarifaContainer.classList.remove("hidden");
        
        const tarifaValueSpan = document.getElementById("tarifaValue");
        if (tarifaValueSpan) tarifaValueSpan.innerHTML = '<div class="loading-spinner"></div> Calculando...';
        
        if (routeLine) {
            if (typeof routeLine.remove === 'function') {
                routeLine.remove();
            } else if (routeLine._map) {
                try { map.removeControl(routeLine); } catch(e) {}
            }
            routeLine = null;
        }
        
        const extrasGuardados = currentRouteData?.extras || null;
        const tipoEnvio = document.getElementById("tipoEnvio")?.value || 'paquete';
        
        let routeResult = null;
        
        if (!usandoMapbox) {
            routeResult = await drawRealRoute(map, originCoords, destCoords, '#FF6200', 5);
        } else {
            try {
                const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${originCoords.lng},${originCoords.lat};${destCoords.lng},${destCoords.lat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;
                const response = await fetch(url);
                const data = await response.json();
                
                if (data.routes && data.routes[0]) {
                    const route = data.routes[0];
                    const distance = route.distance / 1000;
                    const duration = route.duration / 60;
                    
                    if (mapboxMap && mapboxMap.getSource('route')) {
                        if (mapboxMap.getLayer('route')) mapboxMap.removeLayer('route');
                        mapboxMap.removeSource('route');
                    }
                    
                    if (mapboxMap) {
                        const geojson = { type: 'Feature', geometry: route.geometry };
                        mapboxMap.addSource('route', { type: 'geojson', data: geojson });
                        mapboxMap.addLayer({
                            id: 'route',
                            type: 'line',
                            source: 'route',
                            paint: { 'line-color': '#FF6200', 'line-width': 5, 'line-opacity': 0.8 }
                        });
                    }
                    
                    routeResult = { routeData: { distance, duration } };
                }
            } catch(e) {
                console.error("Error en ruta Mapbox:", e);
            }
        }
        
        if (routeResult && routeResult.routeData) {
            if (!usandoMapbox) routeLine = routeResult.line;
            const distance = routeResult.routeData.distance;
            const duration = routeResult.routeData.duration;
            const rate = calculateShippingRate(distance, tipoEnvio);
            
            currentRouteData = { 
                distance: distance, 
                duration: duration,
                extras: extrasGuardados || { lluvia: false, noche: false, espera: false }
            };
            
            let tarifaMostrar = rate.total;
            if (currentRouteData.extras) {
                if (currentRouteData.extras.lluvia) tarifaMostrar += 10;
                if (currentRouteData.extras.noche) tarifaMostrar += 10;
                if (currentRouteData.extras.espera) tarifaMostrar += 10;
            }
            
            const tarifaSpan = document.getElementById("tarifaValue");
            if (tarifaSpan) tarifaSpan.innerHTML = `$${tarifaMostrar} MXN`;
            
            const tarifaSpanMobile = document.getElementById("tarifaValueMobile");
            if (tarifaSpanMobile) tarifaSpanMobile.innerHTML = `$${tarifaMostrar} MXN`;
            
            window.mostrarToast(`📏 Distancia: ${distance.toFixed(2)} km • ⏱️ ${formatDuration(duration)}`);
            
        } else {
            const distance = calcularDistancia();
            const rate = calculateShippingRate(distance, tipoEnvio);
            
            currentRouteData = { 
                distance: distance, 
                duration: distance * 2,
                extras: extrasGuardados || { lluvia: false, noche: false, espera: false }
            };
            
            let tarifaMostrar = rate.total;
            if (currentRouteData.extras) {
                if (currentRouteData.extras.lluvia) tarifaMostrar += 10;
                if (currentRouteData.extras.noche) tarifaMostrar += 10;
                if (currentRouteData.extras.espera) tarifaMostrar += 10;
            }
            
            const tarifaSpan = document.getElementById("tarifaValue");
            if (tarifaSpan) tarifaSpan.innerHTML = `$${tarifaMostrar} MXN (estimado)`;
            
            const tarifaSpanMobile = document.getElementById("tarifaValueMobile");
            if (tarifaSpanMobile) tarifaSpanMobile.innerHTML = `$${tarifaMostrar} MXN`;
            
            if (!usandoMapbox && map) {
                routeLine = L.polyline([
                    [originCoords.lat, originCoords.lng],
                    [destCoords.lat, destCoords.lng]
                ], { color: '#FF6200', weight: 5, opacity: 0.6, dashArray: '5, 10' }).addTo(map);
            }
        }
    }
}

// ==================== LIMPIAR RUTA CLIENTE ====================
function limpiarRutaCliente() {
    if (clienteRouteControl) {
        try { 
            if (!usandoMapbox && map && map.removeControl) {
                map.removeControl(clienteRouteControl);
            }
        } catch(e) {}
        clienteRouteControl = null;
    }
    
    if (usandoMapbox && mapboxMap) {
        try {
            if (mapboxMap.getLayer('route')) mapboxMap.removeLayer('route');
            if (mapboxMap.getSource('route')) mapboxMap.removeSource('route');
        } catch(e) {}
    }
}

// ==================== DIBUJAR RUTA DEL DELIVERY EN CLIENTE ====================
async function dibujarRutaDeliveryEnCliente(ubicacionDelivery, destinoCoords, tipo) {
    if (!ubicacionDelivery || !destinoCoords) {
        console.log("❌ Faltan coordenadas para dibujar ruta:", { ubicacionDelivery, destinoCoords });
        return;
    }
    
    limpiarRutaCliente();
    
    if (!usandoMapbox) {
        let waypoints = [];
        let color = '#FF6200';
        
        if (tipo === 'recogida') {
            waypoints = [
                L.latLng(ubicacionDelivery.lat, ubicacionDelivery.lng),
                L.latLng(destinoCoords.lat, destinoCoords.lng)
            ];
            color = '#10B981';
        } else if (tipo === 'entrega') {
            waypoints = [
                L.latLng(ubicacionDelivery.lat, ubicacionDelivery.lng),
                L.latLng(destinoCoords.lat, destinoCoords.lng)
            ];
            color = '#FF6200';
        }
        
        clienteRouteControl = L.Routing.control({
            waypoints: waypoints,
            routeWhileDragging: false,
            showAlternatives: false,
            fitSelectedRoutes: true,
            lineOptions: {
                styles: [{ color: color, weight: 4, opacity: 0.8 }]
            },
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1'
            }),
            show: false,
            addWaypoints: false
        }).addTo(map);
        
        setTimeout(() => {
            map.fitBounds(waypoints, { padding: [50, 50] });
            map.invalidateSize();
        }, 300);
    } else {
        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${ubicacionDelivery.lng},${ubicacionDelivery.lat};${destinoCoords.lng},${destinoCoords.lat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.routes && data.routes[0] && mapboxMap) {
                const geojson = {
                    type: 'Feature',
                    geometry: data.routes[0].geometry
                };
                
                if (mapboxMap.getSource('route')) {
                    if (mapboxMap.getLayer('route')) mapboxMap.removeLayer('route');
                    mapboxMap.removeSource('route');
                }
                
                mapboxMap.addSource('route', { type: 'geojson', data: geojson });
                mapboxMap.addLayer({
                    id: 'route',
                    type: 'line',
                    source: 'route',
                    paint: {
                        'line-color': tipo === 'recogida' ? '#10B981' : '#FF6200',
                        'line-width': 4,
                        'line-opacity': 0.8
                    }
                });
                
                const bounds = new mapboxgl.LngLatBounds()
                    .extend([ubicacionDelivery.lng, ubicacionDelivery.lat])
                    .extend([destinoCoords.lng, destinoCoords.lat]);
                mapboxMap.fitBounds(bounds, { padding: 50 });
            }
        } catch(e) {
            console.error("Error dibujando ruta con Mapbox:", e);
        }
    }
}

// ==================== EXPONER FUNCIONES GLOBALES ====================
window.actualizarRutaYTarifa = actualizarRutaYTarifa;
window.cancelarPedido = cancelarPedido;
window.cargarDeliverysEnLinea = cargarDeliverysEnLinea;
window.dibujarRutaDeliveryEnCliente = dibujarRutaDeliveryEnCliente;
window.limpiarRutaCliente = limpiarRutaCliente;