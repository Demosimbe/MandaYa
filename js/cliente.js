// ==================== CONSTANTES Y LÍMITES ====================
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

// ==================== VARIABLES DEL MAPA ====================
let map = null;
let originMarker = null;
let destMarker = null;
let routeLine = null;
let deliveryMarker = null;
let clienteRouteControl = null;

// ==================== COORDENADAS (SOLO UNA DECLARACIÓN) ====================
window.originCoords = null;
window.destCoords = null;    // ✅ Única variable de destino

// ==================== USUARIOS Y PEDIDOS ====================
let currentUser = null;
let pedidoActual = null;
let pedidoPendiente = null;

// ==================== INTERVALOS Y TIEMPOS ====================
let seguimientoInterval = null;     // Seguimiento de estado del pedido
let ubicacionInterval = null;       // Seguimiento de ubicación del delivery
let deliverysInterval = null;       // Carga de deliverys en línea
let busquedaTimeout = null;         // Timeout para búsqueda de direcciones

// ==================== CONTROL DE RUTAS ====================
let currentRouteData = null;        // Datos de la ruta actual (distancia, duración, extras)
let rutaActualTipo = null;          // 'recogida' o 'entrega'
let rutaDestinoActual = null;       // Guardar destino para comparar
let rutaYaDibujada = false;
let ultimoEstadoPedido = null;

// ==================== DELIVERYS EN LÍNEA ====================
let deliverysMarkers = [];           // Marcadores de deliverys disponibles

// ==================== UI Y MODOS ====================
let selectMode = 'origen';           // 'origen' o 'destino'
let mapRotationAngle = 0;            // Ángulo de rotación del mapa

// ==================== CONTROL DE PETICIONES (THROTTLING) ====================
let ultimaPeticionTime = 0;          // Para throttling general
let ultimaPeticionDeliverys = 0;     // Para throttling de deliverys
let paginaVisible = true;            // Estado de visibilidad de la pestaña


// ==================== INICIALIZACIÓN PRINCIPAL ====================
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 Inicializando cliente...");
    
    // Verificar sesión antes de cualquier cosa
    const sesionValida = await verificarYProtegerSesion();
    if (!sesionValida) return;
    
    // Cargar usuario con securityManager
    cargarUsuarioSeguro();

    // ✅ Verificar que el usuario se cargó correctamente
    if (!currentUser) {
        console.error("❌ No se pudo cargar el usuario");
        window.location.href = "index.html";
        return;
    }
    
    // Inicializar mapa
    initMap();
    
    // Cargar deliverys en línea si es cliente
    if (currentUser && currentUser.rol === 'cliente') {
        setTimeout(() => cargarDeliverysEnLinea(), 2000);
        
        if (deliverysInterval) clearInterval(deliverysInterval);
        deliverysInterval = setInterval(() => {
            if (currentUser && currentUser.rol === 'cliente' && paginaVisible) {
                cargarDeliverysEnLinea();
            }
        }, 15000);
    }
});

