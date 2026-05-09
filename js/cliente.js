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
let isUserInteracting = false;
let ultimoCentroDelivery = null;
let ultimaRutaDibujada = null;
let listenersAgregados = false;
let userMarker = null;
let watchId = null;
let ultimaUbicacionEnviada = null;
let locationTrackingActive = false;
let ultimaPosicionDelivery = null;
let ultimoZoom = null;
let actualizandoDelivery = false;
let ultimoZoomEnd = Date.now();

// Usuario y pedidos
let currentUser = null;
let pedidoActual = null;
let pedidoPendiente = null;
let ultimoEstadoPedido = null;
let deliveryMarker = null;

// Modos y control UI
let selectMode = 'origen';
let clienteRouteControl = null;

// Intervalos y seguimiento
let seguimientoInterval = null;
let ubicacionInterval = null;
let deliverysInterval = null;

// Control de peticiones
let ultimaPeticionTime = 0;
let ultimaPeticionDeliverys = 0;
let paginaVisible = true;
window.deliveryMarkers = [];

// ==================== OBTENER UBICACIÓN DE DELIVERY DESDE SUPABASE ====================
async function obtenerUbicacionDeSupabase(deliveryId) {
    const supabase = window.supabaseClient;
    if (!supabase) {
        console.warn("⚠️ Supabase no disponible");
        return null;
    }
    
    try {
        const { data, error } = await supabase
            .from('ubicaciones')
            .select('lat, lng, updated_at, online')
            .eq('delivery_id', deliveryId)
            .maybeSingle();
        
        if (error) {
            console.error("❌ Error obteniendo ubicación:", error);
            return null;
        }
        
        if (!data) {
            return null;
        }
        
        return {
            lat: data.lat,
            lng: data.lng,
            online: data.online,
            updated_at: data.updated_at
        };
        
    } catch(e) {
        console.error('❌ Error:', e);
        return null;
    }
}

// ==================== BLOQUEAR/REACTIVAR UI ====================
function bloquearUIporPedidoActivo(bloquear) {
    const elementos = {
        inputs: ['origen', 'destino'],
        select: 'tipoEnvio',
        botones: ['btnOrigen', 'btnDestino']
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
        
        const btnSolicitar = document.querySelector('button[onclick="solicitarEnvio()"]');
        if (btnSolicitar) {
            btnSolicitar.disabled = true;
            btnSolicitar.classList.add('opacity-50', 'cursor-not-allowed');
        }
        
        console.log("🔒 UI bloqueada");
        
    } else {
        elementos.inputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = false;
                input.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
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
        
        const btnSolicitar = document.querySelector('button[onclick="solicitarEnvio()"]');
        if (btnSolicitar) {
            btnSolicitar.disabled = false;
            btnSolicitar.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        
        console.log("🔓 UI reactivada");
    }
}

// Detectar cuando la pestaña está visible
document.addEventListener('visibilitychange', () => {
    paginaVisible = !document.hidden;
    if (paginaVisible) {
        console.log("🟢 Página visible");
        cargarDeliverysEnLinea();
    } else {
        console.log("🔴 Página oculta");
    }
});

// ==================== INICIALIZACIÓN CON MAPLIBRE ====================
function initMap() {
    if (map) {
        console.log("⚠️ Mapa ya inicializado");
        return;
    }
    
    console.log("🗺️ Inicializando mapa Cliente...");

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
                source: 'osm-raster',
                minzoom: 0,
                maxzoom: 19
            }]
        },
        center: [-91.8249, 18.6456],
        zoom: 13.5,
        minZoom: 12,
        maxZoom: 18
    });
    
    window.map = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    map.on('load', () => {
        console.log('✅ Mapa Cliente cargado');
        crearMarcadoresIniciales();
        
        setTimeout(() => {
            cargarDeliverysEnLinea();
            startLocationTracking();
        }, 1000);
    });

    // Escuchar eventos de zoom
    map.on('zoomstart', () => {
        ultimoZoomEnd = 0;
    });
    
    map.on('zoomend', () => {
        ultimoZoomEnd = Date.now();
    });
    
    map.on('movestart', () => {
        // No hacer nada, solo registrar
    });
    
    map.on('moveend', () => {
        ultimoZoomEnd = Date.now();
    });
}

// ==================== CALCULAR TARIFA ====================
function calculateShippingRate(distanceKm, tipo) {
    const km = parseFloat(distanceKm);
    let baseRate = 0;
    
    if (km <= 1) baseRate = 30;
    else if (km <= 2) baseRate = 35;
    else if (km <= 3) baseRate = 40;
    else if (km <= 4) baseRate = 45;
    else if (km <= 5) baseRate = 50;
    else if (km <= 6) baseRate = 60;
    else if (km <= 7) baseRate = 70;
    else baseRate = 70 + ((km - 7) * 10);
    
    if (tipo === 'comida') baseRate += 5;
    else if (tipo === 'farmacia') baseRate += 5;
    else if (tipo === 'mercancia') baseRate += 10;
    
    return { 
        total: Math.round(baseRate), 
        base: Math.round(baseRate)
    };
}

