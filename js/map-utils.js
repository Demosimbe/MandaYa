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