// ==================== FUNCIÓN CARGAR USUARIO (SOLO UNA VEZ) ====================
function cargarUsuarioSeguro() {
    const usuario = securityManager.obtenerUsuarioActual();
    if (!usuario) { 
        window.location.href = "index.html"; 
        return; 
    }
    
    currentUser = usuario;
    
    if (currentUser.rol !== 'cliente') { 
        window.location.href = "delivery.html"; 
        return; 
    }
    
    document.getElementById("userInfo").innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-user-circle text-[#FF6200] text-xl"></i>
            <span class="font-medium">${currentUser.nombre}</span>
            <span class="text-gray-400 text-xs">(Cliente)</span>
        </div>
    `;
    
    // También actualizar mobile si existe
    const userInfoMobile = document.getElementById("userInfoMobile");
    if (userInfoMobile) {
        userInfoMobile.innerHTML = document.getElementById("userInfo").innerHTML;
    }
}

// ==================== CERRAR SESIÓN CORREGIDO (SOLO UNA VEZ) ====================
function cerrarSesion() { 
    mostrarModalConfirmacion(
        "Cerrar Sesión",
        "¿Estás seguro de que deseas cerrar sesión?",
        async () => {
            // Limpiar intervalos
            if(seguimientoInterval) clearInterval(seguimientoInterval);
            if(ubicacionInterval) clearInterval(ubicacionInterval);
            if(deliverysInterval) clearInterval(deliverysInterval);
            
            // Usar securityManager para cerrar sesión
            await securityManager.cerrarSesion();
        }
    );
}

// ==================== EVENT LISTENERS ====================
const origenInput = document.getElementById('origen');
const destinoInput = document.getElementById('destino');
const btnCancelarPedido = document.getElementById('btnCancelarPedido');

if (btnCancelarPedido) { btnCancelarPedido.addEventListener('click', cancelarPedido); }
if (origenInput) {
    origenInput.addEventListener('input', (e) => {
        if (busquedaTimeout) clearTimeout(busquedaTimeout);
        busquedaTimeout = setTimeout(() => {
            buscarDirecciones(e.target.value, 'origen');
        }, 500);
    });
    
    origenInput.addEventListener('blur', () => {
        setTimeout(() => {
            document.getElementById('origenSugerencias')?.classList.add('hidden');
        }, 200);
    });
}

if (destinoInput) {
    destinoInput.addEventListener('input', (e) => {
        if (busquedaTimeout) clearTimeout(busquedaTimeout);
        busquedaTimeout = setTimeout(() => {
            buscarDirecciones(e.target.value, 'destino');
        }, 500);
    });
    
    destinoInput.addEventListener('blur', () => {
        setTimeout(() => {
            document.getElementById('destinoSugerencias')?.classList.add('hidden');
        }, 200);
    });
}


// ==================== BLOQUEAR/REACTIVAR UI CUANDO HAY PEDIDO ACTIVO ====================
function bloquearUIporPedidoActivo(bloquear) {
    const elementos = {
        inputs: ['origen', 'destino'],
        select: 'tipoEnvio',
        botones: ['btnOrigen', 'btnDestino'],
        botonSolicitar: 'solicitarEnvio'
    };
    
    if (bloquear) {
        // Bloquear inputs de origen y destino
        elementos.inputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = true;
                input.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
            }
        });
        
        // Bloquear select de tipo de envío
        const select = document.getElementById(elementos.select);
        if (select) {
            select.disabled = true;
            select.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
        }
        
        // Bloquear botones de modo (Origen/Destino)
        elementos.botones.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.pointerEvents = 'none';
                btn.classList.add('opacity-50');
            }
        });
        
        // Deshabilitar marcadores arrastrables
        if (originMarker && originMarker.dragging) {
            originMarker.dragging.disable();
            originMarker.setOpacity(0.6);
        }
        if (destMarker && destMarker.dragging) {
            destMarker.dragging.disable();
            destMarker.setOpacity(0.6);
        }
        
        // Deshabilitar click en el mapa para seleccionar ubicación
        if (map) { map._container.style.cursor = 'default'; }
        
        // Ocultar/deshabilitar botón solicitar envío
        const btnSolicitar = document.querySelector('button[onclick="solicitarEnvio()"], button[onclick="solicitarEnvioMobile()"]');
        if (btnSolicitar) {
            btnSolicitar.disabled = true;
            btnSolicitar.classList.add('opacity-50', 'cursor-not-allowed');
        }
        
        // Mostrar mensaje en los inputs
        const origenInput = document.getElementById('origen');
        if (origenInput && !origenInput.placeholder.includes('(Bloqueado)')) {
            origenInput.placeholder = '📍 Origen (bloqueado - pedido en curso)';
        }
        const destinoInput = document.getElementById('destino');
        if (destinoInput && !destinoInput.placeholder.includes('(Bloqueado)')) {
            destinoInput.placeholder = '🏁 Destino (bloqueado - pedido en curso)';
        }

          // ✅ SINCRONIZAR BLOQUEO CON MÓVIL
        if (typeof sincronizarBloqueoMobile === 'function') { sincronizarBloqueoMobile(true); }
        console.log("🔒 UI bloqueada - Pedido activo en curso");
        
    } else {
        // Reactivar todo
        elementos.inputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = false;
                input.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
                input.placeholder = id === 'origen' ? 'Buscar dirección o arrastra el marcador' : 'Buscar dirección o arrastra el marcador';
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
        
        if (originMarker && originMarker.dragging) {
            originMarker.dragging.enable();
            originMarker.setOpacity(1);
        }
        if (destMarker && destMarker.dragging) {
            destMarker.dragging.enable();
            destMarker.setOpacity(1);
        }
        
        if (map) { map._container.style.cursor = 'crosshair'; }
        
        const btnSolicitar = document.querySelector('button[onclick="solicitarEnvio()"], button[onclick="solicitarEnvioMobile()"]');
        if (btnSolicitar) {
            btnSolicitar.disabled = false;
            btnSolicitar.classList.remove('opacity-50', 'cursor-not-allowed');
        }

        // ✅ SINCRONIZAR REACTIVACIÓN CON MÓVIL
        if (typeof sincronizarBloqueoMobile === 'function') { sincronizarBloqueoMobile(false); }
        console.log("🔓 UI reactivada - Sin pedido activo");
    }
}

// Detectar cuando la pestaña está visible
document.addEventListener('visibilitychange', () => {
    paginaVisible = !document.hidden;
    if (paginaVisible) {
        console.log("🟢 Página visible - Reactivando actualizaciones");
        // Forzar una actualización al volver
        if (typeof cargarPedidos === 'function') cargarPedidos();
        if (typeof cargarDeliverysEnLinea === 'function') cargarDeliverysEnLinea();
    } else {
        console.log("🔴 Página oculta - Reduciendo actualizaciones");
    }
});

// ==================== INICIALIZACIÓN ====================
function initMap() {
    // ✅ Inicializar coordenadas por defecto ANTES de crear el mapa
    initDefaultCoords();
    
    map = L.map('map', {
        maxBoundsViscosity: 1.0,
        rotate: true,
        rotateControl: true,
        zoomControl: true,
        attributionControl: true,
        touchZoom: true,
        dragging: true,
        tap: true,
        inertia: false
    }).setView([18.6456, -91.8249], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    limitarMapaACarmen(map);

    // ✅ Función auxiliar para limitar coordenadas
    function limitarCoord(lat, lng) {
        return limitarCoordenadasACarmen(lat, lng);
    }

    // ==================== ICONOS ====================
    const originIcon = L.divIcon({
        html: `
            <div style="background:#FF6200; width:28px; height:28px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;">
                <i class="fas fa-circle" style="color:white; font-size:12px;"></i>
            </div>
        `,
        iconSize: [28, 28],
        className: 'custom-marker'
    });

    const destIcon = L.divIcon({
        html: `
            <div style="background:#3B82F6; width:28px; height:28px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;">
                <i class="fas fa-square" style="color:white; font-size:12px;"></i>
            </div>
        `,
        iconSize: [28, 28],
        className: 'custom-marker'
    });

    // ==================== MARCADORES ====================
    // ✅ Usar getOriginCoords() en lugar de variables directas
    const origenInicial = getOriginCoords();
    originMarker = L.marker([origenInicial.lat, origenInicial.lng], {
        icon: originIcon,
        draggable: true,
        rotationAngle: 0,
        rotationOrigin: 'center center'
    }).addTo(map);

    const destinoInicial = getDestCoords();
    destMarker = L.marker([destinoInicial.lat, destinoInicial.lng], {
        icon: destIcon,
        draggable: true,
        rotationAngle: 0,
        rotationOrigin: 'center center'
    }).addTo(map);

    originMarker.bindPopup('📍 <b>Origen</b><br>Arrástrame para cambiar');
    destMarker.bindPopup('🏁 <b>Destino</b><br>Arrástrame para cambiar');

    // ==================== DRAG EVENTS ====================
    originMarker.on('drag', function(e) {
        const latlng = e.target.getLatLng();
        const limitada = limitarCoord(latlng.lat, latlng.lng);
        if (limitada.lat !== latlng.lat || limitada.lng !== latlng.lng) {
            e.target.setLatLng([limitada.lat, limitada.lng]);
        }
    });

    originMarker.on('dragend', function(e) {
        const coords = e.target.getLatLng();
        const limitada = limitarCoord(coords.lat, coords.lng);
        e.target.setLatLng([limitada.lat, limitada.lng]);

        // ✅ Usar setOriginCoords en lugar de asignar directamente
        setOriginCoords(limitada);
        
        reverseGeocode(getOriginCoords(), (addr) => {
            const origenInput = document.getElementById("origen");
            if (origenInput) origenInput.value = addr;
            // ✅ Sincronizar con móvil si existe
            const origenMobile = document.getElementById("origenMobile");
            if (origenMobile) origenMobile.value = addr;
        });
        
        actualizarRutaYTarifa();
        mostrarToast("📍 Origen actualizado");
    });

    destMarker.on('drag', function(e) {
        const latlng = e.target.getLatLng();
        const limitada = limitarCoord(latlng.lat, latlng.lng);
        if (limitada.lat !== latlng.lat || limitada.lng !== latlng.lng) {
            e.target.setLatLng([limitada.lat, limitada.lng]);
        }
    });

    destMarker.on('dragend', function(e) {
        const coords = e.target.getLatLng();
        const limitada = limitarCoord(coords.lat, coords.lng);
        e.target.setLatLng([limitada.lat, limitada.lng]);

        // ✅ Usar setDestCoords
        setDestCoords(limitada);
        
        reverseGeocode(getDestCoords(), (addr) => {
            const destinoInput = document.getElementById("destino");
            if (destinoInput) destinoInput.value = addr;
            // ✅ Sincronizar con móvil
            const destinoMobile = document.getElementById("destinoMobile");
            if (destinoMobile) destinoMobile.value = addr;
        });
        
        actualizarRutaYTarifa();
        mostrarToast("🏁 Destino actualizado");
    });

    // ==================== CLICK EN MAPA ====================
    map.on('click', (e) => {
        const limitada = limitarCoord(e.latlng.lat, e.latlng.lng);

        if (selectMode === 'origen') {
            originMarker.setLatLng([limitada.lat, limitada.lng]);
            setOriginCoords(limitada);
            reverseGeocode(getOriginCoords(), (addr) => {
                const origenInput = document.getElementById("origen");
                if (origenInput) origenInput.value = addr;
                const origenMobile = document.getElementById("origenMobile");
                if (origenMobile) origenMobile.value = addr;
            });
        } else {
            destMarker.setLatLng([limitada.lat, limitada.lng]);
            setDestCoords(limitada);
            reverseGeocode(getDestCoords(), (addr) => {
                const destinoInput = document.getElementById("destino");
                if (destinoInput) destinoInput.value = addr;
                const destinoMobile = document.getElementById("destinoMobile");
                if (destinoMobile) destinoMobile.value = addr;
            });
        }

        actualizarRutaYTarifa();
        mostrarToast(selectMode === 'origen' ? "📍 Origen actualizado" : "🏁 Destino actualizado");
    });

    // ==================== ROTACIÓN DEL MAPA ====================
    map.on('rotate', function() {
        const container = map.getContainer();
        const transform = container.style.transform || '';
        const match = transform.match(/rotate\(([-0-9.]+)deg\)/);
        if (match) {
            mapRotationAngle = parseFloat(match[1]);
        }
        actualizarRotacionMarcadoresCliente();
    });

    // Rotación inicial
    map.getContainer().style.transform = 'rotate(0deg)';
    mapRotationAngle = 0;

    // ==================== GEOCODIFICACIÓN INICIAL ====================
    reverseGeocode(getOriginCoords(), (addr) => {
        const origenInput = document.getElementById("origen");
        if (origenInput) origenInput.value = addr;
        const origenMobile = document.getElementById("origenMobile");
        if (origenMobile) origenMobile.value = addr;
    });

    reverseGeocode(getDestCoords(), (addr) => {
        const destinoInput = document.getElementById("destino");
        if (destinoInput) destinoInput.value = addr;
        const destinoMobile = document.getElementById("destinoMobile");
        if (destinoMobile) destinoMobile.value = addr;
    });

    // ✅ Pequeño delay para asegurar que el mapa está listo
    setTimeout(() => {
        actualizarRutaYTarifa();
        map.invalidateSize(); // Forzar resize por si acaso
    }, 500);

    console.log("🗺️ Mapa Cliente inicializado con rotación activada");
    console.log("📍 Coordenadas iniciales:", {
        origen: getOriginCoords(),
        destino: getDestCoords()
    });
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

function centrarEnDelivery() {
    if (deliveryMarker) {
        const latLng = deliveryMarker.getLatLng();
        map.setView([latLng.lat, latLng.lng], 16);
        mostrarToast("📍 Centrando en la ubicación del delivery");
        
        // Opcional: abrir popup del delivery
        deliveryMarker.openPopup();
        setTimeout(() => deliveryMarker.closePopup(), 3000);
    } else {
        mostrarToast("❌ No hay delivery activo para centrar", true);
    }
}

// Mostrar el botón cuando hay delivery asignado
function mostrarBotonCentrarDelivery(mostrar) {
    const btn = document.getElementById('btnCentrarDelivery');
    if (btn) {
        if (mostrar) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    }
}

function limpiarRutaCliente() {
    if (clienteRouteControl) {
        try { map.removeControl(clienteRouteControl); } catch(e) {}
        clienteRouteControl = null;
    }
}

function actualizarRotacionMarcadoresCliente() {
    if (originMarker && typeof originMarker.setRotationAngle === 'function') {
        originMarker.setRotationAngle(mapRotationAngle);
    }
    if (destMarker && typeof destMarker.setRotationAngle === 'function') {
        destMarker.setRotationAngle(mapRotationAngle);
    }
    if (deliveryMarker && typeof deliveryMarker.setRotationAngle === 'function') {
        deliveryMarker.setRotationAngle(mapRotationAngle);
    }
}

async function dibujarRutaDeliveryEnCliente(ubicacionDelivery, destinoCoords, tipo) {
    if (!ubicacionDelivery || !destinoCoords) {
        console.error("❌ Faltan coordenadas:", { ubicacionDelivery, destinoCoords });
        mostrarToast("❌ No se puede mostrar la ruta del delivery", true);
        return;
    }
    
    // ✅ Limpiar ruta anterior de forma más segura
    if (clienteRouteControl) {
        try {
            // Intentar remover el control del mapa
            if (clienteRouteControl._map) {
                map.removeControl(clienteRouteControl);
            }
            // También limpiar event listeners si es posible
            if (clienteRouteControl.getPlan) {
                clienteRouteControl.getPlan().setWaypoints([]);
            }
        } catch(e) {
            console.warn("Error limpiando ruta anterior:", e);
        }
        clienteRouteControl = null;
    }
    
    let waypoints = [];
    let color = '#FF6200';
    
    if (tipo === 'recogida') {
        waypoints = [
            L.latLng(ubicacionDelivery.lat, ubicacionDelivery.lng),
            L.latLng(destinoCoords.lat, destinoCoords.lng)
        ];
        color = '#10B981';
        console.log("🟢 Waypoints RECOGIDA:", waypoints);
    } else if (tipo === 'entrega') {
        waypoints = [
            L.latLng(ubicacionDelivery.lat, ubicacionDelivery.lng),
            L.latLng(destinoCoords.lat, destinoCoords.lng)
        ];
        color = '#FF6200';
        console.log("🟠 Waypoints ENTREGA:", waypoints);
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
    
    // ✅ Ajustar el mapa a la ruta
    setTimeout(() => {
        try {
            if (waypoints.length >= 2) {
                map.fitBounds(L.latLngBounds(waypoints), { padding: [50, 50] });
            }
        } catch(e) {
            console.warn("Error ajustando bounds:", e);
        }
        map.invalidateSize();
    }, 300);
}

function verRutaCompleta() {
    if (clienteRouteControl && clienteRouteControl._map) {
        // Obtener los waypoints actuales
        const waypoints = clienteRouteControl.getWaypoints();
        if (waypoints.length >= 2) {
            const bounds = L.latLngBounds(waypoints);
            map.fitBounds(bounds, { padding: [50, 50] });
            mostrarToast("🗺️ Mostrando ruta completa");
        }
   } else if (getOriginCoords() && getDestCoords()) {
    const orig = getOriginCoords();
    const dest = getDestCoords();
    const bounds = L.latLngBounds([
        [orig.lat, orig.lng],
        [dest.lat, dest.lng]
    ]);
        map.fitBounds(bounds, { padding: [50, 50] });
        mostrarToast("📍 Mostrando origen y destino");
    }
}

async function actualizarRutaYTarifa() {
    const orig = getOriginCoords();
    const dest = getDestCoords();

    if (!orig || !dest) { console.log("⚠️ No hay coordenadas de origen o destino"); return; }

    const origenSeguro = limitarCoordenadasACarmen(
        orig.lat,
        orig.lng
    );

    const destinoSeguro = limitarCoordenadasACarmen(
        dest.lat,
        dest.lng
    );

    // Guardar corregidas
    setOriginCoords(origenSeguro);
    setDestCoords(destinoSeguro);

    // Corregir marcadores visualmente
    if (originMarker) {
        originMarker.setLatLng([
            origenSeguro.lat,
            origenSeguro.lng
        ]);
    }

    if (destMarker) {
        destMarker.setLatLng([
            destinoSeguro.lat,
            destinoSeguro.lng
        ]);
    }

    const tarifaContainer = document.getElementById("tarifaContainer");
    if (tarifaContainer) { tarifaContainer.classList.remove("hidden"); }
    const tarifaValue = document.getElementById("tarifaValue");
    if (tarifaValue) { tarifaValue.innerHTML = '<div class="loading-spinner"></div> Calculando...'; }
    if (routeLine) {

        try {

            if (typeof routeLine.remove === 'function') {
                routeLine.remove();
            } else if (routeLine._map) {
                map.removeLayer(routeLine);
            }

        } catch(e) {

            console.warn(
                "Error limpiando routeLine:",
                e
            );

        }

        routeLine = null;
    }

    if (clienteRouteControl) { try { if (clienteRouteControl._map) { map.removeControl(clienteRouteControl); }
        } catch(e) {}
        clienteRouteControl = null;
    }

    const extrasGuardados =
        currentRouteData?.extras || {
            lluvia: false,
            noche: false,
            espera: false
        };

    const tipoEnvio = document.getElementById("tipoEnvio")?.value || 'paquete';
    const routeResult = await drawRealRoute(
        map,
        origenSeguro,
        destinoSeguro,
        '#FF6200',
        5
    );

    if (routeResult && routeResult.routeData) {
        routeLine = routeResult.line;

        const distance = routeResult.routeData.distance;
        const duration = routeResult.routeData.duration;
        const rate = calculateShippingRate( distance, tipoEnvio );

        // Guardar datos actuales
        currentRouteData = {
            distance: distance,
            duration: duration,
            extras: extrasGuardados
        };

        let tarifaMostrar = rate.total;
        if (currentRouteData.extras.lluvia) { tarifaMostrar += 10; }
        if (currentRouteData.extras.noche) { tarifaMostrar += 10; }
        if (currentRouteData.extras.espera) { tarifaMostrar += 10; }

        // =========================
        // ACTUALIZAR UI DESKTOP
        // =========================
        const tarifaElement =
            document.getElementById("tarifaValue");

        if (tarifaElement) {
            tarifaElement.innerHTML =
                `$${tarifaMostrar} MXN`;
        }

        // =========================
        // ACTUALIZAR UI MOBILE
        // =========================
        const tarifaMobile =
            document.getElementById("tarifaValueMobile");

        if (tarifaMobile) {
            tarifaMobile.innerHTML =
                `$${tarifaMostrar} MXN`;
        }

        // =========================
        // MENSAJE
        // =========================
        mostrarToast(
            `📏 Distancia: ${distance.toFixed(2)} km • ⏱️ ${formatDuration(duration)}`
        );

    }

    // =========================
    // FALLBACK SI FALLA OSRM
    // =========================
    else {

        const distance =
            calcularDistanciaEntrePuntos(
                origenSeguro,
                destinoSeguro
            );

        const duration =
            distance * 2;

        const rate =
            calculateShippingRate(
                distance,
                tipoEnvio
            );

        currentRouteData = {
            distance: distance,
            duration: duration,
            extras: extrasGuardados
        };

        // =========================
        // TARIFA FINAL
        // =========================
        let tarifaMostrar = rate.total;

        if (currentRouteData.extras.lluvia) {
            tarifaMostrar += 10;
        }

        if (currentRouteData.extras.noche) {
            tarifaMostrar += 10;
        }

        if (currentRouteData.extras.espera) {
            tarifaMostrar += 10;
        }

        // =========================
        // UI DESKTOP
        // =========================
        const tarifaElement =
            document.getElementById("tarifaValue");

        if (tarifaElement) {
            tarifaElement.innerHTML =
                `$${tarifaMostrar} MXN (estimado)`;
        }

        // =========================
        // UI MOBILE
        // =========================
        const tarifaMobile =
            document.getElementById("tarifaValueMobile");

        if (tarifaMobile) {
            tarifaMobile.innerHTML =
                `$${tarifaMostrar} MXN (estimado)`;
        }

        // =========================
        // LÍNEA RECTA FALLBACK
        // =========================
        if (map) {

            routeLine = L.polyline([
                [
                    origenSeguro.lat,
                    origenSeguro.lng
                ],
                [
                    destinoSeguro.lat,
                    destinoSeguro.lng
                ]
            ], {
                color: '#FF6200',
                weight: 5,
                opacity: 0.6,
                dashArray: '5, 10'
            }).addTo(map);

        }

        // =========================
        // MENSAJE
        // =========================
        mostrarToast(
            `📏 Distancia: ${distance.toFixed(2)} km (estimado)`
        );

    }
}

// ==================== FUNCIONES DE SINCRONIZACIÓN DE COORDENADAS ====================
// ✅ NUEVAS FUNCIONES UNIFICADAS
function setOriginCoords(coords) {
    if (!coords || typeof coords.lat === 'undefined' || typeof coords.lng === 'undefined') {
        console.error("❌ setOriginCoords: coordenadas inválidas", coords);
        return;
    }
    window.originCoords = { lat: coords.lat, lng: coords.lng };
    console.log("📍 Origen actualizado:", window.originCoords);
}

function setDestCoords(coords) {
    if (!coords || typeof coords.lat === 'undefined' || typeof coords.lng === 'undefined') {
        console.error("❌ setDestCoords: coordenadas inválidas", coords);
        return;
    }
    window.destCoords = { lat: coords.lat, lng: coords.lng };
    console.log("🏁 Destino actualizado:", window.destCoords);
}

function getOriginCoords() {
    if (!window.originCoords) {
        console.warn("⚠️ getOriginCoords: coordenadas no inicializadas, usando default");
        return { lat: 18.6456, lng: -91.8249 }; // Coordenada por defecto
    }
    return window.originCoords;
}

function getDestCoords() {
    if (!window.destCoords) {
        console.warn("⚠️ getDestCoords: coordenadas no inicializadas, usando default");
        return { lat: 18.6556, lng: -91.8149 }; // Coordenada por defecto
    }
    return window.destCoords;
}

// ✅ Función para inicializar coordenadas por defecto
function initDefaultCoords() {
    if (!window.originCoords) {
        setOriginCoords({ lat: 18.6456, lng: -91.8249 });
    }
    if (!window.destCoords) {
        setDestCoords({ lat: 18.6556, lng: -91.8149 });
    }
}

function reverseGeocode(latlng, callback) {
    if (!latlng || typeof latlng.lat === 'undefined' || typeof latlng.lng === 'undefined') {
        console.error("❌ reverseGeocode: coordenadas inválidas", latlng);
        callback("Ubicación desconocida");
        return;
    }
    
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
    
    // ✅ OBTENER COORDENADAS USANDO LAS FUNCIONES (ÚNICA FUENTE DE VERDAD)
    const origenCoord = getOriginCoords();
    const destinoCoord = getDestCoords();
    
    // ✅ VALIDACIÓN UNIFICADA - Usar las coordenadas obtenidas, NO las variables antiguas
    if (!origenCoord || !destinoCoord || !origenCoord.lat || !destinoCoord.lat) {
        console.error("Coordenadas inválidas:", { origenCoord, destinoCoord });
        mostrarToast("❌ Error: No se han seleccionado origen o destino válidos", true);
        return;
    }
    
    // ✅ VALIDACIÓN para tipo de envío
    if (!tipo || tipo === '') {
        mostrarToast("❌ Por favor, selecciona qué vas a enviar (Comida, Paquete, Mercancía o Farmacia)", true);
        const selectTipo = document.getElementById("tipoEnvio");
        selectTipo.style.border = "2px solid #dc2626";
        setTimeout(() => {
            selectTipo.style.border = "";
        }, 2000);
        return;
    }
    
    // ✅ CALCULAR DISTANCIA usando las coordenadas obtenidas
    let distancia = currentRouteData ? currentRouteData.distance : calcularDistanciaEntrePuntos(origenCoord, destinoCoord);
    const rate = calculateShippingRate(distancia, tipo);
    let tarifaBase = rate.total;
    
    // ✅ Verificar extras
    let tarifaFinal = tarifaBase;
    if (currentRouteData && currentRouteData.extras) {
        tarifaFinal = tarifaBase;
        if (currentRouteData.extras.lluvia) tarifaFinal += 10;
        if (currentRouteData.extras.noche) tarifaFinal += 10;
        if (currentRouteData.extras.espera) tarifaFinal += 10;
    }
    
    // ✅ GUARDAR PEDIDO usando las coordenadas obtenidas
    pedidoPendiente = {
        id: Date.now(),
        cliente_id: currentUser.id,
        cliente_nombre: currentUser.nombre,
        origen: origen,
        destino: destino,
        origen_lat: origenCoord.lat,      // ✅ Usar origenCoord
        origen_lng: origenCoord.lng,      // ✅ Usar origenCoord
        destino_lat: destinoCoord.lat,    // ✅ Usar destinoCoord
        destino_lng: destinoCoord.lng,    // ✅ Usar destinoCoord
        tipo: tipo,
        distancia_real: distancia.toFixed(2),
        tarifa: tarifaFinal,
        extras: currentRouteData?.extras || { lluvia: false, noche: false, espera: false },
        estado: 'pendiente',
        fecha: new Date().toISOString()
    };
    
    console.log("✅ Pedido preparado:", {
        id: pedidoPendiente.id,
        origen: `${origenCoord.lat}, ${origenCoord.lng}`,
        destino: `${destinoCoord.lat}, ${destinoCoord.lng}`,
        tarifa: tarifaFinal
    });
    
    // ✅ Ir al pago
    const modalPago = document.getElementById("modalPago");
    if (modalPago) {
        modalPago.classList.remove("hidden");
        modalPago.classList.add("flex");
    } else {
        console.error("❌ Modal de pago no encontrado");
        mostrarToast("❌ Error al abrir el pago", true);
        
    }
}

function seleccionarPago(metodo) { cerrarModalPago(); 
    if (metodo === 'efectivo') {
        const total = pedidoPendiente.tarifa;
        document.getElementById("efectivoTotal").innerHTML = `$${total}`;
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
        mostrarToast(`❌ El monto es insuficiente. Faltan $${(total - paga).toFixed(2)}`, true);
        return;
    }
    
    const cambio = paga - total;
    if (cambio > 0) {
        mostrarToast(`✅ Cambio a devolver: $${cambio.toFixed(2)}`);
    }
    
    await guardarPedidoEnSupabase();
    cerrarModalEfectivo();
}

// ==================== EXTRAS ====================
let extrasSeleccionados = {
    lluvia: false,
    noche: false,
    espera: false
};

let tarifaBaseSinExtras = 0;

function calcularTotalConExtras(tarifaBase) {
    let total = tarifaBase;
    if (extrasSeleccionados.lluvia) total += 10;
    if (extrasSeleccionados.noche) total += 10;
    if (extrasSeleccionados.espera) total += 10;
    return total;
}

// ==================== PANEL DE ESTADO DEL PEDIDO (NUEVO) ====================
function mostrarPanelEstado(pedido) {
    const panel = document.getElementById("panelEstadoPedido");
    if (!panel) return;
    
    document.getElementById("pedidoIdLabel").innerText = pedido.id;
    actualizarEstadoPanel(pedido.estado);
    panel.classList.remove("hidden");
    
    // ✅ BLOQUEAR UI cuando hay pedido activo
    if (pedido && (pedido.estado === 'asignado' || pedido.estado === 'recogido' || pedido.estado === 'pendiente')) {
        bloquearUIporPedidoActivo(true);
    }
}

// Reemplazar la función actualizarEstadoPanel por esta:
function actualizarEstadoPanel(estado, deliveryNombre = null) {
    const estadoTexto = document.getElementById("estadoTexto");
    const estadoIcono = document.getElementById("estadoIcono");
    const estadoDetalle = document.getElementById("estadoDetalle");
    
    // También para mobile
    const estadoTextoMobile = document.getElementById("estadoTextoMobile");
    const estadoIconoMobile = document.getElementById("estadoIconoMobile");
    const estadoDetalleMobile = document.getElementById("estadoDetalleMobile");
    
    switch(estado) {
        case 'pendiente':
            if(estadoTexto) estadoTexto.innerText = "⏳ Pedido pendiente";
            if(estadoIcono) estadoIcono.className = "fas fa-clock text-yellow-500";
            if(estadoDetalle) estadoDetalle.innerText = "Esperando a que un delivery tome tu pedido...";
            
            if(estadoTextoMobile) estadoTextoMobile.innerText = "⏳ Pedido pendiente";
            if(estadoIconoMobile) estadoIconoMobile.className = "fas fa-clock text-yellow-500";
            if(estadoDetalleMobile) estadoDetalleMobile.innerText = "Esperando a que un delivery tome tu pedido...";
            break;
            
        case 'asignado':
            if(estadoTexto) estadoTexto.innerText = "🚚 En camino a recoger";
            if(estadoIcono) estadoIcono.className = "fas fa-motorcycle text-orange-500";
            if(estadoDetalle) estadoDetalle.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> ya se dirige a recoger tu paquete.`;
            
            if(estadoTextoMobile) estadoTextoMobile.innerText = "🚚 En camino a recoger";
            if(estadoIconoMobile) estadoIconoMobile.className = "fas fa-motorcycle text-orange-500";
            if(estadoDetalleMobile) estadoDetalleMobile.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> ya se dirige a recoger tu paquete.`;
            break;
            
        case 'recogido':
            if(estadoTexto) estadoTexto.innerText = "📦 Paquete recogido";
            if(estadoIcono) estadoIcono.className = "fas fa-box-open text-purple-500";
            if(estadoDetalle) estadoDetalle.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> ya recogió tu paquete y va en camino.`;
            
            if(estadoTextoMobile) estadoTextoMobile.innerText = "📦 Paquete recogido";
            if(estadoIconoMobile) estadoIconoMobile.className = "fas fa-box-open text-purple-500";
            if(estadoDetalleMobile) estadoDetalleMobile.innerHTML = `🏍️ <strong>${deliveryNombre || 'Delivery'}</strong> ya recogió tu paquete y va en camino.`;
            break;
            
       case 'completado':
           console.log("🎉 Actualizando UI para pedido COMPLETADO");
           
           // Ocultar el panel de estado
           const panel = document.getElementById("panelEstadoPedido");
           const panelMobile = document.getElementById("panelEstadoPedidoMobile");
           if(panel) panel.classList.add("hidden");
           if(panelMobile) panelMobile.classList.add("hidden");
           
           // ✅ Limpiar el pedido actual
           pedidoActual = null;
           
           // ✅ REACTIVAR UI
           bloquearUIporPedidoActivo(false);
           
           // Detener intervalos
           if(seguimientoInterval) {
               clearInterval(seguimientoInterval);
               seguimientoInterval = null;
           }
           if(ubicacionInterval) {
               clearInterval(ubicacionInterval);
               ubicacionInterval = null;
           }
           
           // Eliminar marcador del delivery del mapa
           if(deliveryMarker) {
               map.removeLayer(deliveryMarker);
               deliveryMarker = null;
           }
           
           // ✅ Limpiar ruta del delivery
           limpiarRutaCliente();
           
           // ✅ Resetear el tipo de envío
           const selectTipo = document.getElementById("tipoEnvio");
           if(selectTipo) selectTipo.value = "";
           
           // ✅ Limpiar campos de búsqueda si es necesario
           const origenInput = document.getElementById("origen");
           const destinoInput = document.getElementById("destino");
           if(origenInput) origenInput.value = "";
           if(destinoInput) destinoInput.value = "";
           
           // ✅ Volver a cargar deliverys en línea
           cargarDeliverysEnLinea();
           
           // ✅ Ajustar el mapa a vista normal
           setTimeout(() => {
               if(map) { map.setView([18.6456, -91.8249], 13);}
           }, 500);
           
           mostrarToast("🎉 ¡Envío completado! Gracias por usar MandaYa");
           break;    
    }
}