// ==================== CREAR MARCADORES INICIALES ====================
function crearMarcadoresIniciales() {
    console.log("🟢 Creando marcadores...");
    
    if (originMarker) {
        try { originMarker.remove(); } catch(e) {}
        originMarker = null;
    }
    if (destMarker) {
        try { destMarker.remove(); } catch(e) {}
        destMarker = null;
    }
    
    // Marcador ORIGEN
    const elOrigen = document.createElement('div');
    elOrigen.style.cssText = 'background:#FF6200; width:32px; height:32px; border-radius:50%; border:3px solid white; cursor:grab; display:flex; align-items:center; justify-content:center;';
    elOrigen.innerHTML = '<i class="fas fa-circle" style="color:white; font-size:14px;"></i>';
    
    originMarker = new maplibregl.Marker({ element: elOrigen, draggable: true })
        .setLngLat([-91.8249, 18.6456])
        .addTo(map);
    
    originMarker.on('dragend', () => {
        const { lng, lat } = originMarker.getLngLat();
        if (lat >= 18.58 && lat <= 18.70 && lng >= -91.88 && lng <= -91.75) {
            originCoords = { lat, lng };
            reverseGeocode(originCoords, (addr) => {
                document.getElementById("origen").value = addr;
            });
            actualizarRutaYTarifa();
            mostrarToast("📍 Origen actualizado");
        } else {
            mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
            if (originCoords) originMarker.setLngLat([originCoords.lng, originCoords.lat]);
        }
    });
    
    // Marcador DESTINO
    const elDestino = document.createElement('div');
    elDestino.style.cssText = 'background:#3B82F6; width:32px; height:32px; border-radius:50%; border:3px solid white; cursor:grab; display:flex; align-items:center; justify-content:center;';
    elDestino.innerHTML = '<i class="fas fa-flag-checkered" style="color:white; font-size:14px;"></i>';
    
    destMarker = new maplibregl.Marker({ element: elDestino, draggable: true })
        .setLngLat([-91.8149, 18.6556])
        .addTo(map);
    
    destMarker.on('dragend', () => {
        const { lng, lat } = destMarker.getLngLat();
        if (lat >= 18.58 && lat <= 18.70 && lng >= -91.88 && lng <= -91.75) {
            destCoords = { lat, lng };
            reverseGeocode(destCoords, (addr) => {
                document.getElementById("destino").value = addr;
            });
            actualizarRutaYTarifa();
            mostrarToast("🏁 Destino actualizado");
        } else {
            mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
            if (destCoords) destMarker.setLngLat([destCoords.lng, destCoords.lat]);
        }
    });
    
    // Inicializar coordenadas
    originCoords = { lat: 18.6456, lng: -91.8249 };
    destCoords = { lat: 18.6556, lng: -91.8149 };
    
    reverseGeocode(originCoords, (addr) => {
        document.getElementById("origen").value = addr;
    });
    reverseGeocode(destCoords, (addr) => {
        document.getElementById("destino").value = addr;
    });
    
    setTimeout(() => {
        if (originCoords && destCoords) {
            const bounds = new maplibregl.LngLatBounds()
                .extend([originCoords.lng, originCoords.lat])
                .extend([destCoords.lng, destCoords.lat]);
            map.fitBounds(bounds, { padding: 80, duration: 1600, maxZoom: 16.5 });
        }
    }, 800);
    
    setTimeout(() => actualizarRutaYTarifa(), 500);
}

