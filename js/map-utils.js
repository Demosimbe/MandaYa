// Utilidades para mapas y rutas

function getMotoIcon() {
    return L.divIcon({
        html: '<div style="background:#FF6200; width:32px; height:32px; border-radius:50%; border:2px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-motorcycle" style="color:white; font-size:16px;"></i></div>',
        iconSize: [32, 32],
        className: 'moto-marker'
    });
}

async function drawRealRoute(map, origin, dest, color, weight) {
    if (!map || !origin || !dest) return null;
    
    try {
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`);
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            const line = L.geoJSON(route.geometry, {
                style: { color: color, weight: weight, opacity: 0.8 }
            }).addTo(map);
            
            const bounds = L.latLngBounds([origin, dest]);
            map.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: 16
        });
            
            return {
                line: line,
                routeData: {
                    distance: route.distance / 1000,
                    duration: route.duration / 60
                }
            };
        }
    } catch(e) {
        console.error('Error dibujando ruta:', e);
    }
    return null;
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

function calculateShippingRate(distanceKm, tipo) {
    const km = Math.round(distanceKm);
    
    // Tarifa base por kilómetro
    let baseRate = 0;
    if (km <= 1) baseRate = 30;
    else if (km <= 2) baseRate = 35;
    else if (km <= 3) baseRate = 40;
    else if (km <= 4) baseRate = 45;
    else if (km <= 5) baseRate = 50;
    else if (km <= 6) baseRate = 60;
    else if (km <= 7) baseRate = 70;
    else baseRate = 70 + ((km - 7) * 10); // Más de 7 km: +$10 por km
    
    return { 
        total: baseRate, 
        base: baseRate, 
        porKm: null 
    };
}

// ✅ Función para calcular distancia entre dos puntos (útil para fallback)
function calcularDistanciaEntrePuntos(punto1, punto2) {
    if (!punto1 || !punto2) return 0;
    const R = 6371; // km
    const dLat = (punto2.lat - punto1.lat) * Math.PI / 180;
    const dLon = (punto2.lng - punto1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(punto1.lat * Math.PI / 180) * Math.cos(punto2.lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ==================== EXTRAER SOLO EL PRIMER NOMBRE ====================
function obtenerPrimerNombre(nombreCompleto) {
    if (!nombreCompleto) return 'Delivery';
    const primerNombre = nombreCompleto.trim().split(' ')[0];
    return primerNombre.length > 12 ? primerNombre.substring(0, 10) + '..' : primerNombre;
}

function formatDuration(minutes) {
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}min`;
}

// ==================== MARCADOR CON NOMBRE PARA DELIVERY ====================
function crearMarcadorDelivery(lat, lng, nombre, color, tienePedido = null) {
    let colorFinal = color;
    let estadoTexto = '';
    
    if (tienePedido !== null) {
        colorFinal = tienePedido ? '#FF6200' : '#10B981';
        estadoTexto = tienePedido ? '🟠 En entrega' : '🟢 Disponible';
    }
    
    // ✅ Obtener solo el primer nombre
    const nombreMostrar = obtenerPrimerNombre(nombre);
    
    const iconoConNombre = L.divIcon({
        html: `
            <div style="text-align: center;">
                <!-- ✅ NOMBRE ARRIBA con mejor fondo -->
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
                    ${nombreMostrar}
                </div>
                <!-- ✅ MOTO DEBAJO -->
                <div style="
                    background: ${colorFinal};
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
        className: 'delivery-marker',
        popupAnchor: [0, -25]
    });
    
    const marker = L.marker([lat, lng], { icon: iconoConNombre });
    
    if (estadoTexto) {
        marker.bindPopup(`<b>🏍️ ${nombre}</b><br>${estadoTexto}`);
    } else {
        marker.bindPopup(`<b>🏍️ ${nombre}</b>`);
    }
    
    return marker;
}

function convertirPedidoDeSupabase(pedidoSupabase) {
    return {
        id: pedidoSupabase.id,
        clienteId: pedidoSupabase.cliente_id,
        clienteNombre: pedidoSupabase.cliente_nombre,
        origen: pedidoSupabase.origen,
        destino: pedidoSupabase.destino,
        origenCoords: pedidoSupabase.origen_lat ? { lat: pedidoSupabase.origen_lat, lng: pedidoSupabase.origen_lng } : null,
        destinoCoords: pedidoSupabase.destino_lat ? { lat: pedidoSupabase.destino_lat, lng: pedidoSupabase.destino_lng } : null,
        tipo: pedidoSupabase.tipo,
        distanciaReal: pedidoSupabase.distancia_real,
        tarifa: pedidoSupabase.tarifa,
        estado: pedidoSupabase.estado,
        deliveryId: pedidoSupabase.delivery_id,
        deliveryNombre: pedidoSupabase.delivery_nombre,
        fecha: pedidoSupabase.fecha,
        fechaCompletado: pedidoSupabase.fecha_completado,
        origenCoords: (pedidoSupabase.origen_lat && pedidoSupabase.origen_lng) ? { lat: pedidoSupabase.origen_lat, lng: pedidoSupabase.origen_lng } : null,
        destinoCoords: (pedidoSupabase.destino_lat && pedidoSupabase.destino_lng) ? { lat: pedidoSupabase.destino_lat, lng: pedidoSupabase.destino_lng } : null
    };
}

// ==================== LIMITAR MAPA A CD DEL CARMEN ====================
function limitarMapaACarmen(map) {

    const southWest = L.latLng(18.58, -91.88);
    const northEast = L.latLng(18.70, -91.75);
    const bounds = L.latLngBounds(southWest, northEast);

    // 🔒 LÍMITES DUROS
    map.setMaxBounds(bounds);

    // 🔒 Hace que el usuario NO pueda arrastrar fuera
    map.options.maxBoundsViscosity = 1.0;

    // Zoom permitido
    map.setMinZoom(12);
    map.setMaxZoom(18);

    // 🔒 CORREGIR automáticamente si algo mueve el mapa fuera
    map.on('moveend', function () {

        if (!bounds.contains(map.getCenter())) {

            map.panInsideBounds(bounds, {
                animate: false
            });

        }

    });

    // 🔒 Evitar zoom raro
    map.on('zoomend', function () {

        if (map.getZoom() > 18) {
            map.setZoom(18);
        }

        if (map.getZoom() < 12) {
            map.setZoom(12);
        }

    });

    console.log('🗺️ Mapa BLOQUEADO a Ciudad del Carmen');
}

// Función para limitar coordenadas dentro de los límites de Ciudad del Carmen
function limitarCoordenadasACarmen(lat, lng) {
    const minLat = 18.58;
    const maxLat = 18.70;
    const minLng = -91.88;
    const maxLng = -91.75;
    
    let nuevaLat = lat;
    let nuevaLng = lng;
    
    if (lat < minLat) nuevaLat = minLat;
    if (lat > maxLat) nuevaLat = maxLat;
    if (lng < minLng) nuevaLng = minLng;
    if (lng > maxLng) nuevaLng = maxLng;
    
    return { lat: nuevaLat, lng: nuevaLng };
}

window.limitarCoordenadasACarmen = limitarCoordenadasACarmen;
window.getRealDistanceAndTime = getRealDistanceAndTime;
window.calcularDistanciaEntrePuntos = calcularDistanciaEntrePuntos;