async function cancelarPedido() {
    if (!pedidoActual || pedidoActual.estado !== 'pendiente') {
        mostrarToast("❌ No se puede cancelar este pedido porque ya está en camino o completado", true);
        return;
    }
    
    mostrarModalConfirmacion(
        "Cancelar pedido",
        `¿Estás seguro de cancelar el pedido #${pedidoActual.id}? Esta acción no se puede deshacer.`,
        async () => {
            const supabase = supabaseClient;
            if (!supabase) return;
            
            try {
                const { error } = await supabase
                    .from('pedidos')
                    .delete()
                    .eq('id', pedidoActual.id);
                
                if (error) throw error;
                
                mostrarToast(`✅ Pedido #${pedidoActual.id} cancelado correctamente`);
                
                // ✅ Reactivar UI antes de limpiar
                bloquearUIporPedidoActivo(false);
                
                limpiarYResetearUI();
                
            } catch(e) {
                console.error('Error cancelando pedido:', e);
                mostrarToast("❌ Error al cancelar el pedido", true);
            }
        }
    );
}

function limpiarYResetearUI() {
    bloquearUIporPedidoActivo(false);
    
    // Detener intervalos
    if (seguimientoInterval) {
        clearInterval(seguimientoInterval);
        seguimientoInterval = null;
    }
    if (ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
    }
    if (deliverysInterval) {
        clearInterval(deliverysInterval);
        deliverysInterval = null;
    }
    
    // Limpiar campos del formulario (Desktop)
    const origenDesktop = document.getElementById("origen");
    const destinoDesktop = document.getElementById("destino");
    const tipoEnvio = document.getElementById("tipoEnvio");
    const tarifaContainer = document.getElementById("tarifaContainer");
    
    if (origenDesktop) origenDesktop.value = "";
    if (destinoDesktop) destinoDesktop.value = "";
    if (tipoEnvio) tipoEnvio.value = "";
    if (tarifaContainer) tarifaContainer.classList.add("hidden");
    
    // ✅ También limpiar campos móviles si existen
    const origenMobile = document.getElementById("origenMobile");
    const destinoMobile = document.getElementById("destinoMobile");
    if (origenMobile) origenMobile.value = "";
    if (destinoMobile) destinoMobile.value = "";
    
    // Restablecer marcadores a posición por defecto
    if (originMarker && destMarker) {
        // ✅ Coordenadas por defecto
        const defaultOrigen = { lat: 18.6456, lng: -91.8249 };
        const defaultDestino = { lat: 18.6556, lng: -91.8149 };
        
        // ✅ Usar las funciones setter
        setOriginCoords(defaultOrigen);
        setDestCoords(defaultDestino);
        
        // ✅ Usar getters para obtener las coordenadas (NO variables directas)
        const orig = getOriginCoords();
        const dest = getDestCoords();
        
        originMarker.setLatLng([orig.lat, orig.lng]);
        destMarker.setLatLng([dest.lat, dest.lng]);
        
        // ✅ Actualizar los inputs con la dirección
        reverseGeocode(orig, (addr) => {
            if (origenDesktop) origenDesktop.value = addr;
            if (origenMobile) origenMobile.value = addr;
        });
        
        reverseGeocode(dest, (addr) => {
            if (destinoDesktop) destinoDesktop.value = addr;
            if (destinoMobile) destinoMobile.value = addr;
        });
    }
    
    // Eliminar ruta y marcador de delivery
    if (routeLine) {
        try {
            if (typeof routeLine.remove === 'function') {
                routeLine.remove();
            } else if (routeLine._map) {
                map.removeLayer(routeLine);
            }
        } catch(e) {
            console.warn("Error limpiando routeLine:", e);
        }
        routeLine = null;
    }
    
    if (deliveryMarker) {
        try {
            map.removeLayer(deliveryMarker);
        } catch(e) {}
        deliveryMarker = null;
    }
    
    // Limpiar ruta del cliente si existe
    if (clienteRouteControl) {
        try {
            if (clienteRouteControl._map) {
                map.removeControl(clienteRouteControl);
            }
        } catch(e) {}
        clienteRouteControl = null;
    }
    
    // Ocultar panel de estado (Desktop y Mobile)
    const panelEstado = document.getElementById("panelEstadoPedido");
    const panelEstadoMobile = document.getElementById("panelEstadoPedidoMobile");
    if (panelEstado) panelEstado.classList.add("hidden");
    if (panelEstadoMobile) panelEstadoMobile.classList.add("hidden");
    
    // Ocultar información del delivery
    const deliveryInfo = document.getElementById("deliveryInfo");
    if (deliveryInfo) deliveryInfo.classList.add("hidden");
    
    // Ocultar botón centrar delivery
    const btnCentrar = document.getElementById("btnCentrarDelivery");
    if (btnCentrar) btnCentrar.classList.add("hidden");
    
    // Resetear variables
    pedidoActual = null;
    pedidoPendiente = null;
    
    // Resetear variables de control de rutas
    rutaYaDibujada = false;
    ultimoEstadoPedido = null;
    rutaDestinoActual = null;
    
    // Reactivar la carga de deliverys en línea
    if (currentUser && currentUser.rol === 'cliente') {
        if (deliverysInterval) clearInterval(deliverysInterval);
        deliverysInterval = setInterval(() => cargarDeliverysEnLinea(), 5000);
        cargarDeliverysEnLinea();
    }
    
    // Forzar actualización de la tarifa (para resetear)
    if (typeof actualizarRutaYTarifa === 'function') {
        setTimeout(() => actualizarRutaYTarifa(), 100);
    }
    
    mostrarToast("🔄 Todo listo. Puedes hacer un nuevo envío.");
}