// ==================== INICIAR SEGUIMIENTO DE UBICACIÓN ====================
function startLocationTracking() {
    if (!map || !map.loaded()) {
        setTimeout(() => startLocationTracking(), 1000);
        return;
    }

    if (!navigator.geolocation) {
        mostrarToast("❌ Tu navegador no soporta geolocalización", true);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const lng = pos.coords.longitude;
            const lat = pos.coords.latitude;

            if (userMarker) userMarker.remove();

            const primerNombre = (currentUser?.nombre || 'Cliente').split(' ')[0];

            const markerDiv = document.createElement('div');
            markerDiv.innerHTML = `
                <div style="position:relative; display:flex; flex-direction:column; align-items:center;">
                    <div style="background:rgba(0,0,0,0.8); color:white; font-size:12px; padding:4px 12px; border-radius:20px; margin-bottom:6px;">
                        ${primerNombre}
                    </div>
                    <div style="background:#3B82F6; width:38px; height:38px; border-radius:50%; border:3px solid white; display:flex; align-items:center; justify-content:center;">
                        <i class="fas fa-user" style="color:white; font-size:20px;"></i>
                    </div>
                </div>
            `;

            userMarker = new maplibregl.Marker({
                element: markerDiv,
                anchor: 'bottom'
            })
            .setLngLat([lng, lat])
            .addTo(map);

            if (!isUserInteracting) {
                map.flyTo({ center: [lng, lat], zoom: 15, duration: 1400 });
            }

            mostrarToast("📍 Tu ubicación detectada");
        },
        (err) => {
            console.error("Error de geolocalización:", err);
            if (err.code === 1) {
                mostrarToast("❌ Permite el acceso a tu ubicación", true);
            }
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
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
    mostrarToast("📍 Mapa centrado");
}

function setSelectMode(mode) {
    selectMode = mode;
    const btnOrigen = document.getElementById('btnOrigen');
    const btnDestino = document.getElementById('btnDestino');
    
    if (btnOrigen) btnOrigen.className = mode === 'origen' ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-700';
    if (btnDestino) btnDestino.className = mode === 'destino' ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-700';
    
    if (mode === 'origen') {
        mostrarToast("📍 Modo ORIGEN - Selecciona en el mapa");
    } else {
        mostrarToast("🏁 Modo DESTINO - Selecciona en el mapa");
    }
}

// ==================== LIMPIAR RUTA ====================
function limpiarRutaCliente() {
    if (!map) return;
    
    const routeLayers = ['current-route', 'route-layer', 'delivery-route', 'delivery-route-source', 'fallback-line'];
    const routeSources = ['current-route', 'route-source', 'delivery-route', 'fallback-line'];
    
    routeLayers.forEach(layerId => {
        try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch(e) {}
    });
    
    routeSources.forEach(sourceId => {
        try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch(e) {}
    });
}

// ==================== DIBUJAR RUTA ====================
async function dibujarRutaMapLibre(origin, dest, color, weight = 5) {
    if (!map || !origin || !dest) return null;
    
    limpiarRutaCliente();
    
    try {
        const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`
        );
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            
            map.addSource('current-route', {
                type: 'geojson',
                data: route.geometry
            });
            
            map.addLayer({
                id: 'current-route',
                type: 'line',
                source: 'current-route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': color, 'line-width': weight, 'line-opacity': 0.8 }
            });
            
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

// ==================== ACTUALIZAR RUTA Y TARIFA ====================
async function actualizarRutaYTarifa() {
    if (originCoords && destCoords) {
        const tarifaContainer = document.getElementById("tarifaContainer");
        if (tarifaContainer) tarifaContainer.classList.remove("hidden");
        
        const tarifaValue = document.getElementById("tarifaValue");
        if (tarifaValue) tarifaValue.innerHTML = '<div class="loading-spinner"></div> Calculando...';
        
        const tipoEnvio = document.getElementById("tipoEnvio")?.value || 'paquete';
        
        const routeResult = await dibujarRutaMapLibre(originCoords, destCoords, '#FF6200', 5);
        
        if (routeResult) {
            const rate = calculateShippingRate(routeResult.distance, tipoEnvio);
            
            currentRouteData = { 
                distance: routeResult.distance, 
                duration: routeResult.duration,
                extras: currentRouteData?.extras || { lluvia: false, noche: false, espera: false }
            };
            
            let tarifaMostrar = rate.total;
            if (currentRouteData.extras.lluvia) tarifaMostrar += 10;
            if (currentRouteData.extras.noche) tarifaMostrar += 10;
            if (currentRouteData.extras.espera) tarifaMostrar += 10;
            
            if (tarifaValue) tarifaValue.innerHTML = `$${tarifaMostrar} MXN`;
            mostrarToast(`📏 Distancia: ${routeResult.distance.toFixed(2)} km`);
            
        } else {
            const distance = calcularDistancia();
            const rate = calculateShippingRate(distance, tipoEnvio);
            if (tarifaValue) tarifaValue.innerHTML = `$${rate.total} MXN (estimado)`;
        }
    }
}

function formatDuration(minutes) {
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}min`;
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

// ==================== CREAR MARCADOR DELIVERY ====================
function crearMarcadorDelivery(delivery) {
    if (!map || !delivery || typeof delivery.lat !== 'number' || typeof delivery.lng !== 'number') {
        return null;
    }
    
    try {
        const primerNombre = (delivery.nombre || 'Delivery').split(' ')[0];
        const color = delivery.online ? '#10B981' : '#6B7280';
        
        const markerDiv = document.createElement('div');
        markerDiv.innerHTML = `
            <div style="position: relative; transform: translateY(-100%); display: flex; flex-direction: column; align-items: center;">
                <div style="background:rgba(0,0,0,0.7); color:white; font-size:11px; padding:4px 10px; border-radius:20px; margin-bottom:6px; white-space:nowrap;">
                    ${primerNombre}
                </div>
                <div style="background-color: ${color}; width:32px; height:32px; border-radius:50%; border:2.5px solid white; display:flex; align-items:center; justify-content:center;">
                    <i class="fas fa-motorcycle" style="color:white; font-size:16px;"></i>
                </div>
            </div>
        `;
        
        const marker = new maplibregl.Marker({
            element: markerDiv.firstElementChild,
            draggable: false,
            anchor: 'bottom'
        }).setLngLat([delivery.lng, delivery.lat]).addTo(map);
        
        return marker;
    } catch(e) {
        console.error("Error creando marcador:", e);
        return null;
    }
}

// ==================== SOLICITAR ENVÍO ====================
async function solicitarEnvio() {
    const origen = document.getElementById("origen").value;
    const destino = document.getElementById("destino").value;
    const tipo = document.getElementById("tipoEnvio").value;
    
    if (!originCoords || !destCoords) {
        mostrarToast("❌ Selecciona origen y destino válidos", true);
        return;
    }
    
    if (!tipo) {
        mostrarToast("❌ Selecciona qué vas a enviar", true);
        return;
    }
    
    let distancia = currentRouteData ? currentRouteData.distance : calcularDistancia();
    const rate = calculateShippingRate(distancia, tipo);
    let tarifaFinal = rate.total;
    
    if (currentRouteData && currentRouteData.extras) {
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
        extras: currentRouteData?.extras || {},
        estado: 'pendiente',
        fecha: new Date().toISOString()
    };
    
    document.getElementById("modalPago").classList.remove("hidden");
    document.getElementById("modalPago").classList.add("flex");
}

function seleccionarPago(metodo) { 
    cerrarModalPago(); 
    if (metodo === 'efectivo') {
        document.getElementById("efectivoTotal").innerHTML = `$${pedidoPendiente.tarifa}`;
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
        mostrarToast(`❌ Faltan $${(total - paga).toFixed(2)}`, true);
        return;
    }
    
    await guardarPedidoEnSupabase();
    cerrarModalEfectivo();
}

// ==================== PANEL DE ESTADO ====================
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
    
    switch(estado) {
        case 'pendiente':
            if(estadoTexto) estadoTexto.innerText = "⏳ Pedido pendiente";
            if(estadoIcono) estadoIcono.className = "fas fa-clock text-yellow-500";
            if(estadoDetalle) estadoDetalle.innerText = "Esperando delivery...";
            break;
        case 'asignado':
            if(estadoTexto) estadoTexto.innerText = "🚚 En camino a recoger";
            if(estadoIcono) estadoIcono.className = "fas fa-motorcycle text-orange-500";
            if(estadoDetalle) estadoDetalle.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> va a recoger tu paquete`;
            break;
        case 'recogido':
            if(estadoTexto) estadoTexto.innerText = "📦 Paquete recogido";
            if(estadoIcono) estadoIcono.className = "fas fa-box-open text-purple-500";
            if(estadoDetalle) estadoDetalle.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> va en camino`;
            break;
        case 'completado':
            const panel = document.getElementById("panelEstadoPedido");
            if(panel) panel.classList.add("hidden");
            pedidoActual = null;
            bloquearUIporPedidoActivo(false);
            if(seguimientoInterval) clearInterval(seguimientoInterval);
            if(ubicacionInterval) clearInterval(ubicacionInterval);
            if(deliveryMarker) { deliveryMarker.remove(); deliveryMarker = null; }
            limpiarRutaCliente();
            cargarDeliverysEnLinea();
            mostrarToast("🎉 ¡Envío completado!");
            break;
    }
}

// ==================== MOSTRAR RESUMEN DE RUTA ====================
function mostrarResumenRuta() {
    if (!originCoords || !destCoords) {
        mostrarToast("❌ Selecciona origen y destino primero", true);
        return;
    }
    
    const distancia = currentRouteData ? currentRouteData.distance : calcularDistancia();
    const tipo = document.getElementById("tipoEnvio")?.value || 'paquete';
    const rate = calculateShippingRate(distancia, tipo);
    
    // Crear modal de resumen
    let modalExistente = document.getElementById("modalResumenRuta");
    if (modalExistente) modalExistente.remove();
    
    const modal = document.createElement('div');
    modal.id = "modalResumenRuta";
    modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10001] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl max-w-sm w-full">
            <div class="text-center pt-4 pb-2 border-b border-gray-700">
                <div class="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-2">
                    <i class="fas fa-route text-white text-xl"></i>
                </div>
                <h2 class="text-lg font-bold text-white">Resumen de Ruta</h2>
            </div>
            
            <div class="p-4 space-y-3">
                <div class="bg-gray-700 rounded-lg p-3">
                    <div class="flex justify-between items-center">
                        <span class="text-gray-400">📏 Distancia</span>
                        <span class="text-white font-bold">${distancia.toFixed(2)} km</span>
                    </div>
                    <div class="flex justify-between items-center mt-2">
                        <span class="text-gray-400">💰 Tarifa base</span>
                        <span class="text-white font-bold">$${rate.total} MXN</span>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-lg p-3">
                    <p class="text-gray-400 text-xs mb-2">📦 Extras (+$10 c/u)</p>
                    <div class="flex gap-3 justify-center">
                        <label class="flex flex-col items-center cursor-pointer">
                            <i class="fas fa-cloud-rain text-blue-400 text-xl"></i>
                            <span class="text-white text-xs">Lluvia</span>
                            <input type="checkbox" id="extraLluvia" class="mt-1" onchange="actualizarTotalResumen()">
                        </label>
                        <label class="flex flex-col items-center cursor-pointer">
                            <i class="fas fa-moon text-yellow-400 text-xl"></i>
                            <span class="text-white text-xs">Noche</span>
                            <input type="checkbox" id="extraNoche" class="mt-1" onchange="actualizarTotalResumen()">
                        </label>
                        <label class="flex flex-col items-center cursor-pointer">
                            <i class="fas fa-clock text-purple-400 text-xl"></i>
                            <span class="text-white text-xs">Espera</span>
                            <input type="checkbox" id="extraEspera" class="mt-1" onchange="actualizarTotalResumen()">
                        </label>
                    </div>
                </div>
                
                <div class="bg-orange-500 rounded-lg p-3 flex justify-between items-center">
                    <span class="text-white font-bold">💰 Total</span>
                    <span class="text-white font-bold text-xl" id="totalResumen">$${rate.total} MXN</span>
                </div>
            </div>
            
            <div class="px-4 pb-4 flex gap-2">
                <button onclick="cerrarModalResumen()" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg">Cancelar</button>
                <button onclick="confirmarResumenYPagar()" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg">✅ Aceptar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Guardar datos globales
    window.tarifaBaseResumen = rate.total;
    window.distanciaResumen = distancia;
    
    // Actualizar el total inicial
    actualizarTotalResumen();
}

function actualizarTotalResumen() {
    const extraLluvia = document.getElementById("extraLluvia")?.checked || false;
    const extraNoche = document.getElementById("extraNoche")?.checked || false;
    const extraEspera = document.getElementById("extraEspera")?.checked || false;
    
    let total = window.tarifaBaseResumen || 0;
    if (extraLluvia) total += 10;
    if (extraNoche) total += 10;
    if (extraEspera) total += 10;
    
    const totalSpan = document.getElementById("totalResumen");
    if (totalSpan) totalSpan.innerHTML = `$${total} MXN`;
    
    // Guardar extras seleccionados
    window.extrasSeleccionadosResumen = {
        lluvia: extraLluvia,
        noche: extraNoche,
        espera: extraEspera
    };
}

function confirmarResumenYPagar() {
    console.log("✅ Confirmando resumen...");
    
    // Guardar extras en currentRouteData
    if (currentRouteData) {
        currentRouteData.extras = window.extrasSeleccionadosResumen || { lluvia: false, noche: false, espera: false };
    }
    
    // Actualizar tarifa mostrada
    const totalSpan = document.getElementById("totalResumen");
    let totalFinal = window.tarifaBaseResumen || 0;
    
    if (window.extrasSeleccionadosResumen) {
        if (window.extrasSeleccionadosResumen.lluvia) totalFinal += 10;
        if (window.extrasSeleccionadosResumen.noche) totalFinal += 10;
        if (window.extrasSeleccionadosResumen.espera) totalFinal += 10;
    }
    
    const tarifaElement = document.getElementById("tarifaValue");
    if (tarifaElement) tarifaElement.innerHTML = `$${totalFinal} MXN`;
    
    const tarifaElementMobile = document.getElementById("tarifaValueMobile");
    if (tarifaElementMobile) tarifaElementMobile.innerHTML = `$${totalFinal} MXN`;
    
    // Cerrar modal y abrir pago
    cerrarModalResumen();
    
    // Si hay pedido pendiente, actualizar tarifa
    if (pedidoPendiente) {
        pedidoPendiente.tarifa = totalFinal;
        pedidoPendiente.extras = window.extrasSeleccionadosResumen || {};
    }
    
    mostrarToast(`💰 Total: $${totalFinal} MXN`);
    
    // Abrir modal de pago
    const modalPago = document.getElementById("modalPago");
    if (modalPago) {
        modalPago.classList.remove("hidden");
        modalPago.classList.add("flex");
    } else {
        // Si no hay modal de pago, crear uno
        mostrarModalPagoSimple(totalFinal);
    }
}

function mostrarModalPagoSimple(total) {
    let modalExistente = document.getElementById("modalPagoSimple");
    if (modalExistente) modalExistente.remove();
    
    const modal = document.createElement('div');
    modal.id = "modalPagoSimple";
    modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10001] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl max-w-sm w-full p-6 text-center">
            <div class="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-money-bill-wave text-white text-2xl"></i>
            </div>
            <h2 class="text-xl font-bold text-white mb-2">Método de Pago</h2>
            <p class="text-gray-400 mb-4">Total: <span class="text-orange-400 font-bold">$${total}</span> MXN</p>
            
            <div class="space-y-3">
                <button onclick="seleccionarPagoSimple('efectivo', ${total})" class="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-xl font-medium">
                    💵 Efectivo
                </button>
                <button onclick="seleccionarPagoSimple('transferencia', ${total})" class="w-full bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-xl font-medium">
                    📱 Transferencia
                </button>
                <button onclick="cerrarModalPagoSimple()" class="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl font-medium">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function seleccionarPagoSimple(metodo, total) {
    cerrarModalPagoSimple();
    
    if (metodo === 'efectivo') {
        // Mostrar modal de efectivo
        let modalExistente = document.getElementById("modalEfectivoSimple");
        if (modalExistente) modalExistente.remove();
        
        const modal = document.createElement('div');
        modal.id = "modalEfectivoSimple";
        modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10001] p-4";
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-2xl max-w-sm w-full p-6">
                <h2 class="text-xl font-bold text-white mb-4 text-center">Pago en Efectivo</h2>
                <p class="text-gray-400 text-center mb-4">Total a pagar: <span class="text-orange-400 font-bold">$${total}</span></p>
                
                <div class="mb-4">
                    <label class="text-white text-sm mb-2 block">Monto con que paga:</label>
                    <input type="number" id="montoPagaSimple" placeholder="0" class="w-full bg-gray-700 text-white rounded-lg px-4 py-3">
                </div>
                
                <div class="mb-4 text-center">
                    <p class="text-gray-400">Cambio a devolver:</p>
                    <p id="cambioSimple" class="text-green-400 text-2xl font-bold">$0</p>
                </div>
                
                <div class="flex gap-2">
                    <button onclick="cerrarModalEfectivoSimple()" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg">Cancelar</button>
                    <button onclick="confirmarPagoEfectivoSimple(${total})" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg">Pagar</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const montoInput = document.getElementById("montoPagaSimple");
        if (montoInput) {
            montoInput.addEventListener('input', () => {
                const paga = parseFloat(montoInput.value) || 0;
                const cambio = paga - total;
                const cambioSpan = document.getElementById("cambioSimple");
                if (cambioSpan) cambioSpan.innerHTML = `$${cambio >= 0 ? cambio : 0}`;
            });
        }
        
    } else if (metodo === 'transferencia') {
        mostrarToast("✅ Transferencia seleccionada. Confirma tu pedido.");
        confirmarPagoTransferenciaSimple();
    }
}

