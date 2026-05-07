// ==================== FUNCIONES ORIGINALES DE LEAFLET ====================
export function getMotoIcon() {
    return L.divIcon({
        html: '<div style="background:#FF6200; width:32px; height:32px; border-radius:50%; border:2px solid white;"><i class="fas fa-motorcycle" style="color:white; font-size:16px;"></i></div>',
        iconSize: [32, 32],
        className: 'moto-marker'
    });
}

export async function drawRealRoute(map, origin, dest, color, weight) {
    if (!map || !origin || !dest) return null;
    try {
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`);
        const data = await response.json();
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            const line = L.geoJSON(route.geometry, {
                style: { color: color, weight: weight, opacity: 0.8 }
            }).addTo(map);
            return { line: line, routeData: { distance: route.distance / 1000, duration: route.duration / 60 } };
        }
    } catch(e) { console.error('Error:', e); }
    return null;
}

export async function getRealDistanceAndTime(origin, dest) {
    if (!origin || !dest) return null;
    try {
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`);
        const data = await response.json();
        if (data.routes && data.routes[0]) {
            return { distance: data.routes[0].distance / 1000, duration: data.routes[0].duration / 60 };
        }
    } catch(e) { console.error('Error:', e); }
    return null;
}

export function calculateShippingRate(distanceKm, tipo) {
    const km = Math.round(distanceKm);
    let baseRate = 0;
    if (km <= 1) baseRate = 30;
    else if (km <= 2) baseRate = 35;
    else if (km <= 3) baseRate = 40;
    else if (km <= 4) baseRate = 45;
    else if (km <= 5) baseRate = 50;
    else if (km <= 6) baseRate = 60;
    else if (km <= 7) baseRate = 70;
    else baseRate = 70 + ((km - 7) * 10);
    return { total: baseRate, base: baseRate };
}

export function obtenerPrimerNombre(nombreCompleto) {
    if (!nombreCompleto) return 'Delivery';
    return nombreCompleto.trim().split(' ')[0];
}

export function formatDuration(minutes) {
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}min`;
}

export function crearMarcadorDelivery(lat, lng, nombre, color) {
    const nombreMostrar = obtenerPrimerNombre(nombre);
    const icono = L.divIcon({
        html: `<div style="text-align:center;"><div style="background:rgba(0,0,0,0.85); color:white; font-size:11px; padding:3px 8px; border-radius:14px;">${nombreMostrar}</div><div style="background:${color}; width:34px; height:34px; border-radius:50%; border:2px solid white; display:flex; align-items:center; justify-content:center;"><i class="fas fa-motorcycle" style="color:white; font-size:18px;"></i></div></div>`,
        iconSize: [50, 60],
        className: 'delivery-marker'
    });
    return L.marker([lat, lng], { icon: icono });
}

export function convertirPedidoDeSupabase(pedidoSupabase) {
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
        fecha: pedidoSupabase.fecha
    };
}

export function limitarMapaACarmen(map) {
    const bounds = L.latLngBounds(L.latLng(18.58, -91.88), L.latLng(18.70, -91.75));
    map.setMaxBounds(bounds);
    map.setMinZoom(12);
    map.setMaxZoom(17);
}

export async function geocodificarDireccion(query) {
    if (typeof MAPBOX_TOKEN === 'undefined' || !MAPBOX_TOKEN) return [];
    try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=5&proximity=-91.8249,18.6456`;
        const response = await fetch(url);
        const data = await response.json();
        return data.features.map(f => ({ nombre: f.place_name.split(',')[0], direccion: f.place_name, lat: f.center[1], lng: f.center[0] }));
    } catch(e) { return []; }
}

export async function reverseGeocodingMapbox(lat, lng) {
    if (typeof MAPBOX_TOKEN === 'undefined' || !MAPBOX_TOKEN) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}`;
        const response = await fetch(url);
        const data = await response.json();
        return data.features[0]?.place_name.split(',')[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch(e) { return `${lat.toFixed(4)}, ${lng.toFixed(4)}`; }
}

// ==================== FUNCIONES PARA MAPBOX ====================
export function crearMarcadorArrastrable(lng, lat, color, popupTexto) {
    if (typeof mapboxgl === 'undefined') return null;
    
    const marker = new mapboxgl.Marker({
        draggable: true,
        color: color
    })
        .setLngLat([lng, lat])
        .setPopup(new mapboxgl.Popup().setHTML(popupTexto));
    
    return marker;
}