function forzarReactivacionUI() {
    console.log("🔄 Forzando reactivación de UI");
    
    // Reactivar todos los inputs
    const origenInput = document.getElementById("origen");
    const destinoInput = document.getElementById("destino");
    const selectTipo = document.getElementById("tipoEnvio");
    const btnSolicitar = document.querySelector('button[onclick="solicitarEnvio()"]');
    
    if(origenInput) {
        origenInput.disabled = false;
        origenInput.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
    }
    if(destinoInput) {
        destinoInput.disabled = false;
        destinoInput.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
    }
    if(selectTipo) {
        selectTipo.disabled = false;
        selectTipo.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
    }
    if(btnSolicitar) {
        btnSolicitar.disabled = false;
        btnSolicitar.classList.remove('opacity-50', 'cursor-not-allowed');
    }
    
    // Reactivar marcadores arrastrables
    if(originMarker && originMarker.dragging) {
        originMarker.dragging.enable();
        originMarker.setOpacity(1);
    }
    if(destMarker && destMarker.dragging) {
        destMarker.dragging.enable();
        destMarker.setOpacity(1);
    }
    
    // Ocultar paneles
    const panel = document.getElementById("panelEstadoPedido");
    if(panel) panel.classList.add("hidden");
    
    // Limpiar pedido actual
    pedidoActual = null;
    
    mostrarToast("✅ Listo para un nuevo envío");
}

// ==================== FUNCIONES DE PEDIDO MODIFICADAS ====================
async function guardarPedidoEnSupabase() {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
        // ✅ Asegurar que extras sea un objeto válido
        const pedidoAGuardar = {
            ...pedidoPendiente,
            extras: pedidoPendiente.extras || { lluvia: false, noche: false, espera: false }
        };
        
        const { error } = await supabase
            .from('pedidos')
            .insert([pedidoAGuardar]);
        
        if (error) throw error;
        
        pedidoActual = pedidoPendiente;
        
        cerrarModalPago();
        cerrarModalEfectivo();
        cerrarModalTransferencia();
        
        mostrarPanelEstado(pedidoActual);
        
        mostrarToast(`✅ ¡Envío solicitado! ID: #${pedidoActual.id} - Esperando delivery`);
        iniciarSeguimientoDelivery();
        
    } catch(e) {
        console.error('Error creando pedido:', e);
        mostrarToast("❌ Error al crear el pedido: " + (e.message || "Verifica la consola"), true);
    }
}