function confirmarPagoEfectivoSimple(total) {
    const montoInput = document.getElementById("montoPagaSimple");
    const paga = parseFloat(montoInput?.value) || 0;
    
    if (paga < total) {
        mostrarToast(`❌ Faltan $${(total - paga).toFixed(2)}`, true);
        return;
    }
    
    cerrarModalEfectivoSimple();
    guardarPedidoEnSupabase();
}

function confirmarPagoTransferenciaSimple() {
    guardarPedidoEnSupabase();
}

function cerrarModalPagoSimple() {
    const modal = document.getElementById("modalPagoSimple");
    if (modal) modal.remove();
}

function cerrarModalEfectivoSimple() {
    const modal = document.getElementById("modalEfectivoSimple");
    if (modal) modal.remove();
}

function cerrarModalResumen() {
    const modal = document.getElementById("modalResumenRuta");
    if (modal) modal.remove();
}

// ==================== GUARDAR PEDIDO ====================
async function guardarPedidoEnSupabase() {
    const supabase = window.supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
        const { error } = await supabase
            .from('pedidos')
            .insert([pedidoPendiente]);
        
        if (error) throw error;
        
        pedidoActual = pedidoPendiente;
        
        cerrarModalPago();
        cerrarModalEfectivo();
        cerrarModalTransferencia();
        
        mostrarPanelEstado(pedidoActual);
        mostrarToast(`✅ Pedido #${pedidoActual.id} creado`);
        iniciarSeguimientoDelivery();
        
    } catch(e) {
        console.error('Error:', e);
        mostrarToast("❌ Error al crear pedido", true);
    }
}

