// ==================== UTILIDADES PARA MAPAS Y RUTAS ====================
// Se mantienen TODAS las funciones originales de Leaflet
// Se AGREGAN funciones de Mapbox sin eliminar nada

// ==================== FUNCIONES ORIGINALES DE LEAFLET (MANTENIDAS) ====================

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
    
    return { 
        total: baseRate, 
        base: baseRate, 
        porKm: null 
    };
}

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

function crearMarcadorDelivery(lat, lng, nombre, color, tienePedido = null) {
    let colorFinal = color;
    let estadoTexto = '';
    
    if (tienePedido !== null) {
        colorFinal = tienePedido ? '#FF6200' : '#10B981';
        estadoTexto = tienePedido ? '🟠 En entrega' : '🟢 Disponible';
    }
    
    const nombreMostrar = obtenerPrimerNombre(nombre);
    
    const iconoConNombre = L.divIcon({
        html: `
            <div style="text-align: center;">
                <div style="background: rgba(0,0,0,0.85); color: white; font-size: 11px; font-weight: bold; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 3px 8px; border-radius: 14px; margin-bottom: 4px; white-space: nowrap; display: inline-block; box-shadow: 0 1px 3px rgba(0,0,0,0.3); border: 0.5px solid rgba(255,255,255,0.2);">
                    ${nombreMostrar}
                </div>
                <div style="background: ${colorFinal}; width: 34px; height: 34px; border-radius: 50%; border: 2.5px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; margin: 0 auto;">
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
        fechaCompletado: pedidoSupabase.fecha_completado
    };
}

function limitarMapaACarmen(map) {
    const southWest = L.latLng(18.58, -91.88);
    const northEast = L.latLng(18.70, -91.75);
    const bounds = L.latLngBounds(southWest, northEast);
    
    map.setMaxBounds(bounds);
    
    map.setMinZoom(12);
    map.setMaxZoom(17);
    
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

// ==================== NUEVAS FUNCIONES PARA MAPBOX (AGREGADAS SIN ELIMINAR NADA) ====================

// Inicializar mapa Mapbox
function initMapboxMap(containerId, centerLng = -91.8249, centerLat = 18.6456, zoom = 13) {
    if (typeof mapboxgl === 'undefined') {
        console.error("Mapbox GL no está cargado");
        return null;
    }
    
    mapboxgl.accessToken = MAPBOX_TOKEN;
    
    const mapboxMap = new mapboxgl.Map({
        container: containerId,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [centerLng, centerLat],
        zoom: zoom,
        maxZoom: 17,
        minZoom: 12
    });
    
    mapboxMap.setMaxBounds([
        [-91.88, 18.58],
        [-91.75, 18.70]
    ]);
    
    return mapboxMap;
}

// Crear marcador arrastrable para Mapbox
function crearMarcadorArrastrable(lng, lat, color, popupTexto) {
    if (typeof mapboxgl === 'undefined') return null;
    
    const marker = new mapboxgl.Marker({
        draggable: true,
        color: color
    })
        .setLngLat([lng, lat])
        .setPopup(new mapboxgl.Popup().setHTML(popupTexto));
    
    return marker;
}

// Dibujar ruta con Mapbox
async function dibujarRutaMapbox(origen, destino, color = '#FF6200') {
    if (typeof mapboxgl === 'undefined' || !mapboxMap) return null;
    
    if (mapboxMap.getSource('route')) {
        if (mapboxMap.getLayer('route')) mapboxMap.removeLayer('route');
        mapboxMap.removeSource('route');
    }
    
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?geometries=geojson&access_token=${MAPBOX_TOKEN}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            const geojson = {
                type: 'Feature',
                geometry: route.geometry
            };
            
            mapboxMap.addSource('route', { type: 'geojson', data: geojson });
            mapboxMap.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                paint: {
                    'line-color': color,
                    'line-width': 5,
                    'line-opacity': 0.8
                }
            });
            
            const bounds = new mapboxgl.LngLatBounds()
                .extend([origen.lng, origen.lat])
                .extend([destino.lng, destino.lat]);
            mapboxMap.fitBounds(bounds, { padding: 50 });
            
            return {
                distance: route.distance / 1000,
                duration: route.duration / 60
            };
        }
    } catch(e) {
        console.error('Error dibujando ruta con Mapbox:', e);
    }
    return null;
}

// Geocodificación con Mapbox
async function geocodificarDireccion(query) {
    if (typeof mapboxgl === 'undefined' || !MAPBOX_TOKEN || MAPBOX_TOKEN === 'TU_TOKEN_AQUI') {
        console.log("Mapbox no configurado, geocodificación no disponible");
        return [];
    }
    
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=5&proximity=-91.8249,18.6456`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        return data.features.map(feature => ({
            nombre: feature.place_name.split(',')[0],
            direccion: feature.place_name,
            lat: feature.center[1],
            lng: feature.center[0]
        }));
    } catch(e) {
        console.error('Error geocodificando:', e);
        return [];
    }
}

// Reverse geocoding con Mapbox
async function reverseGeocodingMapbox(lat, lng) {
    if (typeof mapboxgl === 'undefined' || !MAPBOX_TOKEN || MAPBOX_TOKEN === 'TU_TOKEN_AQUI') {
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
    
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.features && data.features[0]) {
            return data.features[0].place_name.split(',')[0];
        }
    } catch(e) {
        console.error('Error reverse geocoding:', e);
    }
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Crear marcador de delivery para Mapbox
function crearMarcadorDeliveryMapbox(lat, lng, nombre, color) {
    if (typeof mapboxgl === 'undefined') return null;
    
    const el = document.createElement('div');
    el.className = 'delivery-marker';
    el.innerHTML = `
        <div style="text-align: center;">
            <div style="background: rgba(0,0,0,0.85); color: white; font-size: 10px; padding: 2px 6px; border-radius: 12px; white-space: nowrap;">
                ${obtenerPrimerNombre(nombre)}
            </div>
            <div style="background: ${color}; width: 28px; height: 28px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; margin-top: 2px;">
                <i class="fas fa-motorcycle" style="color: white; font-size: 14px;"></i>
            </div>
        </div>
    `;
    el.style.cursor = 'pointer';
    
    return new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .setPopup(new mapboxgl.Popup().setHTML(`<b>🏍️ ${nombre}</b>`));
}