function enviarComprobanteWhatsApp() {
    if (!pedidoPendiente) {
        mostrarToast("❌ No hay información del pedido", true);
        return;
    }
    
    const total = pedidoPendiente.tarifa;
    const pedidoId = pedidoPendiente.id;
    
    // ✅ MISMO NÚMERO que funciona en tu otro proyecto
    const numeroWhatsApp = '5219381083498';
    
    // ✅ MISMO FORMATO de mensaje (como en tu ejemplo)
    let mensaje = `🍔 *MANDAYA - NUEVO PEDIDO* 🍔\n\n`;
    
    mensaje += `🎫 *PEDIDO:* #${pedidoId}\n`;
    mensaje += `👤 *CLIENTE:* ${pedidoPendiente.cliente_nombre}\n`;
    
    mensaje += `\n━━━━━━━━━━━━━━━\n`;
    mensaje += `📦 *DETALLES DEL ENVÍO:*\n`;
    mensaje += `\n📍 *ORIGEN:* ${pedidoPendiente.origen}\n`;
    mensaje += `🏁 *DESTINO:* ${pedidoPendiente.destino}\n`;
    mensaje += `📏 *DISTANCIA:* ${pedidoPendiente.distancia_real} km\n`;
    mensaje += `📦 *TIPO:* ${pedidoPendiente.tipo}\n`;
    
    mensaje += `\n━━━━━━━━━━━━━━━\n`;
    mensaje += `💰 *TOTAL A PAGAR:* $${total} MXN\n`;
    
    mensaje += `\n━━━━━━━━━━━━━━━\n`;
    mensaje += `✅ *Comprobante de pago adjunto*\n`;
    
    mensaje += `\n🙏 *¡Gracias por usar MandaYa!*`;
    
    // ✅ MISMA URL que funciona en tu otro proyecto
    const mensajeCodificado = encodeURIComponent(mensaje);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${numeroWhatsApp}&text=${mensajeCodificado}`;
    
    console.log("📱 Abriendo WhatsApp con URL:", whatsappUrl);
    
    // ✅ MISMA FORMA de abrir que en tu otro proyecto
    window.open(whatsappUrl, '_blank');
    
    // Mostrar mensaje de confirmación
    mostrarToast("📱 Abriendo WhatsApp...");
    
    // Confirmar pago después de enviar
    confirmarPagoTransferencia();
}


async function confirmarPagoTransferencia() {
    await guardarPedidoEnSupabase();
    cerrarModalTransferencia();
    mostrarToast("✅ ¡Pago registrado! Envía tu comprobante por WhatsApp para confirmar.");
}

function cerrarModalPago() {
    const modal = document.getElementById("modalPago");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function cerrarModalEfectivo() {
    const modal = document.getElementById("modalEfectivo");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function cerrarModalTransferencia() {
    const modal = document.getElementById("modalTransferencia");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function copiarDatosBancarios() {
    const datos = `BBVA México\nCuenta: 1234 5678 9012 3456\nCLABE: 012 345 6789 01234567 8\nBeneficiario: MandaYa Servicios`;
    navigator.clipboard.writeText(datos);
    mostrarToast("✅ Datos bancarios copiados");
}

// ==================== SEGUIMIENTO DE DELIVERY ====================
function iniciarSeguimientoDelivery() {
    if (!pedidoActual || !pedidoActual.id) {
        console.error("❌ No hay pedido actual para seguir");
        return;
    }

    // Limpiar intervalos anteriores si existen
    if (seguimientoInterval) {
        clearInterval(seguimientoInterval);
        seguimientoInterval = null;
    }
    
    mostrarToast("🟢 Buscando delivery disponible...");

    seguimientoInterval = setInterval(async () => {
        const supabase = supabaseClient;
        if (!supabase) return;
        
        try {
            const { data: pedidoActualizado, error } = await supabase
                .from('pedidos')
                .select('*')
                .eq('id', pedidoActual.id)
                .single();
            
            if (error) throw error;
            
            if (!pedidoActualizado) return;
            
            const estadoAnterior = pedidoActual.estado;
            pedidoActual = pedidoActualizado;
            
            // ========== 1. PEDIDO COMPLETADO ==========
            if (pedidoActualizado.estado === 'completado') {
                console.log("🎉 Pedido completado detectado! Limpiando UI...");
                
                // Limpiar intervalos
                if (seguimientoInterval) {
                    clearInterval(seguimientoInterval);
                    seguimientoInterval = null;
                }
                if (ubicacionInterval) {
                    clearInterval(ubicacionInterval);
                    ubicacionInterval = null;
                }
                
                // Limpiar marcador de delivery
                if (deliveryMarker) {
                    try { map.removeLayer(deliveryMarker); } catch(e) {}
                    deliveryMarker = null;
                }
                
                // Limpiar rutas
                limpiarRutaCliente();
                
                // Ocultar paneles de estado
                const panel = document.getElementById("panelEstadoPedido");
                const panelMobile = document.getElementById("panelEstadoPedidoMobile");
                if (panel) panel.classList.add("hidden");
                if (panelMobile) panelMobile.classList.add("hidden");
                
                // Ocultar botón centrar delivery
                mostrarBotonCentrarDelivery(false);
                
                // Ocultar info del delivery
                const deliveryInfo = document.getElementById("deliveryInfo");
                if (deliveryInfo) deliveryInfo.classList.add("hidden");
                
                // Resetear variables de control
                rutaYaDibujada = false;
                ultimoEstadoPedido = null;
                rutaDestinoActual = null;
                
                // Reactivar UI
                bloquearUIporPedidoActivo(false);
                
                // Limpiar pedido actual
                pedidoActual = null;
                
                // Recargar deliverys (ahora mostrará todos nuevamente)
                cargarDeliverysEnLinea();
                
                // Mostrar mensaje final
                mostrarToast("🎉 ¡Envío completado! Gracias por usar MandaYa");
                
                return; // Salir del intervalo (importante)
            }
            
            // ========== 2. ACTUALIZAR PANEL DE ESTADO ==========
            if (pedidoActualizado.estado === 'asignado' && pedidoActualizado.delivery_nombre) {
                actualizarEstadoPanel('asignado', pedidoActualizado.delivery_nombre);
            } 
            else if (pedidoActualizado.estado === 'recogido' && pedidoActualizado.delivery_nombre) {
                actualizarEstadoPanel('recogido', pedidoActualizado.delivery_nombre);
                
                // Notificar al cliente que el paquete fue recogido
                if (estadoAnterior === 'asignado') {
                    mostrarToast(`📦 ¡El delivery ${pedidoActualizado.delivery_nombre} ya recogió tu paquete!`);
                    vibrar(200); // Si tienes función vibrar
                }
            } 
            else if (pedidoActualizado.estado === 'pendiente') {
                actualizarEstadoPanel('pendiente');
            }
            
            // ========== 3. INICIAR SEGUIMIENTO DE UBICACIÓN ==========
            // Solo si el pedido está activo y aún no tenemos intervalo de ubicación
            const estadoActivo = (pedidoActualizado.estado === 'asignado' || pedidoActualizado.estado === 'recogido');
            
            if (estadoActivo && pedidoActualizado.delivery_id && !ubicacionInterval) {
                mostrarToast(`✅ Delivery asignado: ${pedidoActualizado.delivery_nombre || 'Delivery'}`);
                mostrarDeliveryEnMapa(pedidoActualizado.delivery_id, pedidoActualizado.delivery_nombre);
                seguirUbicacionDelivery(pedidoActualizado.delivery_id);
            }
            
        } catch(e) {
            console.error('❌ Error en seguimiento:', e);
        }
    }, 3000); // ✅ Cambiado de 3s a 5s para mejor rendimiento
}

function vibrar(duracion = 200) {
    if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(duracion);
    }
}

function seguirUbicacionDelivery(deliveryId) {
    // ✅ 1. Limpiar intervalo anterior si existe
    if (ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
    }
    
    // ✅ 2. Eliminar marcador de seguimiento anterior si existe
    if (deliveryMarker) {
        try { map.removeLayer(deliveryMarker); } catch(e) {}
        deliveryMarker = null;
    }
    
    // ✅ 3. FORZAR RECARGA de deliverys en línea para OCULTAR este delivery de la lista general
    console.log(`🔄 Ocultando delivery ${deliveryId} de la lista general de deliverys`);
    cargarDeliverysEnLinea(); // Esto ahora excluirá automáticamente al delivery asignado
    
    // ✅ 4. Mostrar botón "Centrar en delivery"
    mostrarBotonCentrarDelivery(true);
    
    // ✅ Variables para control de recálculo por distancia
    let ultimaDistanciaRecalculo = 0;
    let ultimoRecalculoTime = 0;
    
    // ✅ 5. Iniciar el intervalo de seguimiento
    ubicacionInterval = setInterval(async () => {
        let ubicacion = null;
        
        // Obtener ubicación del delivery
        if (typeof obtenerUbicacionDeSupabase !== 'undefined') {
            ubicacion = await obtenerUbicacionDeSupabase(deliveryId);
            if (ubicacion && ubicacion.lat && ubicacion.lng) {
                ubicacion = { lat: ubicacion.lat, lng: ubicacion.lng };
            }
        }
        
        let deliveryNombre = 'Delivery';
        const supabase = supabaseClient;
        if (supabase && deliveryId && !pedidoActual?.delivery_nombre) {
            const { data: delivery } = await supabase
                .from('usuarios')
                .select('nombre')
                .eq('id', deliveryId)
                .single();
            if (delivery) deliveryNombre = delivery.nombre;
        } else if (pedidoActual?.delivery_nombre) {
            deliveryNombre = pedidoActual.delivery_nombre;
        }
        
        if (ubicacion) {
            // ✅ 6. Actualizar marcador de seguimiento
            if (deliveryMarker) {
                try { map.removeLayer(deliveryMarker); } catch(e) {}
            }
            
            deliveryMarker = crearMarcadorDelivery(
                ubicacion.lat, 
                ubicacion.lng, 
                deliveryNombre, 
                '#FF6200'  // Color naranja para el delivery asignado
            );
            deliveryMarker.addTo(map);
            
            // ✅ 7. Determinar destino según estado
            let destinoCoords = null;
            let tipoRuta = null;
            let destinoFinalNombre = '';
            
            if (pedidoActual) {
                if (pedidoActual.estado === 'asignado') {
                    if (pedidoActual.origen_lat && pedidoActual.origen_lng) {
                        destinoCoords = { lat: pedidoActual.origen_lat, lng: pedidoActual.origen_lng };
                        tipoRuta = 'recogida';
                        destinoFinalNombre = pedidoActual.origen || 'punto de recogida';
                    }
                } else if (pedidoActual.estado === 'recogido') {
                    if (pedidoActual.destino_lat && pedidoActual.destino_lng) {
                        destinoCoords = { lat: pedidoActual.destino_lat, lng: pedidoActual.destino_lng };
                        tipoRuta = 'entrega';
                        destinoFinalNombre = pedidoActual.destino || 'destino final';
                    }
                }
            }
            
            // ✅ 8. Calcular distancia actual al destino
            let distanciaActual = null;
            if (destinoCoords) {
                distanciaActual = calcularDistanciaEntrePuntos(ubicacion, destinoCoords);
            }
            
            // ✅ 9. Determinar si necesita recálculo (mejorado)
            const estadoActual = pedidoActual?.estado;
            const tiempoAhora = Date.now();
            const tiempoDesdeUltimoRecalculo = tiempoAhora - ultimoRecalculoTime;
            const distanciaCambioSignificativo = ultimaDistanciaRecalculo !== 0 && 
                Math.abs(distanciaActual - ultimaDistanciaRecalculo) > 0.2; // 200 metros
            
            const necesitaRedibujar = !rutaYaDibujada || 
                                      ultimoEstadoPedido !== estadoActual ||
                                      (distanciaCambioSignificativo && tiempoDesdeUltimoRecalculo > 8000) ||
                                      tiempoDesdeUltimoRecalculo > 15000; // cada 15 segundos forzado
            
            // ✅ 10. Redibujar ruta si es necesario
            if (destinoCoords && necesitaRedibujar) {
                console.log(`🔄 Redibujando ruta (${tipoRuta}) - Motivo: ${!rutaYaDibujada ? 'sin ruta' : ultimoEstadoPedido !== estadoActual ? 'cambio estado' : 'recalculo distancia'}`);
                await dibujarRutaDeliveryEnCliente(ubicacion, destinoCoords, tipoRuta);
                rutaYaDibujada = true;
                ultimoEstadoPedido = estadoActual;
                rutaDestinoActual = destinoCoords;
                ultimaDistanciaRecalculo = distanciaActual;
                ultimoRecalculoTime = tiempoAhora;
                
                // Actualizar popup según el estado
                if (deliveryMarker) {
                    if (tipoRuta === 'recogida') {
                        deliveryMarker.bindPopup(`<b>🏍️ ${deliveryNombre}</b><br>🟠 En camino a recoger tu paquete<br>📍 ${destinoFinalNombre}`);
                    } else {
                        deliveryMarker.bindPopup(`<b>🏍️ ${deliveryNombre}</b><br>📦 En camino a entregar tu paquete<br>📍 ${destinoFinalNombre}`);
                    }
                }
            }
            
            // ✅ 11. Actualizar información de distancia y ETA en la UI
            if (distanciaActual !== null) {
                const deliveryEstado = document.getElementById("deliveryEstado");
                const etaElement = document.getElementById("etaValue");
                const etaContainer = document.getElementById("etaInfo");
                
                if (deliveryEstado) {
                    if (distanciaActual < 0.1) {
                        deliveryEstado.innerHTML = "🟢 ¡Muy cerca! 🎯";
                    } else if (distanciaActual < 0.5) {
                        deliveryEstado.innerHTML = `🟡 A ${(distanciaActual * 1000).toFixed(0)} metros`;
                    } else {
                        deliveryEstado.innerHTML = `🔴 A ${distanciaActual.toFixed(1)} km`;
                    }
                }
                
                // ✅ Mostrar ETA (tiempo estimado)
                if (etaElement && etaContainer) {
                    const etaMinutos = calcularETA(distanciaActual);
                    etaElement.innerHTML = etaMinutos;
                    etaContainer.classList.remove('hidden');
                }
            }
        }
        
        // ✅ 12. Verificar si el pedido ya fue completado
        if (supabase && pedidoActual) {
            const { data: pedidoActualizado } = await supabase
                .from('pedidos')
                .select('estado')
                .eq('id', pedidoActual.id)
                .single();
            
            if (pedidoActualizado?.estado === 'completado') {
                console.log("🎉 Pedido completado detectado en seguirUbicacionDelivery");
                
                clearInterval(ubicacionInterval);
                ubicacionInterval = null;
                
                // ✅ Ocultar botón de centrar
                mostrarBotonCentrarDelivery(false);
                
                ocultarDeliveryInfo();
                limpiarRutaCliente();
                
                // Ocultar paneles
                const panel = document.getElementById("panelEstadoPedido");
                const panelMobile = document.getElementById("panelEstadoPedidoMobile");
                if(panel) panel.classList.add("hidden");
                if(panelMobile) panelMobile.classList.add("hidden");
                
                // Ocultar ETA
                const etaContainer = document.getElementById("etaInfo");
                if(etaContainer) etaContainer.classList.add("hidden");
                
                // Eliminar marcador del delivery
                if(deliveryMarker) {
                    map.removeLayer(deliveryMarker);
                    deliveryMarker = null;
                }
                
                // Resetear variables de control
                rutaYaDibujada = false;
                ultimoEstadoPedido = null;
                rutaDestinoActual = null;
                
                // REACTIVAR UI
                bloquearUIporPedidoActivo(false);
                
                // Limpiar pedido actual
                pedidoActual = null;
                
                // Recargar deliverys (ahora mostrará todos nuevamente)
                cargarDeliverysEnLinea();
                
                mostrarToast("🎉 ¡Envío completado! Gracias por usar MandaYa");
            }
        }
    }, 3000); // ✅ Cambiado a 3 segundos para mejor rendimiento
}

// ✅ Función para calcular ETA (tiempo estimado)
function calcularETA(distanciaKm) {
    const velocidadPromedio = 25; // km/h en ciudad
    const minutos = (distanciaKm / velocidadPromedio) * 60;
    
    if (distanciaKm < 0.1) {
        return "menos de 1 minuto";
    }
    if (minutos < 1) {
        return "menos de 1 minuto";
    }
    if (minutos < 60) {
        return `${Math.round(minutos)} minutos`;
    }
    const horas = Math.floor(minutos / 60);
    const mins = Math.round(minutos % 60);
    return `${horas}h ${mins}min`;
}

// ✅ Función para mostrar/ocultar botón centrar en delivery
function mostrarBotonCentrarDelivery(mostrar) {
    const btn = document.getElementById('btnCentrarDelivery');
    if (btn) {
        if (mostrar) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    }
}

// ✅ Función para centrar el mapa en el delivery
function centrarEnDelivery() {
    if (deliveryMarker) {
        const latLng = deliveryMarker.getLatLng();
        map.setView([latLng.lat, latLng.lng], 16);
        mostrarToast("📍 Centrando en la ubicación del delivery");
        
        // Abrir popup temporal
        deliveryMarker.openPopup();
        setTimeout(() => {
            if (deliveryMarker) deliveryMarker.closePopup();
        }, 3000);
    } else {
        mostrarToast("❌ No hay delivery activo para centrar", true);
    }
}

// ✅ Función para ver ruta completa
function verRutaCompleta() {
    // ✅ Primero intentar mostrar la ruta del delivery si existe
    if (clienteRouteControl && clienteRouteControl.getWaypoints) {
        const waypoints = clienteRouteControl.getWaypoints();
        if (waypoints && waypoints.length >= 2) {
            const bounds = L.latLngBounds(waypoints);
            map.fitBounds(bounds, { padding: [50, 50] });
            mostrarToast("🗺️ Mostrando ruta completa del delivery");
            return;
        }
    }
    
    // ✅ Si no hay ruta activa de delivery, mostrar origen y destino del cliente
    const origenCoord = getOriginCoords();
    const destinoCoord = getDestCoords();
    
    // ✅ Validar que ambas coordenadas existan
    if (origenCoord && destinoCoord && origenCoord.lat && destinoCoord.lat) {
        const bounds = L.latLngBounds([
            [origenCoord.lat, origenCoord.lng],
            [destinoCoord.lat, destinoCoord.lng]
        ]);
        map.fitBounds(bounds, { padding: [50, 50] });
        mostrarToast("📍 Mostrando origen y destino de tu envío");
    } else {
        console.warn("No hay coordenadas disponibles:", { 
            origen: origenCoord, 
            destino: destinoCoord 
        });
        mostrarToast("❌ No hay ruta disponible. Selecciona origen y destino primero", true);
    }
}

function ocultarDeliveryInfo() {
    document.getElementById("deliveryInfo").classList.add("hidden");
    if (deliveryMarker) map.removeLayer(deliveryMarker);
}

// ==================== HISTORIAL Y PERFIL ====================
async function mostrarHistorialCompleto() {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("Error de conexión", true);
        return;
    }
    
    try {
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
                const { error } = await supabase
                    .from('pedidos')
                    .delete()
                    .eq('id', pedidoId);
                
                if (error) throw error;
                
                mostrarToast(`🗑️ Envío #${pedidoId} eliminado correctamente`);
                
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

function verHistorial() { mostrarHistorialCompleto();}

function verPerfil() {
    const modalExistente = document.getElementById("modalPerfil");
    if (modalExistente) modalExistente.remove();
    
    const modal = document.createElement('div');
    modal.id = "modalPerfil";
    modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10001] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-3xl max-w-sm w-full modal-uber">
            <div class="text-center pt-6 pb-3 border-b border-gray-700">
                <div class="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-3">
                    <i class="fas fa-user-circle text-white text-3xl"></i>
                </div>
                <h2 class="text-xl font-bold text-white">Mi Perfil</h2>
                <p class="text-gray-400 text-sm mt-1">Datos de tu cuenta</p>
            </div>
            
            <div class="p-5 space-y-3">
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-user text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Nombre</div>
                        <div class="text-white font-medium">${currentUser?.nombre || 'No disponible'}</div>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-envelope text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Correo electrónico</div>
                        <div class="text-white font-medium">${currentUser?.email || 'No disponible'}</div>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-tag text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Rol</div>
                        <div class="text-white font-medium">
                            <span class="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full text-xs">Cliente</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="px-5 pb-5">
                <button onclick="cerrarModalPerfil()" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all">
                    Cerrar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function cerrarModalPerfil() {
    const modal = document.getElementById("modalPerfil");
    if (modal) modal.remove();
}

async function mostrarDeliveryEnMapa(deliveryId, deliveryNombre = null) {
    const supabase = supabaseClient;
    if (!supabase) return;
    
    try {
        let nombreDelivery = deliveryNombre;
        
        if (!nombreDelivery) {
            const { data: delivery, error } = await supabase
                .from('usuarios')
                .select('nombre')
                .eq('id', deliveryId)
                .single();
            
            if (!error && delivery) {
                nombreDelivery = delivery.nombre;
            }
        }
        
        if (nombreDelivery) {
            document.getElementById("deliveryInfo").classList.remove("hidden");
            document.getElementById("deliveryNombre").innerHTML = `<i class="fas fa-motorcycle"></i> ${nombreDelivery}`;
            
            // Limpiar ruta anterior
            limpiarRutaCliente();
            
            // ✅ Asegurar que destinoCoords esté disponible en pedidoActual
            if (pedidoActual && !pedidoActual.destinoCoords && pedidoActual.destino_lat) {
                pedidoActual.destinoCoords = {
                    lat: pedidoActual.destino_lat,
                    lng: pedidoActual.destino_lng
                };
            }
            if (pedidoActual && !pedidoActual.origenCoords && pedidoActual.origen_lat) {
                pedidoActual.origenCoords = {
                    lat: pedidoActual.origen_lat,
                    lng: pedidoActual.origen_lng
                };
            }
        }
    } catch(e) {
        console.error('Error mostrando delivery:', e);
    }
}

function mostrarResumenRuta() {
    if (!getOriginCoords() || !getDestCoords()) {
        mostrarToast("❌ Selecciona origen y destino primero", true);
        return;
    }
    
    const distancia = currentRouteData ? currentRouteData.distance : calcularDistanciaEntrePuntos(getOriginCoords(), getDestCoords());
    const tipo = document.getElementById("tipoEnvio").value || 'paquete';
    const rate = calculateShippingRate(distancia, tipo);
    const duracion = currentRouteData ? currentRouteData.duration : (distancia * 2);
    
    // Mostrar loading mientras se obtiene la ruta real
    mostrarToast("📏 Calculando ruta real...");
    
    getRealDistanceAndTime(getOriginCoords(), getDestCoords()).then(routeData => {
        const distanciaKm = routeData ? routeData.distanceKm : distancia.toFixed(2);
        const duracionTexto = routeData ? routeData.durationText : formatDuration(duracion);
        
        mostrarModalResumen(
            distanciaKm,
            duracionTexto,
            rate.total,
            tipo
        );
    }).catch(() => {
        mostrarModalResumen(
            distancia.toFixed(2),
            formatDuration(duracion),
            rate.total,
            tipo
        );
    });
}

function mostrarModalResumen(distancia, tiempo, tarifaBase, tipo) {
    const modalExistente = document.getElementById("modalResumenRuta");
    if (modalExistente) modalExistente.remove();
    
    tarifaBaseSinExtras = tarifaBase;
    
    const extrasGuardados = currentRouteData?.extras || { 
        lluvia: false, 
        noche: false, 
        espera: false 
    };
    
    // Calcular total inicial
    let totalInicial = tarifaBase;
    if (extrasGuardados.lluvia) totalInicial += 10;
    if (extrasGuardados.noche) totalInicial += 10;
    if (extrasGuardados.espera) totalInicial += 10;
    
    const modal = document.createElement('div');
    modal.id = "modalResumenRuta";
    modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10001] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl max-w-sm w-full modal-uber">
            <div class="text-center pt-4 pb-2 border-b border-gray-700">
                <div class="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-2">
                    <i class="fas fa-route text-white text-xl"></i>
                </div>
                <h2 class="text-lg font-bold text-white">Resumen de Ruta</h2>
                <p class="text-gray-400 text-xs mt-1">Detalles de tu envío</p>
            </div>
            
            <div class="p-3 space-y-2">
                <div class="bg-gray-700 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-gray-400 text-xs">📍 Distancia real</span>
                    <span class="text-white font-bold text-sm">${distancia} km</span>
                </div>
                <div class="bg-gray-700 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-gray-400 text-xs">⏱️ Tiempo estimado</span>
                    <span class="text-white font-bold text-sm">${tiempo}</span>
                </div>
                <div class="bg-gray-700 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-gray-400 text-xs">📦 Tipo de envío</span>
                    <span class="text-white font-bold text-sm capitalize">${tipo}</span>
                </div>
                
                <!-- Extras horizontales -->
                <div class="bg-gray-700 rounded-lg p-2">
                    <div class="text-gray-400 text-xs mb-2 flex items-center gap-1">
                        <i class="fas fa-plus-circle text-orange-500 text-xs"></i>
                        Extras (+$10 c/u)
                    </div>
                    
                    <div class="flex flex-wrap gap-2 justify-center">
                        <!-- Lluvia -->
                        <div class="flex flex-col items-center bg-gray-600 rounded-lg p-2 w-16 cursor-pointer hover:bg-gray-500 transition-all" 
                             onclick="toggleExtraEnResumen('lluvia')">
                            <i class="fas fa-cloud-rain text-blue-400 text-lg mb-0.5"></i>
                            <span class="text-white text-xs">Lluvia</span>
                            <span class="text-orange-400 text-xs">+$10</span>
                            <div id="checkLluviaResumen" class="mt-1 w-4 h-4 rounded-full border-2 ${extrasGuardados.lluvia ? 'bg-orange-500 border-orange-500' : 'border-gray-400'} flex items-center justify-center">
                                ${extrasGuardados.lluvia ? '<i class="fas fa-check text-white text-[8px]"></i>' : ''}
                            </div>
                        </div>
                        
                        <!-- Noche -->
                        <div class="flex flex-col items-center bg-gray-600 rounded-lg p-2 w-16 cursor-pointer hover:bg-gray-500 transition-all" 
                             onclick="toggleExtraEnResumen('noche')">
                            <i class="fas fa-moon text-yellow-400 text-lg mb-0.5"></i>
                            <span class="text-white text-xs">Noche</span>
                            <span class="text-orange-400 text-xs">+$10</span>
                            <div id="checkNocheResumen" class="mt-1 w-4 h-4 rounded-full border-2 ${extrasGuardados.noche ? 'bg-orange-500 border-orange-500' : 'border-gray-400'} flex items-center justify-center">
                                ${extrasGuardados.noche ? '<i class="fas fa-check text-white text-[8px]"></i>' : ''}
                            </div>
                        </div>
                        
                        <!-- Espera -->
                        <div class="flex flex-col items-center bg-gray-600 rounded-lg p-2 w-16 cursor-pointer hover:bg-gray-500 transition-all" 
                             onclick="toggleExtraEnResumen('espera')">
                            <i class="fas fa-clock text-purple-400 text-lg mb-0.5"></i>
                            <span class="text-white text-xs">Espera</span>
                            <span class="text-orange-400 text-xs">+$10</span>
                            <div id="checkEsperaResumen" class="mt-1 w-4 h-4 rounded-full border-2 ${extrasGuardados.espera ? 'bg-orange-500 border-orange-500' : 'border-gray-400'} flex items-center justify-center">
                                ${extrasGuardados.espera ? '<i class="fas fa-check text-white text-[8px]"></i>' : ''}
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Total a pagar (se actualiza en tiempo real) -->
                <div class="bg-orange-500 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-white font-bold text-sm">💰 Total</span>
                    <span class="text-white font-bold text-lg" id="totalConExtrasResumen">$${totalInicial} MXN</span>
                </div>
                
                <div class="text-center text-[10px] text-gray-400">
                    <i class="fas fa-info-circle text-[8px]"></i> Los extras se pagan al delivery
                </div>
            </div>
            
            <div class="px-3 pb-3 flex gap-2">
                <button onclick="cerrarModalResumen()" 
                        class="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 rounded-lg text-sm transition-all">
                    Cancelar
                </button>
                <button id="btnAceptarExtrasResumen" 
                        class="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 rounded-lg text-sm transition-all">
                    ✅ Aceptar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Guardar estado temporal de extras (para selección en el modal)
    window.extrasTemporales = { ...extrasGuardados };
    window.tarifaBaseActual = tarifaBase;
    
    // Evento para el botón ACEPTAR
    document.getElementById("btnAceptarExtrasResumen").onclick = () => {
        confirmarExtrasDesdeResumen();
    };
}