function enviarComprobanteWhatsApp() {
    if (!pedidoPendiente) return;
    
    const mensaje = `MANDAYA - Pedido #${pedidoPendiente.id}\nTotal: $${pedidoPendiente.tarifa} MXN`;
    window.open(`https://wa.me/5219381083498?text=${encodeURIComponent(mensaje)}`, '_blank');
    confirmarPagoTransferencia();
}

async function confirmarPagoTransferencia() {
    await guardarPedidoEnSupabase();
    cerrarModalTransferencia();
}

function cerrarModalPago() {
    const modal = document.getElementById("modalPago");
    if(modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

function cerrarModalEfectivo() {
    const modal = document.getElementById("modalEfectivo");
    if(modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

function cerrarModalTransferencia() {
    const modal = document.getElementById("modalTransferencia");
    if(modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

// ==================== SEGUIMIENTO DE DELIVERY ====================
function iniciarSeguimientoDelivery() {
    if (!pedidoActual) return;

    if (seguimientoInterval) clearInterval(seguimientoInterval);
    if (ubicacionInterval) clearInterval(ubicacionInterval);
    
    seguimientoInterval = setInterval(async () => {
        const supabase = window.supabaseClient;
        if (!supabase) return;
        
        try {
            const { data: pedidoActualizado, error } = await supabase
                .from('pedidos')
                .select('*')
                .eq('id', pedidoActual.id)
                .single();
            
            if (error) throw error;
            
            if (pedidoActualizado) {
                pedidoActual = pedidoActualizado;
                
                if (pedidoActualizado.estado === 'completado') {
                    actualizarEstadoPanel('completado');
                    if (seguimientoInterval) clearInterval(seguimientoInterval);
                    if (ubicacionInterval) clearInterval(ubicacionInterval);
                    seguimientoInterval = null;
                    ubicacionInterval = null;
                    return;
                }
                
                if (pedidoActualizado.estado === 'asignado' && pedidoActualizado.delivery_nombre) {
                    actualizarEstadoPanel('asignado', pedidoActualizado.delivery_nombre);
                    if (!ubicacionInterval && pedidoActualizado.delivery_id) {
                        seguirUbicacionDelivery(pedidoActualizado.delivery_id);
                    }
                } else if (pedidoActualizado.estado === 'recogido' && pedidoActualizado.delivery_nombre) {
                    actualizarEstadoPanel('recogido', pedidoActualizado.delivery_nombre);
                }
            }
        } catch(e) {
            console.error('Error:', e);
        }
    }, 5000);
}

// ==================== SEGUIMIENTO UBICACIÓN DELIVERY ====================
function seguirUbicacionDelivery(deliveryId) {
    if (ubicacionInterval) clearInterval(ubicacionInterval);

    ubicacionInterval = setInterval(async () => {
        if (!pedidoActual || !map) return;

        const estaEnMovimiento = map.isMoving() || map.isZooming();
        const acabaDeTerminarZoom = (Date.now() - ultimoZoomEnd) < 2000;
        
        if (estaEnMovimiento || acabaDeTerminarZoom || actualizandoDelivery) {
            return;
        }
        
        actualizandoDelivery = true;

        try {
            const ubicacion = await obtenerUbicacionDeSupabase(deliveryId);
            if (!ubicacion?.lat || !ubicacion?.lng) return;

            let cambioSignificativo = false;
            
            if (!ultimaPosicionDelivery) {
                cambioSignificativo = true;
            } else {
                const distanciaMovida = calcularDistanciaMetros(
                    ultimaPosicionDelivery.lat, ultimaPosicionDelivery.lng, 
                    ubicacion.lat, ubicacion.lng
                );
                cambioSignificativo = distanciaMovida > 15;
            }

            if (cambioSignificativo) {
                ultimaPosicionDelivery = { lat: ubicacion.lat, lng: ubicacion.lng };
                
                if (deliveryMarker) {
                    deliveryMarker.setLngLat([ubicacion.lng, ubicacion.lat]);
                } else {
                    deliveryMarker = crearMarcadorDelivery({
                        id: deliveryId,
                        nombre: pedidoActual?.delivery_nombre || 'Delivery',
                        lat: ubicacion.lat,
                        lng: ubicacion.lng,
                        online: true
                    });
                }

                if (pedidoActual) {
                    let destinoRuta = null;
                    if (pedidoActual.estado === 'asignado' && pedidoActual.origen_lat) {
                        destinoRuta = { lat: pedidoActual.origen_lat, lng: pedidoActual.origen_lng };
                    } else if (pedidoActual.estado === 'recogido' && pedidoActual.destino_lat) {
                        destinoRuta = { lat: pedidoActual.destino_lat, lng: pedidoActual.destino_lng };
                    }

                    if (destinoRuta) {
                        await dibujarRutaDeliverySinCentrar(
                            { lng: ubicacion.lng, lat: ubicacion.lat }, 
                            destinoRuta, 
                            pedidoActual.estado
                        );
                    }
                }
            }
        } catch(e) {
            console.error("Error:", e);
        } finally {
            actualizandoDelivery = false;
        }
        
    }, 8000);
}

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
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

async function dibujarRutaDeliverySinCentrar(origin, dest, tipo) {
    if (!map || !origin || !dest) return;

    const claveRuta = `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}-${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}-${tipo}`;
    
    if (ultimaRutaDibujada === claveRuta) return;
    
    ultimaRutaDibujada = claveRuta;

    const color = tipo === 'asignado' ? '#10B981' : '#FF6200';
    const layerId = 'delivery-route';
    const sourceId = 'delivery-route-source';

    try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch(e) {}

    try {
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`);
        const data = await response.json();

        if (data.routes && data.routes[0]) {
            map.addSource(sourceId, { type: 'geojson', data: data.routes[0].geometry });
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': color, 'line-width': 5.5, 'line-opacity': 0.85 }
            });
        }
    } catch(e) {
        console.error("Error:", e);
    }
}

function centrarEnDelivery() {
    if (!deliveryMarker) {
        mostrarToast("❌ No hay delivery activo", true);
        return;
    }
    
    const pos = deliveryMarker.getLngLat();
    map.flyTo({ center: [pos.lng, pos.lat], zoom: 16, duration: 1000 });
    mostrarToast("🎯 Centrado en delivery");
}

// ==================== CARGAR DELIVERYS ====================
async function cargarDeliverysEnLinea() {
    if (!map || !map.loaded() || !paginaVisible) return;

    const ahora = Date.now();
    if (ahora - ultimaPeticionDeliverys < 8000) return;
    ultimaPeticionDeliverys = ahora;

    const supabase = window.supabaseClient;
    if (!supabase) return;

    try {
        const { data: deliverys, error } = await supabase
            .from('ubicaciones')
            .select('*')
            .eq('online', true)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        if (window.deliveryMarkers) {
            window.deliveryMarkers.forEach(marker => {
                if (marker && marker.remove) marker.remove();
            });
            window.deliveryMarkers = [];
        }

        if (!deliverys || deliverys.length === 0) return;

        for (const delivery of deliverys) {
            if (pedidoActual && pedidoActual.delivery_id === delivery.delivery_id) continue;

            const marker = crearMarcadorDelivery({
                id: delivery.delivery_id,
                nombre: delivery.delivery_nombre,
                lat: delivery.lat,
                lng: delivery.lng,
                online: true
            });

            if (marker) window.deliveryMarkers.push(marker);
        }

    } catch(e) {
        console.error("Error:", e);
    }
}

// ==================== HISTORIAL Y PERFIL ====================
function verHistorial() {
    mostrarToast("📋 Funcionalidad en desarrollo");
}

function verPerfil() {
    mostrarToast(`👤 ${currentUser?.nombre}\n📧 ${currentUser?.email}`);
}

function cerrarSesion() {
    if (confirm("¿Cerrar sesión?")) {
        if (seguimientoInterval) clearInterval(seguimientoInterval);
        if (ubicacionInterval) clearInterval(ubicacionInterval);
        if (deliverysInterval) clearInterval(deliverysInterval);
        
        if (window.deliveryMarkers) {
            window.deliveryMarkers.forEach(m => { if(m && m.remove) m.remove(); });
            window.deliveryMarkers = [];
        }
        
        if (deliveryMarker) deliveryMarker.remove();
        
        localStorage.removeItem('sesion_activa');
        window.location.href = "index.html";
    }
}

// ==================== TOAST ====================
function mostrarToast(msg, err = false) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-full shadow-lg z-50 text-sm';
    if (err) toast.classList.add('bg-red-500');
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ==================== INICIALIZACIÓN ====================
function cancelarPedido() {
    mostrarToast("❌ No se puede cancelar", true);
}

window.onload = () => { 
    loadUser(); 
    initMap();
    
    if (currentUser && currentUser.rol === 'cliente') {
        setTimeout(() => {
            if (deliverysInterval) clearInterval(deliverysInterval);
            deliverysInterval = setInterval(() => {
                if (map && map.loaded()) cargarDeliverysEnLinea();
            }, 15000);
        }, 3000);
    }
};