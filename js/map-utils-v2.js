// map-utils-v2.js - VERSIÓN CORREGIDA (usa la instancia del mapa existente)

// ==================== UTILIDADES PARA MAPLIBRE ====================

function obtenerPrimerNombre(nombreCompleto) {
    if (!nombreCompleto) return 'Delivery';
    const primerNombre = nombreCompleto.trim().split(' ')[0];
    return primerNombre.length > 12 ? primerNombre.substring(0, 10) + '..' : primerNombre;
}

// Crear marcador de delivery usando la instancia del mapa existente
function crearMarcadorDelivery(mapInstance, lat, lng, nombre, color, tienePedido = null) {
    if (!mapInstance) return null;
    
    const colorFinal = tienePedido !== null 
        ? (tienePedido ? '#FF6200' : '#10B981')
        : color;
    
    const nombreMostrar = obtenerPrimerNombre(nombre);
    
    const html = `
        <div style="text-align: center;">
            <div style="background:rgba(0,0,0,0.85); color:white; font-size:11px; font-weight:bold; padding:3px 8px; border-radius:14px; margin-bottom:4px; white-space:nowrap;">
                ${nombreMostrar}
            </div>
            <div style="background:${colorFinal}; width:34px; height:34px; border-radius:50%; border:2.5px solid white; display:flex; align-items:center; justify-content:center;">
                <i class="fas fa-motorcycle" style="color:white; font-size:18px;"></i>
            </div>
        </div>
    `;
    
    const div = document.createElement('div');
    div.innerHTML = html;
    
    return new maplibregl.Marker({ element: div.firstChild })
        .setLngLat([lng, lat])
        .addTo(mapInstance);
}

// Crear marcador de origen/destino (círculos arrastrables)
function crearMarcadorCirculo(mapInstance, lng, lat, color, icono, textoLabel) {
    if (!mapInstance) return null;
    
    const el = document.createElement('div');
    el.style.cssText = `
        background: ${color};
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        position: relative;
    `;
    el.innerHTML = `<i class="fas ${icono}" style="color:white; font-size: 14px;"></i>`;
    
    // Agregar etiqueta
    const label = document.createElement('div');
    label.style.cssText = `
        position: absolute;
        top: -22px;
        left: 50%;
        transform: translateX(-50%);
        background: ${color};
        color: white;
        font-size: 10px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 10px;
        white-space: nowrap;
        font-family: sans-serif;
    `;
    label.innerText = textoLabel;
    el.appendChild(label);
    
    return new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([lng, lat])
        .addTo(mapInstance);
}

// Agregar al final de map-utils-v2.js
function convertirPedidoDeSupabase(pedidoSupabase) {
    return {
        id: pedidoSupabase.id,
        clienteId: pedidoSupabase.cliente_id,
        clienteNombre: pedidoSupabase.cliente_nombre,
        origen: pedidoSupabase.origen,
        destino: pedidoSupabase.destino,
        origenCoords: (pedidoSupabase.origen_lat && pedidoSupabase.origen_lng) ? { lat: pedidoSupabase.origen_lat, lng: pedidoSupabase.origen_lng } : null,
        destinoCoords: (pedidoSupabase.destino_lat && pedidoSupabase.destino_lng) ? { lat: pedidoSupabase.destino_lat, lng: pedidoSupabase.destino_lng } : null,
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

// Dibujar ruta usando la instancia del mapa existente
async function drawRouteMaplibre(mapInstance, origin, dest, color, weight = 5) {
    if (!mapInstance || !origin || !dest) return null;
    
    // Limpiar ruta anterior
    try {
        if (mapInstance.getLayer('route-layer')) mapInstance.removeLayer('route-layer');
        if (mapInstance.getSource('route-source')) mapInstance.removeSource('route-source');
        if (mapInstance.getLayer('current-route')) mapInstance.removeLayer('current-route');
        if (mapInstance.getSource('current-route')) mapInstance.removeSource('current-route');
    } catch(e) {}
    
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            
            mapInstance.addSource('route-source', {
                type: 'geojson',
                data: route.geometry
            });
            
            mapInstance.addLayer({
                id: 'route-layer',
                type: 'line',
                source: 'route-source',
                paint: {
                    'line-color': color,
                    'line-width': weight,
                    'line-opacity': 0.8
                }
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

function clearAllRoutes(mapInstance) {
    if (!mapInstance) return;
    try {
        if (mapInstance.getLayer('route-layer')) mapInstance.removeLayer('route-layer');
        if (mapInstance.getSource('route-source')) mapInstance.removeSource('route-source');
        if (mapInstance.getLayer('current-route')) mapInstance.removeLayer('current-route');
        if (mapInstance.getSource('current-route')) mapInstance.removeSource('current-route');
        if (mapInstance.getLayer('fallback-line')) mapInstance.removeLayer('fallback-line');
        if (mapInstance.getSource('fallback-line')) mapInstance.removeSource('fallback-line');
    } catch(e) {}
}

// Exportar funciones
window.obtenerPrimerNombre = obtenerPrimerNombre;
window.crearMarcadorDelivery = crearMarcadorDelivery;
window.crearMarcadorCirculo = crearMarcadorCirculo;
window.drawRouteMaplibre = drawRouteMaplibre;
window.drawRealRoute = drawRouteMaplibre;
window.clearAllRoutes = clearAllRoutes;
window.convertirPedidoDeSupabase = convertirPedidoDeSupabase;