function toggleExtraEnResumen(extra) {
    // Cambiar estado temporal
    if (!window.extrasTemporales) {
        window.extrasTemporales = { lluvia: false, noche: false, espera: false };
    }
    window.extrasTemporales[extra] = !window.extrasTemporales[extra];
    
    // Actualizar visual del check
    const checkDiv = document.getElementById(`check${extra.charAt(0).toUpperCase() + extra.slice(1)}Resumen`);
    if (checkDiv) {
        if (window.extrasTemporales[extra]) {
            checkDiv.classList.remove('border-gray-400');
            checkDiv.classList.add('bg-orange-500', 'border-orange-500');
            checkDiv.innerHTML = '<i class="fas fa-check text-white text-[8px]"></i>';
        } else {
            checkDiv.classList.remove('bg-orange-500', 'border-orange-500');
            checkDiv.classList.add('border-gray-400');
            checkDiv.innerHTML = '';
        }
    }
    
    // ✅ ACTUALIZAR EL TOTAL EN TIEMPO REAL
    let total = window.tarifaBaseActual;
    if (window.extrasTemporales.lluvia) total += 10;
    if (window.extrasTemporales.noche) total += 10;
    if (window.extrasTemporales.espera) total += 10;
    
    const totalSpan = document.getElementById("totalConExtrasResumen");
    if (totalSpan) {
        totalSpan.innerHTML = `$${total} MXN`;
        // Pequeña animación
        totalSpan.style.transform = 'scale(1.05)';
        setTimeout(() => {
            totalSpan.style.transform = 'scale(1)';
        }, 150);
    }
    
    // Efecto visual en la tarjeta
    const card = document.querySelector(`[onclick="toggleExtraEnResumen('${extra}')"]`);
    if (card) {
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
            card.style.transform = 'scale(1)';
        }, 150);
    }
}

