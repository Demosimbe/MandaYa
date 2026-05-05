// Configuración de rutas usando OSRM (sin CORS)
// NOTA: Las variables de routing se manejan con window._currentRoutingControl

async function getRealDistanceAndTime(startCoords, endCoords) {
    if (!startCoords || !endCoords) return null;
    
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${startCoords.lng},${startCoords.lat};${endCoords.lng},${endCoords.lat}?overview=full&geometries=polyline`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
            const route = data.routes[0];
            const distance = route.distance / 1000;
            const duration = route.duration;
            const geometry = route.geometry;
            
            return {
                distance: distance,
                distanceKm: distance.toFixed(2),
                duration: duration,
                durationMin: Math.round(duration / 60),
                durationText: formatDuration(duration),
                geometry: geometry,
                rawData: data
            };
        }
        return null;
    } catch (error) {
        console.error('Error al obtener ruta:', error);
        return null;
    }
}

async function drawRealRoute(map, startCoords, endCoords, color = '#FF6200', weight = 5) {
    // Limpiar routing control existente si lo hay
    if (window._currentRoutingControl) {
        try {
            map.removeControl(window._currentRoutingControl);
        } catch(e) {}
        window._currentRoutingControl = null;
    }
    
    const routingControl = L.Routing.control({
        waypoints: [
            L.latLng(startCoords.lat, startCoords.lng),
            L.latLng(endCoords.lat, endCoords.lng)
        ],
        routeWhileDragging: false,
        showAlternatives: false,
        lineOptions: {
            styles: [{ color: color, weight: weight, opacity: 0.8 }],
            extendToWaypoints: true,
            missingRouteTolerance: 0
        },
        router: L.Routing.osrmv1({
            serviceUrl: 'https://router.project-osrm.org/route/v1'
        }),
        show: false,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: false
    });
    
    window._currentRoutingControl = routingControl;
    
    return new Promise((resolve) => {
        let resolved = false;
        
        const onRoutesFound = function(e) {
            if (resolved) return;
            resolved = true;
            const route = e.routes[0];
            const distance = route.summary.totalDistance / 1000;
            const duration = route.summary.totalTime;
            
            resolve({
                line: routingControl,
                routeData: {
                    distance: distance,
                    distanceKm: distance.toFixed(2),
                    duration: duration,
                    durationText: formatDuration(duration),
                    geometry: null
                }
            });
        };
        
        routingControl.on('routesfound', onRoutesFound);
        routingControl.addTo(map);
        
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                resolve({ line: null, routeData: null });
            }
        }, 5000);
    });
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}min`;
    }
    return `${minutes} min`;
}

function calculateShippingRate(distanceKm, tipoEnvio) {
    let baseRate = 35;
    let perKmRate = 8;
    
    if (distanceKm <= 2) {
        perKmRate = 6;
    } else if (distanceKm > 10) {
        perKmRate = 10;
    }
    
    const typeMultipliers = {
        'comida': 1,
        'paquete': 1.1,
        'mercancia': 1.3,
        'farmacia': 1
    };
    
    const total = (baseRate + (distanceKm * perKmRate)) * (typeMultipliers[tipoEnvio] || 1);
    
    return {
        base: baseRate,
        perKm: perKmRate,
        total: Math.round(total),
        totalWithDecimal: total.toFixed(2)
    };
}

function getMotoIcon() {
    return L.divIcon({
        html: `<div style="background:#FF6200; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:3px solid white; box-shadow:0 4px 10px rgba(0,0,0,0.3); background: linear-gradient(135deg, #FF6200, #FF8C00);">
                    <i class="fas fa-motorcycle" style="color:white; font-size:22px;"></i>
               </div>
               <div style="position:absolute; bottom:-8px; left:50%; transform:translateX(-50%); background:#10b981; width:10px; height:10px; border-radius:50%; border:2px solid white; animation:pulse 2s infinite;"></div>`,
        iconSize: [40, 40],
        className: 'moto-marker'
    });
}