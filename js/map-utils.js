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
            map.fitBounds(bounds, { padding: [50, 50] });
            
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
    let baseRate = 35;
    let ratePerKm = 8;
    
    if (tipo === 'comida') {
        baseRate = 30;
        ratePerKm = 7;
    } else if (tipo === 'farmacia') {
        baseRate = 40;
        ratePerKm = 9;
    } else if (tipo === 'mercancia') {
        baseRate = 50;
        ratePerKm = 10;
    }
    
    let total = baseRate + (distanceKm * ratePerKm);
    total = Math.max(total, 35);
    total = Math.round(total);
    
    return { total: total, base: baseRate, porKm: ratePerKm };
}

function formatDuration(minutes) {
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}min`;
}

// ==================== MARCADOR CON NOMBRE PARA DELIVERY ====================
function crearMarcadorDelivery(lat, lng, nombre, color, tienePedido = null) {
    // Determinar el color si no se especifica
    let colorFinal = color;
    let estadoTexto = '';
    
    if (tienePedido !== null) {
        colorFinal = tienePedido ? '#FF6200' : '#10B981';
        estadoTexto = tienePedido ? '🟠 En entrega' : '🟢 Disponible';
    }
    
    // Crear el icono con el nombre arriba
    const iconoConNombre = L.divIcon({
        html: `
            <div style="text-align: center;">
                <div style="
                    background: ${colorFinal};
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    border: 2px solid white;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto;
                ">
                    <i class="fas fa-motorcycle" style="color:white; font-size:16px;"></i>
                </div>
                <div style="
                    background: rgba(0,0,0,0.75);
                    color: white;
                    font-size: 10px;
                    font-weight: bold;
                    padding: 2px 6px;
                    border-radius: 12px;
                    margin-top: 2px;
                    white-space: nowrap;
                    font-family: sans-serif;
                    text-shadow: 0 0 2px black;
                ">
                    ${nombre}
                </div>
            </div>
        `,
        iconSize: [32, 50],  // Más alto para incluir el nombre
        className: 'delivery-marker',
        popupAnchor: [0, -20]  // El popup aparece arriba del nombre
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
        fechaCompletado: pedidoSupabase.fecha_completado
    };
}

// ==================== LIMITAR MAPA A CD DEL CARMEN ====================
function limitarMapaACarmen(map) {
    // Límites exactos de Ciudad del Carmen
    const southWest = L.latLng(18.58, -91.88);
    const northEast = L.latLng(18.70, -91.75);
    const bounds = L.latLngBounds(southWest, northEast);
    
    map.setMaxBounds(bounds);
    
    // ✅ Ahora podemos usar zoom hasta 17 (Voyager tiene tiles)
    map.setMinZoom(12);
    map.setMaxZoom(17);   // Cambiado de 15 a 17
    
    map.on('drag', function() {
        if (!bounds.contains(map.getCenter())) {
            map.panInsideBounds(bounds, { animate: true, duration: 0.5 });
        }
    });
    
    map.on('zoomend', function() {
        if (map.getZoom() > 17) {
            map.setZoom(17);
        }
        if (map.getZoom() < 12) {
            map.setZoom(12);
        }
    });
    
    console.log('🗺️ Mapa limitado a Ciudad del Carmen (zoom 12-17)');
}