function actualizarTotalConExtras() {
    // Verificar que estamos dentro del modal
    const checkLluvia = document.getElementById("checkLluviaExtras");
    const checkNoche = document.getElementById("checkNocheExtras");
    const checkEspera = document.getElementById("checkEsperaExtras");
    
    if (!checkLluvia || !checkNoche || !checkEspera) {
        return; // No estamos en el modal de extras
    }
    
    let total = tarifaBaseSinExtras;
    
    if (checkLluvia.checked) total += 10;
    if (checkNoche.checked) total += 10;
    if (checkEspera.checked) total += 10;
    
    const totalSpan = document.getElementById("totalConExtras");
    if (totalSpan) {
        totalSpan.innerHTML = `$${total} MXN`;
        
        // Pequeña animación
        totalSpan.style.transform = 'scale(1.05)';
        setTimeout(() => {
            totalSpan.style.transform = 'scale(1)';
        }, 150);
    }
    
    return total;
}

// Función para seleccionar/deseleccionar extras visualmente (sin afectar el total)
function toggleExtraSeleccion(extra) {
    // Obtener el estado actual temporal
    const estadoActual = window.extrasTemporales ? window.extrasTemporales[extra] : false;
    
    // Cambiar estado
    if (!window.extrasTemporales) window.extrasTemporales = { lluvia: false, noche: false, espera: false };
    window.extrasTemporales[extra] = !estadoActual;
    
    // Actualizar visual del checkbox
    const checkDiv = document.getElementById(`check${extra.charAt(0).toUpperCase() + extra.slice(1)}Resumen`);
    if (checkDiv) {
        if (window.extrasTemporales[extra]) {
            checkDiv.classList.remove('border-gray-400');
            checkDiv.classList.add('bg-orange-500', 'border-orange-500');
            checkDiv.innerHTML = '<i class="fas fa-check text-white text-xs"></i>';
        } else {
            checkDiv.classList.remove('bg-orange-500', 'border-orange-500');
            checkDiv.classList.add('border-gray-400');
            checkDiv.innerHTML = '';
        }
    }
    
    // Efecto visual de clic
    const card = document.querySelector(`.extra-card[data-extra="${extra}"]`);
    if (card) {
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
            card.style.transform = 'scale(1)';
        }, 150);
    }
}

// Función para confirmar extras SOLO cuando se presiona ACEPTAR
function confirmarExtrasDesdeResumen() {console.log("✅ Confirmando extras...");
    // Obtener valores temporales
    const lluviaSeleccionada = window.extrasTemporales?.lluvia || false;
    const nocheSeleccionada = window.extrasTemporales?.noche || false;
    const esperaSeleccionada = window.extrasTemporales?.espera || false;
    
    // Actualizar extras globales
    extrasSeleccionados = {
        lluvia: lluviaSeleccionada,
        noche: nocheSeleccionada,
        espera: esperaSeleccionada
    };
    
    // Calcular total final
    let totalFinal = tarifaBaseSinExtras;
    const extrasAplicados = [];
    
    if (extrasSeleccionados.lluvia) {
        totalFinal += 10;
        extrasAplicados.push("🌧️ Lluvia");
    }
    if (extrasSeleccionados.noche) {
        totalFinal += 10;
        extrasAplicados.push("🌙 Noche");
    }
    if (extrasSeleccionados.espera) {
        totalFinal += 10;
        extrasAplicados.push("⏱️ Espera");
    }
    
    // Guardar en currentRouteData
    if (currentRouteData) {
        currentRouteData.extras = { ...extrasSeleccionados };
        currentRouteData.totalConExtras = totalFinal;
    }
    
    // ✅ ACTUALIZAR TARIFA EN PANTALLA PRINCIPAL
    const tarifaElement = document.getElementById("tarifaValue");
    if (tarifaElement) {
        tarifaElement.innerHTML = `$${totalFinal} MXN`;
    }
    
    const tarifaElementMobile = document.getElementById("tarifaValueMobile");
    if (tarifaElementMobile) {
        tarifaElementMobile.innerHTML = `$${totalFinal} MXN`;
    }
    
    // Actualizar pedido pendiente
    if (pedidoPendiente) {
        pedidoPendiente.tarifa = totalFinal;
        pedidoPendiente.extras = { ...extrasSeleccionados };
    }
    
    // Mostrar mensaje
    if (extrasAplicados.length > 0) {
        mostrarToast(`✅ Extras: ${extrasAplicados.join(", ")} (+$${extrasAplicados.length * 10}) - Total: $${totalFinal}`);
    } else {
        mostrarToast(`✅ Total: $${totalFinal} MXN`);
    }
    // Cerrar modal
    cerrarModalResumen();  
}

function confirmarExtrasYPagar() { console.log("🔍 Confirmando extras y procediendo al pago...");
    
    // Obtener valores actuales de los checkboxes
    const checkLluvia = document.getElementById("checkLluviaExtras");
    const checkNoche = document.getElementById("checkNocheExtras");
    const checkEspera = document.getElementById("checkEsperaExtras");
    
    if (!checkLluvia || !checkNoche || !checkEspera) {
        console.error("❌ No se encontraron los checkboxes de extras");
        // Intentar cerrar modal y mostrar error
        cerrarModalResumen();
        mostrarToast("❌ Error al leer los extras, intenta de nuevo", true);
        return;
    }
    
    // Actualizar extras seleccionados
    const lluviaSeleccionada = checkLluvia.checked;
    const nocheSeleccionada = checkNoche.checked;
    const esperaSeleccionada = checkEspera.checked;
    
    extrasSeleccionados = {
        lluvia: lluviaSeleccionada,
        noche: nocheSeleccionada,
        espera: esperaSeleccionada
    };
    
    // Calcular total con extras
    let totalConExtras = tarifaBaseSinExtras;
    const extrasAplicados = [];
    
    if (extrasSeleccionados.lluvia) {
        totalConExtras += 10;
        extrasAplicados.push("🌧️ Lluvia");
    }
    if (extrasSeleccionados.noche) {
        totalConExtras += 10;
        extrasAplicados.push("🌙 Noche");
    }
    if (extrasSeleccionados.espera) {
        totalConExtras += 10;
        extrasAplicados.push("⏱️ Espera");
    }
    
    console.log("📊 Resumen de tarifa:", {
        base: tarifaBaseSinExtras,
        extras: extrasSeleccionados,
        total: totalConExtras,
        extrasAplicados: extrasAplicados
    });
    
    // Guardar extras en currentRouteData
    if (currentRouteData) {
        currentRouteData.extras = { ...extrasSeleccionados };
        currentRouteData.totalConExtras = totalConExtras;
    }
    
    // ACTUALIZAR la tarifa en la pantalla principal
    const tarifaElement = document.getElementById("tarifaValue");
    if (tarifaElement) {
        tarifaElement.innerHTML = `$${totalConExtras} MXN`;
    }
    
    // También actualizar versión mobile si existe
    const tarifaElementMobile = document.getElementById("tarifaValueMobile");
    if (tarifaElementMobile) {
        tarifaElementMobile.innerHTML = `$${totalConExtras} MXN`;
    }
    
    // Guardar en pedidoPendiente si existe
    if (pedidoPendiente) {
        pedidoPendiente.tarifa = totalConExtras;
        pedidoPendiente.extras = { ...extrasSeleccionados };
    }
    
    // Mostrar mensaje de confirmación
    if (extrasAplicados.length > 0) {
        mostrarToast(`✅ Extras: ${extrasAplicados.join(", ")} (+$${extrasAplicados.length * 10}) - Total: $${totalConExtras}`);
    } else {
        mostrarToast(`✅ Total: $${totalConExtras} MXN`);
    }
    
    // Cerrar modal de resumen
    cerrarModalResumen();
    
    // Mostrar modal de pago
    const modalPago = document.getElementById("modalPago");
    if (modalPago) {
        modalPago.classList.remove("hidden");
        modalPago.classList.add("flex");
    } else {
        console.error("❌ No se encontró el modal de pago");
        mostrarToast("❌ Error al abrir el método de pago", true);
    }
}

function cerrarModalResumen() {
    const modal = document.getElementById("modalResumenRuta");
    if (modal) modal.remove();
}

// ==================== BÚSQUEDA DE DIRECCIONES ====================

async function buscarDirecciones(query, tipo) {
    if (!query || query.length < 3) {
        document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
        return;
    }
    
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Ciudad del Carmen, Campeche')}&limit=5&addressdetails=1`);
        const data = await response.json();
        
        const sugerenciasDiv = document.getElementById(`${tipo}Sugerencias`);
        
        if (data.length === 0) {
            sugerenciasDiv.classList.add('hidden');
            return;
        }
        
        sugerenciasDiv.innerHTML = data.map(lugar => `
            <div class="sugerencia-item p-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 flex items-start gap-2" 
                 onclick="seleccionarDireccion('${tipo}', ${lugar.lat}, ${lugar.lon}, '${lugar.display_name.replace(/'/g, "\\'")}')">
                <i class="fas fa-map-marker-alt text-gray-400 mt-0.5 text-xs"></i>
                <div class="flex-1">
                    <div class="text-sm font-medium text-gray-800">${lugar.display_name.split(',')[0]}</div>
                    <div class="text-xs text-gray-500">${lugar.display_name.split(',').slice(1, 3).join(',')}</div>
                </div>
            </div>
        `).join('');
        
        sugerenciasDiv.classList.remove('hidden');
        
    } catch(e) {
        console.error('Error buscando direcciones:', e);
    }
}

function seleccionarDireccion(tipo, lat, lng, direccion) {
    const coords = { lat: parseFloat(lat), lng: parseFloat(lng) };
    
    if (coords.lat < 18.58 || coords.lat > 18.70 || coords.lng < -91.88 || coords.lng > -91.75) {
        mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
        document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
        return;
    }
    
    if (tipo === 'origen') {
    originMarker.setLatLng([coords.lat, coords.lng]);
    setOriginCoords(coords);  // ✅ Usa helper
    document.getElementById("origen").value = direccion.split(',')[0];
    } else {
    destMarker.setLatLng([coords.lat, coords.lng]);
    setDestCoords(coords);  // ✅ Usa helper
    document.getElementById("destino").value = direccion.split(',')[0];
    }
    
    document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
    actualizarRutaYTarifa();
    mostrarToast(`📍 ${tipo === 'origen' ? 'Origen' : 'Destino'} actualizado`);
}

// ==================== VER DELIVERYS EN LÍNEA ====================
async function cargarDeliverysEnLinea() {
    // ✅ 1. Verificar si la página está visible
    if (!paginaVisible) {
        console.log("📴 Página oculta, omitiendo carga de deliverys");
        return;
    }
    
    // ✅ 2. Throttling: mínimo 10 segundos entre peticiones
    const ahora = Date.now();
    if (ultimaPeticionDeliverys && (ahora - ultimaPeticionDeliverys) < 10000) {
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
                try { map.removeLayer(marker); } catch(e) {}
            });
            deliverysMarkers = [];
            console.log("📭 No hay deliverys en línea");
            return;
        }
        
        // ✅ 5. OBTENER EL ID DEL DELIVERY ASIGNADO (de forma más segura)
        let deliveryAsignadoId = null;
        
        // Intentar obtener de pedidoActual
        if (pedidoActual && (pedidoActual.estado === 'asignado' || pedidoActual.estado === 'recogido')) {
            deliveryAsignadoId = pedidoActual.delivery_id;
            console.log(`🚚 Delivery asignado detectado en pedidoActual: ${deliveryAsignadoId}`);
        }
        
        // ✅ 6. Si no hay pedidoActual, intentar obtener de Supabase
        if (!deliveryAsignadoId && currentUser) {
            const { data: pedidoReciente } = await supabaseClient
                .from('pedidos')
                .select('delivery_id, estado')
                .eq('cliente_id', currentUser.id)
                .in('estado', ['asignado', 'recogido'])
                .order('fecha', { ascending: false })
                .limit(1);
            
            if (pedidoReciente && pedidoReciente.length > 0 && pedidoReciente[0].delivery_id) {
                deliveryAsignadoId = pedidoReciente[0].delivery_id;
                console.log(`🔄 Delivery asignado recuperado de BD: ${deliveryAsignadoId}`);
            }
        }
        
        // ✅ 7. Obtener IDs de deliverys con pedido activo en GENERAL
        const { data: pedidosActivos } = await supabaseClient
            .from('pedidos')
            .select('delivery_id')
            .in('estado', ['asignado', 'recogido'])
            .not('delivery_id', 'is', null);
        
        const deliverysOcupados = new Set(pedidosActivos?.map(p => p.delivery_id) || []);
        
        // ✅ 8. Limpiar marcadores antiguos
        deliverysMarkers.forEach(marker => {
            try { map.removeLayer(marker); } catch(e) {}
        });
        deliverysMarkers = [];
        
        // ✅ 9. Crear marcadores SOLO para deliverys DISPONIBLES
        let contadorMostrados = 0;
        
        for (const delivery of ubicaciones) {
            // 🔴 CRITERIO 1: Saltar si ES el delivery asignado a MI pedido
            if (deliveryAsignadoId && delivery.delivery_id === deliveryAsignadoId) {
                console.log(`🚫 Ocultando delivery ASIGNADO A MÍ: ${delivery.delivery_nombre}`);
                continue;
            }
            
            // 🔴 CRITERIO 2: Saltar si el delivery está ocupado con OTRO pedido
            if (deliverysOcupados.has(delivery.delivery_id)) {
                console.log(`🚫 Ocultando delivery OCUPADO: ${delivery.delivery_nombre}`);
                continue;
            }
            
            // ✅ Delivery disponible - mostrar en mapa (VERDE)
            const marker = crearMarcadorDelivery(
                delivery.lat, 
                delivery.lng, 
                delivery.delivery_nombre, 
                '#10B981'  // Verde para disponibles
            );
            
            marker.bindPopup(`
                <b>🏍️ ${delivery.delivery_nombre}</b><br>
                🟢 Disponible<br>
                <small>Última actualización: ${new Date(delivery.updated_at).toLocaleTimeString()}</small>
            `);
            
            marker.addTo(map);
            deliverysMarkers.push(marker);
            contadorMostrados++;
        }
        
        console.log(`✅ ${contadorMostrados} deliverys disponibles mostrados`);
        if (deliveryAsignadoId) {
            console.log(`   (Excluido delivery asignado: ${deliveryAsignadoId})`);
        }
        
    } catch(e) {
        console.error('❌ Error cargando deliverys en línea:', e);
    }
}

// ==================== ROTACIÓN DEL MAPA (2D) ====================
function rotateMapLeft() {
    if (!map) return;
    mapRotationAngle = (mapRotationAngle - 45) % 360;
    applyMapRotation();
    mostrarToast(`🧭 Mapa girado ${mapRotationAngle}°`);
}

function rotateMapRight() {
    if (!map) return;
    mapRotationAngle = (mapRotationAngle + 45) % 360;
    applyMapRotation();
    mostrarToast(`🧭 Mapa girado ${mapRotationAngle}°`);
}

function resetMapRotation() {
    if (!map) return;
    mapRotationAngle = 0;
    applyMapRotation();
    mostrarToast("🧭 Orientación restablecida");
}

function applyMapRotation() {
    const mapContainer = map.getContainer();
    const currentCenter = map.getCenter();
    
    // Aplicar rotación
    mapContainer.style.transform = `rotate(${mapRotationAngle}deg)`;
    mapContainer.style.transition = 'transform 0.4s ease';
    
    // Evitar bordes blancos
    if (mapRotationAngle !== 0) {
        mapContainer.style.width = '150%';
        mapContainer.style.height = '150%';
        mapContainer.style.margin = '-25%';
    } else {
        mapContainer.style.width = '100%';
        mapContainer.style.height = '100%';
        mapContainer.style.margin = '0';
    }
    
    // Rotar marcadores
    if (originMarker && typeof originMarker.setRotationAngle === 'function') {
        originMarker.setRotationAngle(mapRotationAngle);
    }
    if (destMarker && typeof destMarker.setRotationAngle === 'function') {
        destMarker.setRotationAngle(mapRotationAngle);
    }
    if (deliveryMarker && typeof deliveryMarker.setRotationAngle === 'function') {
        deliveryMarker.setRotationAngle(mapRotationAngle);
    }
    
    // Reajustar mapa
    setTimeout(() => {
        map.invalidateSize();
        map.setView(currentCenter);
    }, 100);
}

// ==================== LIMPIAR RECURSOS AL CERRAR PESTAÑA ====================
function limpiarTodosLosIntervalos() {
    console.log("🧹 Limpiando intervalos y recursos...");
    
    // Limpiar intervalos principales
    if (seguimientoInterval) {
        clearInterval(seguimientoInterval);
        seguimientoInterval = null;
        console.log("✅ seguimientoInterval limpiado");
    }
    
    if (ubicacionInterval) { clearInterval(ubicacionInterval); ubicacionInterval = null; console.log("✅ ubicacionInterval limpiado"); }
    if (deliverysInterval) { clearInterval(deliverysInterval); deliverysInterval = null; console.log("✅ deliverysInterval limpiado"); }
    if (busquedaTimeout) { clearTimeout(busquedaTimeout); busquedaTimeout = null; }
    
    // Limpiar rutas del mapa para liberar memoria
    if (clienteRouteControl) {try { if (clienteRouteControl._map) { map.removeControl(clienteRouteControl); } } catch(e) {} clienteRouteControl = null; }
    // Eliminar marcadores
    if (deliveryMarker) { try { map.removeLayer(deliveryMarker); } catch(e) {} deliveryMarker = null; }
    console.log("✅ Todos los recursos liberados");
}

// Guardar referencia a la función original de cerrar sesión si existe
const originalCerrarSesionCliente = window.cerrarSesion;
// Sobrescribir cerrarSesion para incluir limpieza
window.cerrarSesion = function() {
    limpiarTodosLosIntervalos();
    if (originalCerrarSesionCliente) {
        originalCerrarSesionCliente();
    }
};

// Evento cuando la página se está cerrando (pestaña cerrada, navegador cerrado, refresh)
window.addEventListener('beforeunload', function() {
    console.log("🚪 Pestaña cerrando - Limpiando recursos...");
    limpiarTodosLosIntervalos();
});

// Evento cuando la página se descarga completamente (último recurso)
window.addEventListener('pagehide', function() {
    console.log("💀 Página descargada - Recursos liberados");
    if (currentUser && currentUser.rol === 'cliente' && supabaseClient) {
        console.log("👋 Cliente desconectado");
    }
});

// Esto ya está manejado con visibilitychange, pero reforzamos
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log("📱 Pestaña oculta - Reduciendo actividad");
        // Opcional: pausar intervalos menos críticos
        if (deliverysInterval) {
            // No lo cancelamos, solo reducimos frecuencia (ya está en 15 segundos)
        }
    } else {
        console.log("🟢 Pestaña visible - Reanudando actividad normal");
    }
});