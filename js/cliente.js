import './shared.js';
import './security.js';
import './config.js';
import './map-utils.js'; 
// ==================== CONSTANTES Y LÍMITES ====================
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

// ==================== VARIABLES DEL MAPA ====================
let map = null;
let originMarker = null;
let destMarker = null;
let routeLine = null;
let deliveryMarker = null;
let clienteRouteControl = null;
// ✅ NUEVAS VARIABLES PARA AUTO-FOLLOW DEL DELIVERY
let autoFollowDelivery = true;      // Seguir al delivery automáticamente
let followZoomLevel = 16;           // Nivel de zoom al seguir el delivery

// ==================== COORDENADAS (SOLO UNA DECLARACIÓN) ====================
window.originCoords = null;
window.destCoords = null;    // ✅ Única variable de destino
window.confetiLanzado = false;

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
let estadoActualProgreso = null; // 'buscando', 'asignado', 'enCamino', 'entregado'
let ultimaDistanciaLlegada = null;   // Control de vibración/zoom por llegada

// ==================== DELIVERYS EN LÍNEA ====================
let deliverysMarkers = [];           // Marcadores de deliverys disponibles

// ==================== UI Y MODOS ====================
let selectMode = 'origen';           // 'origen' o 'destino'
let mapRotationAngle = 0;            // Ángulo de rotación del mapa

// ==================== CONTROL DE PETICIONES (THROTTLING) ====================
let debounceTimer = null;
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
    // Verificar que securityManager existe
    if (typeof securityManager === 'undefined' || !securityManager) {
        console.error("❌ securityManager no disponible");
        window.location.href = "index.html";
        return;
    }
    
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
            <span class="font-medium">${sanitizarHTML(currentUser.nombre)}</span>
            <span class="text-gray-400 text-xs">(Cliente)</span>
        </div>
    `;
    
    const userInfoMobile = document.getElementById("userInfoMobile");
    if (userInfoMobile) {
        userInfoMobile.innerHTML = document.getElementById("userInfo").innerHTML;
    }
    
    cargarPedidoActivoDesdeDB();
}

// ==================== CARGAR PEDIDO ACTIVO DESDE BD ====================
async function cargarPedidoActivoDesdeDB() {
    const supabase = supabaseClient;
    if (!supabase || !currentUser) return;
    
    try {
        // Buscar pedidos activos (pendiente, asignado, recogido)
        const { data: pedidoActivo, error } = await supabase
            .from('pedidos')
            .select('*')
            .eq('cliente_id', currentUser.id)
            .in('estado', ['pendiente', 'asignado', 'recogido'])
            .order('fecha', { ascending: false })
            .limit(1);
        
        if (error) throw error;
        
        if (pedidoActivo && pedidoActivo.length > 0) {
            pedidoActual = convertirPedidoDeSupabase(pedidoActivo[0]);
            console.log("🔄 Pedido activo recuperado de BD:", pedidoActual.id, "- Estado:", pedidoActual.estado);
            
            // Mostrar panel de estado
            mostrarPanelEstado(pedidoActual);
            
            // Mostrar tarjeta de progreso
            actualizarTarjetaProgreso();
            
            // Si el pedido está asignado o recogido, iniciar seguimiento
            if (pedidoActual.estado === 'asignado' || pedidoActual.estado === 'recogido') {
                if (pedidoActual.delivery_id) {
                    mostrarDeliveryEnMapa(pedidoActual.delivery_id, pedidoActual.delivery_nombre);
                    seguirUbicacionDelivery(pedidoActual.delivery_id);
                }
                iniciarSeguimientoDelivery();
            }
            
            // Bloquear UI
            bloquearUIporPedidoActivo(true);
            
        } else {
            console.log("📭 No hay pedidos activos");
            bloquearUIporPedidoActivo(false);
        }
    } catch(e) {
        console.error('Error cargando pedido activo:', e);
    }
}

// ==================== CERRAR SESIÓN CORREGIDO ====================
async function cerrarSesion() { 
    console.log("🔐 Mostrando modal de confirmación...");
    
    // Usar mostrarModalConfirmacion con callbacks en lugar de confirmarConModal
    let confirmado = false;
    mostrarModalConfirmacion(
        "Cerrar Sesión",
        "¿Estás seguro de que deseas cerrar sesión?",
        () => {
            console.log("✅ Usuario confirmó cierre de sesión, procediendo...");
            confirmado = true;
            
            // Detener sincronización mobile
            if (typeof detenerSincronizacion === 'function') {
                detenerSincronizacion();
            }
            
            // Limpiar intervalos
            if (seguimientoInterval) clearInterval(seguimientoInterval);
            if (ubicacionInterval) clearInterval(ubicacionInterval);
            if (deliverysInterval) clearInterval(deliverysInterval);
            
            // Limpiar localStorage y redirigir
            localStorage.clear();
            sessionStorage.clear();
            
            // Redirigir al login
            console.log("👋 Redirigiendo a index.html");
            window.location.href = "index.html";
        },
        () => {
            console.log("❌ Usuario canceló cierre de sesión");
        }
    );
}

// ==================== EVENT LISTENERS ====================
const origenInput = document.getElementById('origen');
const destinoInput = document.getElementById('destino');
const btnCancelarPedido = document.getElementById('btnCancelarPedido');

if (btnCancelarPedido) { btnCancelarPedido.addEventListener('click', cancelarPedido); }

const btnCancelarPedidoMobile = document.getElementById('btnCancelarPedidoMobile');
if (btnCancelarPedidoMobile) {
    btnCancelarPedidoMobile.addEventListener('click', cancelarPedido);
}

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
        inputsMobile: ['origenMobile', 'destinoMobile'],
        select: 'tipoEnvio',
        selectMobile: 'tipoEnvioMobile',
        botones: ['btnOrigen', 'btnDestino'],
        botonSolicitar: 'solicitarEnvio'
    };
    
    if (bloquear) {
        // ========== BLOQUEAR UI ==========
        
        // Bloquear inputs (DESKTOP y MOBILE)
        elementos.inputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = true;
                input.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
            }
        });
        
        elementos.inputsMobile.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = true;
                input.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
            }
        });
        
        // Bloquear selects
        const select = document.getElementById(elementos.select);
        if (select) {
            select.disabled = true;
            select.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
        }
        
        const selectMobile = document.getElementById(elementos.selectMobile);
        if (selectMobile) {
            selectMobile.disabled = true;
            selectMobile.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
        }
        
        // Bloquear botones de modo
        elementos.botones.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.pointerEvents = 'none';
                btn.classList.add('opacity-50');
            }
        });
        
        // ✅ NUEVO: OCULTAR COMPLETAMENTE los marcadores de origen y destino
        if (originMarker) {
            originMarker.dragging.disable();
            originMarker.setOpacity(0);  // ← Completamente invisible
            // Opcional: remover del mapa temporalmente
            // originMarker.removeFrom(map);
        }
        if (destMarker) {
            destMarker.dragging.disable();
            destMarker.setOpacity(0);    // ← Completamente invisible
            // destMarker.removeFrom(map);
        }
        
        // Deshabilitar click en el mapa
        if (map) { map._container.style.cursor = 'default'; }
        
        // Cambiar placeholders
        const origenInput = document.getElementById('origen');
        if (origenInput && !origenInput.placeholder.includes('(Bloqueado)')) {
            origenInput.placeholder = '📍 Origen (bloqueado - pedido en curso)';
        }
        const destinoInput = document.getElementById('destino');
        if (destinoInput && !destinoInput.placeholder.includes('(Bloqueado)')) {
            destinoInput.placeholder = '🏁 Destino (bloqueado - pedido en curso)';
        }
        
        const origenMobileInput = document.getElementById('origenMobile');
        if (origenMobileInput && !origenMobileInput.placeholder.includes('(Bloqueado)')) {
            origenMobileInput.placeholder = '📍 Origen (bloqueado - pedido en curso)';
        }
        const destinoMobileInput = document.getElementById('destinoMobile');
        if (destinoMobileInput && !destinoMobileInput.placeholder.includes('(Bloqueado)')) {
            destinoMobileInput.placeholder = '🏁 Destino (bloqueado - pedido en curso)';
        }

        // Sincronizar bloqueo con móvil
        if (typeof window.sincronizarBloqueoMobile === 'function') { 
            window.sincronizarBloqueoMobile(true); 
        }
        console.log("🔒 UI bloqueada - Marcadores de origen/destino ocultos");
        
    } else {
        // ========== REACTIVAR UI ==========
        
        // Reactivar inputs
        elementos.inputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = false;
                input.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
                input.placeholder = 'Buscar dirección o arrastra el marcador';
            }
        });
        
        elementos.inputsMobile.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = false;
                input.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
                input.placeholder = 'Buscar dirección...';
            }
        });
        
        // Reactivar selects
        const select = document.getElementById(elementos.select);
        if (select) {
            select.disabled = false;
            select.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
        }
        
        const selectMobile = document.getElementById(elementos.selectMobile);
        if (selectMobile) {
            selectMobile.disabled = false;
            selectMobile.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
        }
        
        // Reactivar botones de modo
        elementos.botones.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.pointerEvents = 'auto';
                btn.classList.remove('opacity-50');
            }
        });
        
        // ✅ NUEVO: MOSTRAR Y REACTIVAR marcadores
        if (originMarker) {
            originMarker.dragging.enable();
            originMarker.setOpacity(1);  // ← Volver visible
        }
        if (destMarker) {
            destMarker.dragging.enable();
            destMarker.setOpacity(1);    // ← Volver visible
        }
        
        // Reactivar click en el mapa
        if (map) { map._container.style.cursor = 'crosshair'; }
        
        // Reactivar botón solicitar
        const btnSolicitar = document.querySelector('button[onclick="solicitarEnvio()"], button[onclick="solicitarEnvioMobile()"]');
        if (btnSolicitar) {
            btnSolicitar.disabled = false;
            btnSolicitar.classList.remove('opacity-50', 'cursor-not-allowed');
        }

        // Sincronizar reactivación con móvil
        if (typeof window.sincronizarBloqueoMobile === 'function') { 
            window.sincronizarBloqueoMobile(false); 
        }
        console.log("🔓 UI reactivada - Marcadores de origen/destino visibles nuevamente");
    }
}

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

    // ==================== FUNCIONES DE UTILIDAD ====================
function actualizarRutaYTarifaDebounced() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        actualizarRutaYTarifa();
        debounceTimer = null;
    }, 500);
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

// ✅ POPUP AL PASAR EL CURSOR (HOVER) - SIN HACER CLICK
originMarker.bindPopup('📍 <b>Origen</b><br>Arrástrame para cambiar');
destMarker.bindPopup('🏁 <b>Destino</b><br>Arrástrame para cambiar');

// Abrir popup al pasar el mouse
originMarker.on('mouseover', function() {
    this.openPopup();
});

destMarker.on('mouseover', function() {
    this.openPopup();
});

// Cerrar popup al salir el mouse
originMarker.on('mouseout', function() {
    this.closePopup();
});

destMarker.on('mouseout', function() {
    this.closePopup();
});
       
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
        
        actualizarRutaYTarifaDebounced();
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
        
        actualizarRutaYTarifaDebounced();
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

        actualizarRutaYTarifaDebounced();
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
        actualizarRutaYTarifaDebounced();
        map.invalidateSize(); // Forzar resize por si acaso
    }, 500);

    console.log("🗺️ Mapa Cliente inicializado con rotación activada");
    console.log("📍 Coordenadas iniciales:", {
        origen: getOriginCoords(),
        destino: getDestCoords()
    });
}

function actualizarTarjetaProgreso(distanciaKm, estado, destinoTexto) {
    const card = document.getElementById('progressCard');
    if (!card) return;

    // Mostrar la tarjeta si está oculta
    if (card.classList.contains('hidden')) {
        card.classList.remove('hidden');
    }
    
    const estadoElem = document.getElementById('progressEstado');
    const barra = document.getElementById('progressBar');
    const distanciaElem = document.getElementById('progressDistancia');
    const mensajeElem = document.getElementById('progressMensaje');
    const puntosContainer = document.getElementById('progressPuntos');
    const calificarContainer = document.getElementById('calificarContainer');
    
    // Determinar estado general (buscando, asignado, enCamino, entregado)
    let estadoGeneral = 'buscando';
    let colorBarra = '#fbbf24'; // amarillo
    let puntosActivos = 0;
    
    // Colores para la tarjeta (background y border-left)
    let cardBg = '';
    let cardBorderLeft = '';
    
    if (!pedidoActual) {
        estadoGeneral = 'buscando';
        puntosActivos = 0;
        cardBg = '#fef9e6';
        cardBorderLeft = '#fbbf24';
    } else if (pedidoActual.estado === 'pendiente') {
        estadoGeneral = 'buscando';
        puntosActivos = 1;
        cardBg = '#fef9e6';
        cardBorderLeft = '#fbbf24';
    } else if (pedidoActual.estado === 'asignado') {
        estadoGeneral = 'asignado';
        colorBarra = '#3b82f6';
        puntosActivos = 2;
        cardBg = '#e6f0ff';
        cardBorderLeft = '#3b82f6';
    } else if (pedidoActual.estado === 'recogido') {
        estadoGeneral = 'enCamino';
        colorBarra = '#f97316';
        puntosActivos = 3;
        cardBg = '#fff7ed';
        cardBorderLeft = '#f97316';
    } else if (pedidoActual.estado === 'completado') {
        estadoGeneral = 'entregado';
        colorBarra = '#10b981';
        puntosActivos = 4;
        cardBg = '#ecfdf5';
        cardBorderLeft = '#10b981';
        // Mostrar botón calificar
        if (calificarContainer) calificarContainer.classList.remove('hidden');
    }
    
    // ✅ APLICAR COLORES DIRECTAMENTE CON JAVASCRIPT
    card.style.background = cardBg;
    card.style.borderLeft = `4px solid ${cardBorderLeft}`;
    
    // Actualizar puntos visuales
    const puntos = puntosContainer.querySelectorAll('i');
    puntos.forEach((punto, idx) => {
        punto.classList.remove('punto-activo');
        if (idx < puntosActivos) {
            punto.style.color = colorBarra;
            if (idx === puntosActivos - 1 && estadoGeneral !== 'entregado') {
                punto.classList.add('punto-activo');
            }
        } else {
            punto.style.color = '#d1d5db';
        }
    });
    
    // Actualizar barra de progreso (0% a 100% según puntos)
    const porcentaje = (puntosActivos / 4) * 100;
    barra.style.width = `${porcentaje}%`;
    barra.style.backgroundColor = colorBarra;
    
    // Textos según estado y distancia
    if (estadoGeneral === 'buscando') {
        estadoElem.innerText = '⏳ Buscando delivery...';
        distanciaElem.innerText = '';
        mensajeElem.innerText = 'Estamos buscando un delivery disponible. En breve alguien tomará tu pedido.';
    } else if (estadoGeneral === 'asignado') {
        estadoElem.innerText = '🚚 Delivery asignado';
        if (distanciaKm !== undefined) {
            let distanciaTexto = distanciaKm < 0.1 ? '< 100 m' : `${distanciaKm.toFixed(1)} km`;
            distanciaElem.innerText = distanciaTexto;
            if (distanciaKm < 0.15) {
                estadoElem.innerText = '🚚 LLEGANDO A RECOGER';
                mensajeElem.innerText = '¡El delivery está llegando al origen!';
                // Vibración y zoom (si no se ha hecho)
                if (ultimaDistanciaLlegada !== 'llegando') {
                    if (window.navigator.vibrate) window.navigator.vibrate(500);
                    mostrarToast('🔔 ¡El delivery está llegando!', false);
                    ultimaDistanciaLlegada = 'llegando';
                    if (deliveryMarker) map.setView(deliveryMarker.getLatLng(), 17);
                }
            } else if (distanciaKm < 0.5) {
                estadoElem.innerText = '🟡 Muy cerca del origen';
                mensajeElem.innerText = 'El delivery está por llegar al punto de recogida';
            } else {
                mensajeElem.innerText = 'El delivery se dirige a recoger tu paquete';
            }
        } else {
            mensajeElem.innerText = 'Delivery en camino al origen';
        }
    } else if (estadoGeneral === 'enCamino') {
        estadoElem.innerText = '📦 En camino a entregar';
        if (distanciaKm !== undefined) {
            let distanciaTexto = distanciaKm < 0.1 ? '< 100 m' : `${distanciaKm.toFixed(1)} km`;
            distanciaElem.innerText = distanciaTexto;
            if (distanciaKm < 0.15) {
                estadoElem.innerText = '🎉 LLEGANDO A DESTINO';
                mensajeElem.innerText = '¡Tu paquete está por llegar!';
                if (ultimaDistanciaLlegada !== 'llegando') {
                    if (window.navigator.vibrate) window.navigator.vibrate(500);
                    mostrarToast('🔔 ¡Tu paquete está por llegar!', false);
                    ultimaDistanciaLlegada = 'llegando';
                    if (deliveryMarker) map.setView(deliveryMarker.getLatLng(), 17);
                }
            } else if (distanciaKm < 0.5) {
                estadoElem.innerText = '🟡 Muy cerca del destino';
                mensajeElem.innerText = 'El delivery está cerca de entregar';
            } else {
                mensajeElem.innerText = 'El delivery se dirige a tu destino';
            }
        } else {
            mensajeElem.innerText = 'Delivery en camino a tu destino';
        }
    } else if (estadoGeneral === 'entregado') {
        estadoElem.innerText = '✅ Entregado';
        distanciaElem.innerText = '';
        mensajeElem.innerText = '¡Envío completado! Gracias por usar MandaYa.';
        // Lanzar confeti solo una vez
        if (window.confetiLanzado !== true) {
            window.confetiLanzado = true;
            lanzarConfeti();
        }
        setTimeout(() => {
            ocultarTarjetaProgreso();
            pedidoActual = null;
            window.confetiLanzado = false; // Reset para futuros pedidos
        }, 8000);
    }
}

function lanzarConfeti() {
    console.log("🎉 Lanzando confeti!");
    const colors = ['#fbbf24', '#3b82f6', '#f97316', '#10b981', '#ef4444', '#8b5cf6', '#ff6b6b', '#4ecdc4', '#f43f5e', '#06b6d4'];
    
    for (let i = 0; i < 150; i++) {
        const confetti = document.createElement('div');
        confetti.classList.add('confetti');
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.width = Math.random() * 10 + 5 + 'px';
        confetti.style.height = confetti.style.width;
        confetti.style.position = 'fixed';
        confetti.style.top = '-20px';
        confetti.style.borderRadius = '50%';
        confetti.style.zIndex = '10001';
        confetti.style.pointerEvents = 'none';
        
        const duration = Math.random() * 3 + 2;
        const delay = Math.random() * 2;
        
        confetti.style.animation = `confettiFall ${duration}s linear forwards`;
        confetti.style.animationDelay = `${delay}s`;
        
        document.body.appendChild(confetti);
        
        setTimeout(() => {
            if (confetti && confetti.remove) confetti.remove();
        }, (duration + delay) * 1000);
    }
}

function calificarServicio() {
    mostrarModalCalificacion();
}

function mostrarModalCalificacion() {
    // Crear modal simple para calificar
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10002] p-4';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl max-w-sm w-full p-6 text-center">
            <h3 class="text-white text-lg font-bold mb-4">Califica el servicio</h3>
            <div class="flex justify-center gap-3 mb-4" id="estrellasCalificacion">
                ${[1,2,3,4,5].map(i => `<i class="fas fa-star text-3xl text-gray-500 cursor-pointer hover:text-yellow-400 transition-all" data-puntuacion="${i}"></i>`).join('')}
            </div>
            <textarea id="comentarioCalificacion" class="w-full bg-gray-700 text-white rounded-lg p-2 text-sm" rows="2" placeholder="Opcional: deja un comentario"></textarea>
            <button id="enviarCalificacion" class="mt-4 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl w-full">Enviar calificación</button>
            <button onclick="this.parentElement.parentElement.remove()" class="mt-2 text-gray-400 text-sm">Cerrar</button>
        </div>
    `;
    document.body.appendChild(modal);
    
    let puntuacion = 0;
    const stars = modal.querySelectorAll('#estrellasCalificacion i');
    
    stars.forEach(star => {
        star.addEventListener('click', () => {
            puntuacion = parseInt(star.dataset.puntuacion);
            stars.forEach(s => {
                const val = parseInt(s.dataset.puntuacion);
                if (val <= puntuacion) {
                    s.classList.remove('text-gray-500');
                    s.classList.add('text-yellow-400');
                } else {
                    s.classList.remove('text-yellow-400');
                    s.classList.add('text-gray-500');
                }
            });
        });
    });
    
    modal.querySelector('#enviarCalificacion').onclick = async () => {
        if (puntuacion === 0) {
            mostrarToast('❌ Selecciona una puntuación', true);
            return;
        }
        
        const comentario = modal.querySelector('#comentarioCalificacion').value;
        const supabase = supabaseClient;
        
        if (supabase && pedidoActual) {
            await supabase.from('calificaciones').insert({
                pedido_id: pedidoActual.id,
                delivery_id: pedidoActual.delivery_id,
                cliente_id: currentUser.id,
                puntuacion: puntuacion,
                comentario: comentario,
                fecha: new Date().toISOString()
            });
        }
        
        // ✅ Mostrar mensaje de agradecimiento
        mostrarToast(`✅ ¡Gracias por tu calificación de ${puntuacion} estrellas! 🌟`);
        
        // ✅ Cambiar el contenido del modal a un mensaje de agradecimiento
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-2xl max-w-sm w-full p-6 text-center">
                <div class="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fas fa-heart text-3xl text-green-500"></i>
                </div>
                <h3 class="text-white text-xl font-bold mb-2">¡Gracias por calificar!</h3>
                <p class="text-gray-400 text-sm">Tu opinión nos ayuda a mejorar el servicio.</p>
                <div class="mt-4 flex justify-center gap-1 text-yellow-400 text-xl">
                    ${'★'.repeat(puntuacion)}${'☆'.repeat(5 - puntuacion)}
                </div>
            </div>
        `;
        
        // ✅ Cerrar el modal automáticamente después de 2 segundos
        setTimeout(() => {
            modal.remove();
        }, 2000);
    };
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

    if (!orig || !dest) {
        console.log("⚠️ No hay coordenadas de origen o destino");
        return;
    }

    const origenSeguro = limitarCoordenadasACarmen(orig.lat, orig.lng);
    const destinoSeguro = limitarCoordenadasACarmen(dest.lat, dest.lng);

    // Guardar corregidas
    setOriginCoords(origenSeguro);
    setDestCoords(destinoSeguro);

    // Corregir marcadores visualmente
    if (originMarker) {
        originMarker.setLatLng([origenSeguro.lat, origenSeguro.lng]);
    }
    if (destMarker) {
        destMarker.setLatLng([destinoSeguro.lat, destinoSeguro.lng]);
    }

    // Mostrar loading
    const tarifaContainer = document.getElementById("tarifaContainer");
    const tarifaContainerMobile = document.getElementById("tarifaContainerMobile");
    if (tarifaContainer) tarifaContainer.classList.remove("hidden");
    if (tarifaContainerMobile) tarifaContainerMobile.classList.remove("hidden");
    
    const tarifaValue = document.getElementById("tarifaValue");
    const tarifaValueMobile = document.getElementById("tarifaValueMobile");
    if (tarifaValue) tarifaValue.innerHTML = '<div class="loading-spinner"></div> Calculando...';
    if (tarifaValueMobile) tarifaValueMobile.innerHTML = '<div class="loading-spinner"></div> Calculando...';

    // Limpiar rutas anteriores
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

    if (clienteRouteControl) {
        try {
            if (clienteRouteControl._map) {
                map.removeControl(clienteRouteControl);
            }
        } catch(e) {}
        clienteRouteControl = null;
    }

    const extrasGuardados = currentRouteData?.extras || {
        lluvia: false,
        noche: false,
        espera: false
    };

    const tipoEnvio = document.getElementById("tipoEnvio")?.value || 
                      document.getElementById("tipoEnvioMobile")?.value || 
                      'paquete';

    const routeResult = await drawRealRoute(map, origenSeguro, destinoSeguro, '#FF6200', 5);

    let distance, duration, rate;

    if (routeResult && routeResult.routeData) {
        routeLine = routeResult.line;
        distance = routeResult.routeData.distance;
        duration = routeResult.routeData.duration;
        rate = calculateShippingRate(distance, tipoEnvio);

        currentRouteData = {
            distance: distance,
            duration: duration,
            extras: extrasGuardados
        };

        mostrarToast(`📏 Distancia: ${distance.toFixed(2)} km • ⏱️ ${formatDuration(duration)}`);

    } else {
        distance = calcularDistanciaEntrePuntos(origenSeguro, destinoSeguro);
        duration = distance * 2;
        rate = calculateShippingRate(distance, tipoEnvio);

        currentRouteData = {
            distance: distance,
            duration: duration,
            extras: extrasGuardados
        };

        if (map) {
            routeLine = L.polyline([
                [origenSeguro.lat, origenSeguro.lng],
                [destinoSeguro.lat, destinoSeguro.lng]
            ], {
                color: '#FF6200',
                weight: 5,
                opacity: 0.6,
                dashArray: '5, 10'
            }).addTo(map);
        }

        mostrarToast(`📏 Distancia: ${distance.toFixed(2)} km (estimado)`);
    }

    let tarifaMostrar = rate.total;
    if (currentRouteData.extras.lluvia) tarifaMostrar += 10;
    if (currentRouteData.extras.noche) tarifaMostrar += 10;
    if (currentRouteData.extras.espera) tarifaMostrar += 10;

    if (tarifaValue) {
        tarifaValue.innerHTML = `$${tarifaMostrar} MXN${routeResult ? '' : ' (estimado)'}`;
    }
    if (tarifaValueMobile) {
        tarifaValueMobile.innerHTML = `$${tarifaMostrar} MXN${routeResult ? '' : ' (estimado)'}`;
    }

    if (pedidoPendiente) {
        pedidoPendiente.tarifa = tarifaMostrar;
        pedidoPendiente.distancia_real = distance.toFixed(2);
        pedidoPendiente.extras = { ...currentRouteData.extras };
    }

    console.log(`✅ Ruta actualizada: ${distance.toFixed(2)}km, tarifa: $${tarifaMostrar}`);
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
    // Validar si ya hay un pedido activo (pendiente, asignado o recogido)
    if (pedidoActual && ['pendiente', 'asignado', 'recogido'].includes(pedidoActual.estado)) {
        mostrarToast(`❌ Ya tienes un pedido activo (#${pedidoActual.id}). Complétalo antes de solicitar otro.`, true);
        return;
    }

    try {
        const origen = document.getElementById("origen").value;
        const destino = document.getElementById("destino").value;
        const tipo = document.getElementById("tipoEnvio").value;
        
        const origenCoord = getOriginCoords();
        const destinoCoord = getDestCoords();
        
        if (!origenCoord || !destinoCoord || !origenCoord.lat || !destinoCoord.lat) {
            console.error("Coordenadas inválidas:", { origenCoord, destinoCoord });
            mostrarToast("❌ Error: No se han seleccionado origen o destino válidos", true);
            return;
        }
        
        if (!tipo || tipo === '') {
            mostrarToast("❌ Por favor, selecciona qué vas a enviar (Comida, Paquete, Mercancía o Farmacia)", true);
            const selectTipo = document.getElementById("tipoEnvio");
            selectTipo.style.border = "2px solid #dc2626";
            setTimeout(() => {
                selectTipo.style.border = "";
            }, 2000);
            return;
        }
        
        let distancia = currentRouteData ? currentRouteData.distance : calcularDistanciaEntrePuntos(origenCoord, destinoCoord);
        const rate = calculateShippingRate(distancia, tipo);
        let tarifaBase = rate.total;
        
        let tarifaFinal = tarifaBase;
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
            origen_lat: origenCoord.lat,
            origen_lng: origenCoord.lng,
            destino_lat: destinoCoord.lat,
            destino_lng: destinoCoord.lng,
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
        
        const modalPago = document.getElementById("modalPago");
        if (modalPago) {
            modalPago.classList.remove("hidden");
            modalPago.classList.add("flex");
        } else {
            console.error("❌ Modal de pago no encontrado");
            mostrarToast("❌ Error al abrir el pago", true);
        }
    } catch (error) {
        console.error("Error en solicitarEnvio:", error);
        mostrarToast("❌ Ocurrió un error inesperado", true);
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
    
    // ✅ false = NO mostrar modal de WhatsApp
    await guardarPedidoEnSupabase(false);
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
    const panelMobile = document.getElementById("panelEstadoPedidoMobile");
    if (!panel) return;
    
    document.getElementById("pedidoIdLabel").innerText = pedido.id;
    if (panelMobile) document.getElementById("pedidoIdLabelMobile").innerText = pedido.id;
    
    actualizarEstadoPanel(pedido.estado);
    
    panel.classList.remove("hidden");
    if (panelMobile) panelMobile.classList.remove("hidden");
    
    // ✅ MOSTRAR TARJETA DE PROGRESO TAMBIÉN AL CARGAR UN PEDIDO EXISTENTE
    actualizarTarjetaProgreso();
    
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
            
        case 'asignado': {
            const nombreSeguro = window.sanitizarHTML ? window.sanitizarHTML(deliveryNombre || 'Delivery') : (deliveryNombre || 'Delivery');
            if(estadoTexto) estadoTexto.innerText = "🚚 En camino a recoger";
            if(estadoIcono) estadoIcono.className = "fas fa-motorcycle text-orange-500";
            if(estadoDetalle) estadoDetalle.innerHTML = `🏍️ <strong>${nombreSeguro}</strong> ya se dirige a recoger tu paquete.`;
            
            if(estadoTextoMobile) estadoTextoMobile.innerText = "🚚 En camino a recoger";
            if(estadoIconoMobile) estadoIconoMobile.className = "fas fa-motorcycle text-orange-500";
            if(estadoDetalleMobile) estadoDetalleMobile.innerHTML = `🏍️ <strong>${nombreSeguro}</strong> ya se dirige a recoger tu paquete.`;
            break;
        }
            
        case 'recogido': {
            const nombreSeguro = window.sanitizarHTML ? window.sanitizarHTML(deliveryNombre || 'Delivery') : (deliveryNombre || 'Delivery');
            if(estadoTexto) estadoTexto.innerText = "📦 Paquete recogido";
            if(estadoIcono) estadoIcono.className = "fas fa-box-open text-purple-500";
            if(estadoDetalle) estadoDetalle.innerHTML = `🏍️ <strong>${nombreSeguro}</strong> ya recogió tu paquete y va en camino.`;
            
            if(estadoTextoMobile) estadoTextoMobile.innerText = "📦 Paquete recogido";
            if(estadoIconoMobile) estadoIconoMobile.className = "fas fa-box-open text-purple-500";
            if(estadoDetalleMobile) estadoDetalleMobile.innerHTML = `🏍️ <strong>${nombreSeguro}</strong> ya recogió tu paquete y va en camino.`;
            break;
        }
            
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
    
    const confirmado = await confirmarConModal(
        `¿Estás seguro de cancelar el pedido #${sanitizarHTML(pedidoActual.id)}? Esta acción no se puede deshacer.`,
        null,
        null,
        "Cancelar pedido"
    );
    
    if (!confirmado) return;
    
    const supabase = supabaseClient;
    if (!supabase) return;
    
    try {
        const { error } = await supabase
            .from('pedidos')
            .delete()
            .eq('id', pedidoActual.id);
        
        if (error) throw error;
        
        mostrarToast(`✅ Pedido #${sanitizarHTML(pedidoActual.id)} cancelado correctamente`);
        
        // ✅ Reactivar UI antes de limpiar
        bloquearUIporPedidoActivo(false);
        limpiarYResetearUI();
        
    } catch(e) {
        console.error('Error cancelando pedido:', e);
        mostrarToast("❌ Error al cancelar el pedido", true);
    }
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
    
    // Limpiar tipo de envío en móvil (campo oculto)
    const tipoEnvioMobile = document.getElementById("tipoEnvioMobile");
    if (tipoEnvioMobile) tipoEnvioMobile.value = "";
    
    // Resetear botones de tipo móvil (visualmente)
    document.querySelectorAll('.tipo-mobile-btn').forEach(btn => {
        btn.classList.remove('bg-orange-500', 'text-white');
        btn.classList.add('bg-gray-100', 'text-gray-800');
    });
    
    // También limpiar campos móviles si existen
    const origenMobile = document.getElementById("origenMobile");
    const destinoMobile = document.getElementById("destinoMobile");
    if (origenMobile) origenMobile.value = "";
    if (destinoMobile) destinoMobile.value = "";
    
    // Restablecer marcadores a posición por defecto
    if (originMarker && destMarker) {
        const defaultOrigen = { lat: 18.6456, lng: -91.8249 };
        const defaultDestino = { lat: 18.6556, lng: -91.8149 };
        
        setOriginCoords(defaultOrigen);
        setDestCoords(defaultDestino);
        
        const orig = getOriginCoords();
        const dest = getDestCoords();
        
        originMarker.setLatLng([orig.lat, orig.lng]);
        destMarker.setLatLng([dest.lat, dest.lng]);
        
        // ✅ FORZAR QUE LOS MARCADORES SEAN VISIBLES NUEVAMENTE
        originMarker.setOpacity(1);
        destMarker.setOpacity(1);
        
        // ✅ ASEGURAR QUE SEAN ARRASTRABLES
        if (originMarker.dragging) originMarker.dragging.enable();
        if (destMarker.dragging) destMarker.dragging.enable();
        
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
    
    // ✅ FORZAR ACTUALIZACIÓN DEL MAPA (evita artifacts visuales)
    if (map && typeof map.invalidateSize === 'function') {
        setTimeout(() => map.invalidateSize(), 150);
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
async function guardarPedidoEnSupabase(mostrarWhatsApp = true) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
        // ✅ GENERAR ID ÚNICO (timestamp + random + fecha actual)
        const nuevoId = Date.now() + Math.floor(Math.random() * 10000);
        
        const pedidoAGuardar = {
            ...pedidoPendiente,
            id: nuevoId,  // Usar ID único
            extras: pedidoPendiente.extras || { lluvia: false, noche: false, espera: false }
        };
        
        console.log("📝 Guardando pedido con ID:", nuevoId);
        
        const { error } = await supabase
            .from('pedidos')
            .insert([pedidoAGuardar]);
        
        if (error) {
            // Si hay error por duplicado, reintentar con otro ID
            if (error.code === '23505') {
                console.log("⚠️ ID duplicado, reintentando...");
                const nuevoId2 = Date.now() + Math.floor(Math.random() * 100000);
                pedidoAGuardar.id = nuevoId2;
                const { error: error2 } = await supabase
                    .from('pedidos')
                    .insert([pedidoAGuardar]);
                
                if (error2) throw error2;
                pedidoActual = pedidoAGuardar;
            } else {
                throw error;
            }
        } else {
            pedidoActual = pedidoAGuardar;
        }
        
        // ✅ ACTUALIZAR pedidoPendiente con el ID real
        pedidoPendiente.id = pedidoActual.id;
        
        console.log("✅ Pedido guardado con ID:", pedidoActual.id);
        
        cerrarModalPago();
        cerrarModalEfectivo();
        cerrarModalTransferencia();
        
        mostrarPanelEstado(pedidoActual);
        actualizarTarjetaProgreso();
        
        // ✅ SOLO MOSTRAR MODAL DE WHATSAPP SI ES transferencia (true)
        if (mostrarWhatsApp) {
            mostrarModalWhatsAppOpcion(pedidoActual);
        }
        
        mostrarToast(`✅ ¡Envío solicitado! ID: #${pedidoActual.id}`);
        iniciarSeguimientoDelivery();
        
    } catch(e) {
        console.error('Error creando pedido:', e);
        mostrarToast("❌ Error al crear el pedido: " + (e.message || "Verifica la consola"), true);
    }
}

// ==================== MODAL WHATSAPP OPCIÓN ====================
function mostrarModalWhatsAppOpcion(pedido) {
    if (!pedido) return;
    
    // Crear mensaje
    let mensaje = "✅ *COMPROBANTE DE PAGO - MandaYa*\n\n";
    mensaje += `🎫 *PEDIDO:* #${pedido.id}\n`;
    mensaje += `👤 *CLIENTE:* ${pedido.cliente_nombre || 'Cliente'}\n`;
    mensaje += `📍 *ORIGEN:* ${pedido.origen || 'No especificado'}\n`;
    mensaje += `🏁 *DESTINO:* ${pedido.destino || 'No especificado'}\n`;
    mensaje += `📦 *TIPO:* ${pedido.tipo || 'Paquete'}\n`;
    mensaje += `💰 *TOTAL:* $${pedido.tarifa || '0'} MXN\n`;
    mensaje += `\n✅ *PAGO CONFIRMADO*\n`;
    mensaje += `🚀 *¡Gracias por usar MandaYa!*`;
    
    const mensajeCodificado = encodeURIComponent(mensaje);
    const numero = "5219381083498";
    
    // Crear modal
    const modal = document.createElement('div');
    modal.id = 'modalWhatsappOpcion';
    modal.className = 'fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-[10002] p-4';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl max-w-sm w-full p-6 text-center">
            <div class="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fab fa-whatsapp text-green-500 text-4xl"></i>
            </div>
            <h3 class="text-white text-xl font-bold mb-2">¡Pedido Creado!</h3>
            <p class="text-gray-400 text-sm mb-4">¿Deseas enviar el comprobante por WhatsApp?</p>
            
            <div class="space-y-3">
                <button id="btnEnviarWhatsApp" 
                        class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                    <i class="fab fa-whatsapp text-xl"></i> Enviar comprobante
                </button>
                
                <button id="btnCopiarMensaje" 
                        class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                    <i class="fas fa-copy"></i> Copiar mensaje
                </button>
                
                <button id="btnCerrarWhatsApp" 
                        class="w-full text-gray-400 hover:text-white py-2 text-sm transition-all">
                    Cerrar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Event listeners (en lugar de onclick)
    document.getElementById('btnEnviarWhatsApp').onclick = () => {
        const url = `https://api.whatsapp.com/send?phone=${numero}&text=${mensajeCodificado}`;
        window.open(url, '_blank');
        mostrarToast("📱 Abriendo WhatsApp...");
        modal.remove();
    };
    
    document.getElementById('btnCopiarMensaje').onclick = () => {
        navigator.clipboard.writeText(decodeURIComponent(mensajeCodificado));
        mostrarToast("✅ Mensaje copiado al portapapeles", false);
        modal.remove();
    };
    
    document.getElementById('btnCerrarWhatsApp').onclick = () => {
        modal.remove();
    };
}

// ==================== ENVIAR COMPROBANTE POR WHATSAPP (CORREGIDO) ====================
window.enviarComprobanteWhatsApp = function(pedido = null) {
    const numeroWhatsApp = window.getWhatsAppNumber ? 
        window.getWhatsAppNumber().replace(/[^0-9]/g, '') : "5219381083498";
    
    let mensaje = "✅ *COMPROBANTE DE PAGO - MandaYa*\n\n";
    mensaje += `━━━━━━━━━━━━━━━━━━━━\n`;
    
    if (pedido && pedido.id) {
        mensaje += `🎫 *PEDIDO:* #${pedido.id}\n`;
        mensaje += `👤 *CLIENTE:* ${pedido.cliente_nombre || 'Cliente'}\n`;
        mensaje += `\n━━━━━━━━━━━━━━━━━━━━\n`;
        mensaje += `📍 *ORIGEN:*\n${pedido.origen || 'No especificado'}\n`;
        mensaje += `\n🏁 *DESTINO:*\n${pedido.destino || 'No especificado'}\n`;
        mensaje += `\n━━━━━━━━━━━━━━━━━━━━\n`;
        mensaje += `📦 *TIPO:* ${pedido.tipo || 'Paquete'}\n`;
        mensaje += `📏 *DISTANCIA:* ${pedido.distancia_real || '0'} km\n`;
        
        // Extras si los hay
        if (pedido.extras) {
            const extrasActivos = [];
            if (pedido.extras.lluvia) extrasActivos.push("🌧️ Lluvia");
            if (pedido.extras.noche) extrasActivos.push("🌙 Noche");
            if (pedido.extras.espera) extrasActivos.push("⏱️ Espera");
            if (extrasActivos.length > 0) {
                mensaje += `\n✨ *EXTRAS:* ${extrasActivos.join(", ")}\n`;
            }
        }
        
        mensaje += `\n━━━━━━━━━━━━━━━━━━━━\n`;
        mensaje += `💰 *TOTAL PAGADO:* $${pedido.tarifa || '0'} MXN\n`;
        
    } else {
        mensaje += `🎫 *PEDIDO:* #${Math.floor(Math.random() * 9000) + 1000}\n`;
        mensaje += `💰 *TOTAL:* $0 MXN\n`;
    }
    
    mensaje += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    mensaje += `✅ *PAGO CONFIRMADO*\n`;
    mensaje += `📅 ${new Date().toLocaleString()}\n`;
    mensaje += `\n🚀 *¡Gracias por usar MandaYa!*`;
    
    const mensajeCodificado = encodeURIComponent(mensaje);
    
    // ✅ USAR EL MISMO FORMATO QUE TE FUNCIONA (api.whatsapp.com)
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${numeroWhatsApp}&text=${mensajeCodificado}`;
    
    console.log("📱 Abriendo WhatsApp con URL:", whatsappUrl);
    window.open(whatsappUrl, '_blank');
    
    mostrarToast("📱 Abriendo WhatsApp...");
};

async function confirmarPagoTransferenciaFinal() {
    if (!pedidoPendiente) {
        mostrarToast("❌ No hay información del pedido", true);
        return;
    }
    
    if (window.guardandoPedido) return;
    window.guardandoPedido = true;
    
    mostrarToast("💾 Guardando pedido...");
    
    try {
        // ✅ true = SÍ mostrar modal de WhatsApp
        await guardarPedidoEnSupabase(true);
        cerrarModalTransferencia();
        
    } catch (error) {
        console.error("Error al guardar pedido:", error);
        mostrarToast("❌ Error al guardar el pedido. Intenta de nuevo.", true);
    } finally {
        window.guardandoPedido = false;
    }
}

function cerrarModalPago() {
    const modal = document.getElementById("modalPago");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    // Reactivar botones de solicitud
    const btnDesktop = document.querySelector('button[onclick="solicitarEnvio()"]');
    const btnMobile = document.querySelector('button[onclick="solicitarEnvioMobile()"]');
    if (btnDesktop) btnDesktop.disabled = false;
    if (btnMobile) btnMobile.disabled = false;
}

function cerrarModalEfectivo() {
    const modal = document.getElementById("modalEfectivo");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    // Reactivar botones de solicitud
    const btnDesktop = document.querySelector('button[onclick="solicitarEnvio()"]');
    const btnMobile = document.querySelector('button[onclick="solicitarEnvioMobile()"]');
    if (btnDesktop) btnDesktop.disabled = false;
    if (btnMobile) btnMobile.disabled = false;
}

function cerrarModalTransferencia() {
    const modal = document.getElementById("modalTransferencia");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    // Reactivar botones de solicitud
    const btnDesktop = document.querySelector('button[onclick="solicitarEnvio()"]');
    const btnMobile = document.querySelector('button[onclick="solicitarEnvioMobile()"]');
    if (btnDesktop) btnDesktop.disabled = false;
    if (btnMobile) btnMobile.disabled = false;
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
        // ✅ Verificar si el pedido aún existe
        if (!pedidoActual || !pedidoActual.id) {
            console.warn("⏹️ Pedido actual nulo, deteniendo seguimiento...");
            if (seguimientoInterval) {
                clearInterval(seguimientoInterval);
                seguimientoInterval = null;
            }
            return;
        }

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
                
                // Detener intervalos
                if (seguimientoInterval) {
                    clearInterval(seguimientoInterval);
                    seguimientoInterval = null;
                }
                if (ubicacionInterval) {
                    clearInterval(ubicacionInterval);
                    ubicacionInterval = null;
                }
                
                // Limpiar marcadores y rutas
                if (deliveryMarker) {
                    try { map.removeLayer(deliveryMarker); } catch(e) {}
                    deliveryMarker = null;
                }
                limpiarRutaCliente();
                
                // Ocultar paneles de estado
                const panel = document.getElementById("panelEstadoPedido");
                const panelMobile = document.getElementById("panelEstadoPedidoMobile");
                if (panel) panel.classList.add("hidden");
                if (panelMobile) panelMobile.classList.add("hidden");
                
                // Ocultar botón centrar delivery e info
                mostrarBotonCentrarDelivery(false);
                ocultarDeliveryInfo();
                
                // Resetear variables de control de rutas
                rutaYaDibujada = false;
                ultimoEstadoPedido = null;
                rutaDestinoActual = null;
                
                // Reactivar UI
                bloquearUIporPedidoActivo(false);
                
                // ✅ FORZAR ACTUALIZACIÓN DE LA TARJETA DE PROGRESO A "ENTREGADO"
                actualizarTarjetaProgreso();
                
                // Recargar deliverys
                cargarDeliverysEnLinea();
                mostrarToast("🎉 ¡Envío completado! Gracias por usar MandaYa");
                
                return; // Salir del intervalo
            }
                        
            // ========== 2. ACTUALIZAR PANEL DE ESTADO ==========
            if (pedidoActualizado.estado === 'asignado' && pedidoActualizado.delivery_nombre) {
                actualizarEstadoPanel('asignado', pedidoActualizado.delivery_nombre);
            } 
            else if (pedidoActualizado.estado === 'recogido' && pedidoActualizado.delivery_nombre) {
                actualizarEstadoPanel('recogido', pedidoActualizado.delivery_nombre);
                if (estadoAnterior === 'asignado') {
                    mostrarToast(`📦 ¡El delivery ${pedidoActualizado.delivery_nombre} ya recogió tu paquete!`);
                    vibrar(200);
                }
            } 
            else if (pedidoActualizado.estado === 'pendiente') {
                actualizarEstadoPanel('pendiente');
            }
            
            // ========== 3. INICIAR SEGUIMIENTO DE UBICACIÓN ==========
            const estadoActivo = (pedidoActualizado.estado === 'asignado' || pedidoActualizado.estado === 'recogido');
            if (estadoActivo && pedidoActualizado.delivery_id && !ubicacionInterval) {
                mostrarToast(`✅ Delivery asignado: ${pedidoActualizado.delivery_nombre || 'Delivery'}`);
                mostrarDeliveryEnMapa(pedidoActualizado.delivery_id, pedidoActualizado.delivery_nombre);
                seguirUbicacionDelivery(pedidoActualizado.delivery_id);
            }
            
        } catch(e) {
            console.error('❌ Error en seguimiento:', e);
        }
    }, 3000);
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
            
            // ✅ NUEVO: AUTO-FOLLOW DEL DELIVERY (cliente puede activar/desactivar)
            if (typeof autoFollowDelivery !== 'undefined' && autoFollowDelivery) {
                const zoom = typeof followZoomLevel !== 'undefined' ? followZoomLevel : 16;
                map.setView([ubicacion.lat, ubicacion.lng], zoom);
                console.log("📍 Auto-follow: centrando en delivery");
            }
            
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

            // Dentro de seguirUbicacionDelivery, después de calcular distanciaActual:
            actualizarTarjetaProgreso(distanciaActual, tipoRuta, destinoFinalNombre);
            
            // ✅ 9. Determinar si necesita recálculo (mejorado)
            const estadoActual = pedidoActual?.estado;
            const tiempoAhora = Date.now();
            const tiempoDesdeUltimoRecalculo = tiempoAhora - ultimoRecalculoTime;
            const distanciaCambioSignificativo = ultimaDistanciaRecalculo !== 0 && 
                Math.abs(distanciaActual - ultimaDistanciaRecalculo) > 0.2; // 200 метров
            
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
                        deliveryMarker.bindPopup(`<b>🏍️ ${sanitizarHTML(deliveryNombre)}</b><br>🟠 En camino a recoger tu paquete<br>📍 ${sanitizarHTML(destinoFinalNombre)}`);
                    } else {
                        deliveryMarker.bindPopup(`<b>🏍️ ${sanitizarHTML(deliveryNombre)}</b><br>📦 En camino a entregar tu paquete<br>📍 ${sanitizarHTML(destinoFinalNombre)}`);
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
                
                // ✅ ACTUALIZAR pedidoActual con el estado completado ANTES de llamar a actualizarTarjetaProgreso
                pedidoActual.estado = 'completado';
                
                // ✅ FORZAR ACTUALIZACIÓN DE LA TARJETA DE PROGRESO (esto mostrará confeti y botón calificar)
                actualizarTarjetaProgreso();
                
                // ✅ LANZAR CONFETI DIRECTAMENTE POR SI ACASO
                if (!window.confetiLanzado) {
                    window.confetiLanzado = true;
                    lanzarConfeti();
                }
                
                // ✅ MOSTRAR BOTÓN CALIFICAR DIRECTAMENTE
                const calificarContainer = document.getElementById("calificarContainer");
                if (calificarContainer) {
                    calificarContainer.classList.remove("hidden");
                }
                
                // REACTIVAR UI
                bloquearUIporPedidoActivo(false);
                
                // Recargar deliverys (ahora mostrará todos nuevamente)
                cargarDeliverysEnLinea();
                
                mostrarToast("🎉 ¡Envío completado! Gracias por usar MandaYa");
                
                // Limpiar pedido actual después de un tiempo (para que el confeti se vea)
                setTimeout(() => {
                    pedidoActual = null;
                    window.confetiLanzado = false;
                }, 5000);
            }
        }
    }, 3000);
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

function ocultarDeliveryInfo() {
    document.getElementById("deliveryInfo").classList.add("hidden");
    if (deliveryMarker) map.removeLayer(deliveryMarker);
}

function mostrarTarjetaProgreso() {
    const card = document.getElementById('progressCard');
    if (card) card.classList.remove('hidden');
}

function ocultarTarjetaProgreso() {
    const card = document.getElementById('progressCard');
    if (card) card.classList.add('hidden');
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
                        <div class="bg-gray-700 rounded-xl p-4 ${sanitizarHTML(p.estado === 'completado' ? 'border-l-4 border-green-500' : p.estado === 'pendiente' ? 'border-l-4 border-yellow-500' : 'border-l-4 border-blue-500')}">
                            <div class="flex justify-between items-start mb-2">
                                <div>
                                    <span class="font-bold text-orange-400">#${p.id}</span>
                                    <span class="text-xs ml-2 px-2 py-0.5 rounded-full ${sanitizarHTML(p.estado === 'completado' ? 'bg-green-500/20 text-green-400' : p.estado === 'pendiente' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400')}">
                                        ${sanitizarHTML(p.estado === 'completado' ? '✅ Completado' : p.estado === 'pendiente' ? '⏳ Pendiente' : '🚚 En camino')}
                                    </span>
                                </div>
                                <span class="text-xs text-gray-400">${new Date(p.fecha).toLocaleDateString()}</span>
                            </div>
                           <p class="text-sm text-gray-300">
                                <i class="fas fa-circle text-orange-500 text-xs mr-1"></i> ${sanitizarHTML(p.origen)}
                           </p>
                           <p class="text-sm text-gray-300 mt-1">
                                 <i class="fas fa-square text-blue-500 text-xs mr-1"></i> ${sanitizarHTML(p.destino)}
                           </p>
                            <div class="flex justify-between items-center mt-3 pt-2 border-t border-gray-600">
                                <div class="text-sm">
                                    <span class="text-gray-400">📏 ${sanitizarHTML(p.distancia_real)} km</span>
                                    <span class="text-gray-400 ml-3">💰 $${sanitizarHTML(p.tarifa)}</span>
                                </div>
                                <button onclick="eliminarEnvio(${sanitizarHTML(p.id)})" class="bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white px-3 py-1 rounded-lg text-sm transition-all">
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
    
    // ✅ 1. CERRAR MODAL DE HISTORIAL PRIMERO
    const modalHistorial = document.getElementById("modalHistorial");
    if (modalHistorial) {
        modalHistorial.remove();
    }
    
    // ✅ 2. Limpiar cualquier modal de confirmación existente
    const modalConfirmExistente = document.getElementById("modalConfirmacionEliminar");
    if (modalConfirmExistente) modalConfirmExistente.remove();
    
    // ✅ 3. Obtener datos del pedido
    const { data: pedido, error: pedidoError } = await supabase
        .from('pedidos')
        .select('*')
        .eq('id', pedidoId)
        .single();
    
    if (pedidoError || !pedido) {
        mostrarToast("Envío no encontrado", true);
        return;
    }
    
    // ✅ 4. Mensaje según estado
    let mensaje = "";
    if (pedido.estado === 'completado') {
        mensaje = "Este envío ya está completado. ¿Seguro que quieres eliminarlo del historial?";
    } else if (pedido.estado === 'asignado' || pedido.estado === 'recogido') {
        mensaje = "⚠️ Este envío está en camino. Si lo eliminas, el delivery ya no lo verá. ¿Estás seguro?";
    } else {
        mensaje = "¿Estás seguro de que quieres eliminar este envío? Esta acción no se puede deshacer.";
    }
    
    // ✅ 5. Crear modal de confirmación con z-index ALTÍSIMO
    const modalConfirm = document.createElement('div');
    modalConfirm.id = "modalConfirmacionEliminar";
    modalConfirm.className = "fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-[100000] p-4";
    modalConfirm.style.zIndex = "100000";
    
    modalConfirm.innerHTML = `
        <div class="bg-gray-800 rounded-3xl max-w-sm w-full text-center p-6 modal-uber" style="z-index: 100001;">
            <div class="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-trash-alt text-3xl text-red-500"></i>
            </div>
            <p class="text-gray-200 text-sm mb-6">${sanitizarHTML(mensaje)}</p>
            <div class="flex gap-3">
                <button id="btnCancelarEliminar" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl transition-all font-medium">
                    Cancelar
                </button>
                <button id="btnConfirmarEliminar" class="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl transition-all font-medium">
                    <i class="fas fa-trash-alt mr-2"></i> Eliminar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modalConfirm);
    
    // ✅ 6. Evento para confirmar eliminación
    document.getElementById("btnConfirmarEliminar").onclick = async () => {
        modalConfirm.remove();
        
        try {
            const { error } = await supabase
                .from('pedidos')
                .delete()
                .eq('id', pedidoId);
            
            if (error) throw error;
            
            mostrarToast(`🗑️ Envío #${pedidoId} eliminado correctamente`);
            
            // ✅ 7. Volver a abrir historial actualizado
            setTimeout(() => {
                mostrarHistorialCompleto();
            }, 300);
            
        } catch(e) {
            console.error('Error eliminando:', e);
            mostrarToast("Error al eliminar el envío", true);
            setTimeout(() => {
                mostrarHistorialCompleto();
            }, 500);
        }
    };
    
    // ✅ 8. Evento para cancelar
    document.getElementById("btnCancelarEliminar").onclick = () => {
        modalConfirm.remove();
        // Reabrir historial si canceló
        setTimeout(() => {
            mostrarHistorialCompleto();
        }, 100);
    };
    
    // ✅ 9. Cerrar si se hace clic fuera
    modalConfirm.addEventListener('click', (e) => {
        if (e.target === modalConfirm) {
            modalConfirm.remove();
            setTimeout(() => {
                mostrarHistorialCompleto();
            }, 100);
        }
    });
}

// Modal de confirmación unificado (usando shared.js)
async function mostrarModalConfirmacion(titulo, mensaje, onConfirm) {
    // Usar la función unificada de shared.js
    const confirmado = await confirmarConModal(mensaje, onConfirm, null, titulo);
    return confirmado;
}

function cerrarModalConfirmacion() {
    cerrarTodosLosModales();
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
                        <div class="text-white font-medium">${sanitizarHTML(currentUser?.nombre || 'No disponible')}</div>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-envelope text-orange-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Correo electrónico</div>
                        <div class="text-white font-medium">${sanitizarHTML(currentUser?.email || 'No disponible')}</div>
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
            document.getElementById("deliveryNombre").innerHTML = `<i class="fas fa-motorcycle"></i> ${sanitizarHTML(nombreDelivery)}`;
            
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
                    <span class="text-white font-bold text-sm">${sanitizarHTML(distancia)} km</span>
                </div>
                <div class="bg-gray-700 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-gray-400 text-xs">⏱️ Tiempo estimado</span>
                    <span class="text-white font-bold text-sm">${sanitizarHTML(tiempo)}</span>
                </div>
                <div class="bg-gray-700 rounded-lg p-2 flex justify-between items-center">
                    <span class="text-gray-400 text-xs">📦 Tipo de envío</span>
                    <span class="text-white font-bold text-sm capitalize">${sanitizarHTML(tipo)}</span>
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
                            <div id="checkLluviaResumen" class="mt-1 w-4 h-4 rounded-full border-2 ${sanitizarHTML(extrasGuardados.lluvia ? 'bg-orange-500 border-orange-500' : 'border-gray-400')} flex items-center justify-center">
                                ${sanitizarHTML(extrasGuardados.lluvia ? '<i class="fas fa-check text-white text-[8px]"></i>' : '')}
                            </div>
                        </div>
                        
                        <!-- Noche -->
                        <div class="flex flex-col items-center bg-gray-600 rounded-lg p-2 w-16 cursor-pointer hover:bg-gray-500 transition-all" 
                             onclick="toggleExtraEnResumen('noche')">
                            <i class="fas fa-moon text-yellow-400 text-lg mb-0.5"></i>
                            <span class="text-white text-xs">Noche</span>
                            <span class="text-orange-400 text-xs">+$10</span>
                            <div id="checkNocheResumen" class="mt-1 w-4 h-4 rounded-full border-2 ${sanitizarHTML(extrasGuardados.noche ? 'bg-orange-500 border-orange-500' : 'border-gray-400')} flex items-center justify-center">
                                ${sanitizarHTML(extrasGuardados.noche ? '<i class="fas fa-check text-white text-[8px]"></i>' : '')}
                            </div>
                        </div>
                        
                        <!-- Espera -->
                        <div class="flex flex-col items-center bg-gray-600 rounded-lg p-2 w-16 cursor-pointer hover:bg-gray-500 transition-all" 
                             onclick="toggleExtraEnResumen('espera')">
                            <i class="fas fa-clock text-purple-400 text-lg mb-0.5"></i>
                            <span class="text-white text-xs">Espera</span>
                            <span class="text-orange-400 text-xs">+$10</span>
                            <div id="checkEsperaResumen" class="mt-1 w-4 h-4 rounded-full border-2 ${sanitizarHTML(extrasGuardados.espera ? 'bg-orange-500 border-orange-500' : 'border-gray-400')} flex items-center justify-center">
                                ${sanitizarHTML(extrasGuardados.espera ? '<i class="fas fa-check text-white text-[8px]"></i>' : '')}
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
        
      sugerenciasDiv.innerHTML = data.map(lugar => {
          const nombreSanitizado = window.sanitizarHTML(lugar.display_name.split(',')[0]);
          const direccionSanitizada = window.sanitizarHTML(
              lugar.display_name.split(',').slice(1, 3).join(',')
          );
          const direccionCompletaSanitizada = window.sanitizarHTML(lugar.display_name);
          return `
              <div class="sugerencia-item p-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 flex items-start gap-2" 
                   onclick="seleccionarDireccion('${tipo}', ${lugar.lat}, ${lugar.lon}, '${direccionCompletaSanitizada.replace(/'/g, "\\'")}')">
                  <i class="fas fa-map-marker-alt text-gray-400 mt-0.5 text-xs"></i>
                  <div class="flex-1">
                      <div class="text-sm font-medium text-gray-800">${nombreSanitizado}</div>
                      <div class="text-xs text-gray-500">${direccionSanitizada}</div>
                  </div>
              </div>
          `;
      }).join('');
              
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
    actualizarRutaYTarifaDebounced();
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
                <b>🏍️ ${sanitizarHTML(delivery.delivery_nombre)}</b><br>
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

// ==================== AUTO-FOLLOW DEL DELIVERY ====================
function toggleAutoFollowDelivery() {
    autoFollowDelivery = !autoFollowDelivery;
    const btn = document.getElementById("btnAutoFollowDelivery");
    
    if (autoFollowDelivery) {
        mostrarToast("🚗 Seguimiento del delivery ACTIVADO - El mapa seguirá al repartidor", false);
        if (btn) {
            btn.classList.add("active");
            btn.style.background = "#FF6200";
            const icon = btn.querySelector("i");
            if (icon) icon.style.color = "white";
        }
        // Centrar inmediatamente si hay delivery
        if (deliveryMarker) {
            const latLng = deliveryMarker.getLatLng();
            map.setView([latLng.lat, latLng.lng], followZoomLevel);
        }
    } else {
        mostrarToast("📍 Seguimiento DESACTIVADO - Puedes mover el mapa libremente", false);
        if (btn) {
            btn.classList.remove("active");
            btn.style.background = "white";
            const icon = btn.querySelector("i");
            if (icon) icon.style.color = "#FF6200";
        }
    }
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

 //Evento cuando la página se está cerrando (pestaña cerrada, navegador cerrado, refresh)
window.addEventListener('beforeunload', function() {
 console.log("🚪 Pestaña cerrando - Limpiando recursos...");
   limpiarTodosLosIntervalos();
});

 //Evento cuando la página se descarga completamente (último recurso)
window.addEventListener('pagehide', function() {
console.log("💀 Página descargada - Recursos liberados");
  if (currentUser && currentUser.rol === 'cliente' && supabaseClient) {
   console.log("👋 Cliente desconectado");
  }
});

// Detectar cuando la pestaña está visible
document.addEventListener('visibilitychange', () => {
    paginaVisible = !document.hidden;
    if (paginaVisible) {
        console.log("🟢 Página visible - Reactivando actualizaciones");
        // ✅ CORREGIDO: cliente.js NO tiene cargarPedidos()
        if (typeof cargarDeliverysEnLinea === 'function') cargarDeliverysEnLinea();
        if (typeof cargarPedidoActivoDesdeDB === 'function') cargarPedidoActivoDesdeDB();
    } else {
        console.log("🔴 Página oculta - Reduciendo actualizaciones");
    }
});

// ==================== EXPORTAR FUNCIONES GLOBALMENTE ====================
window.verHistorial = verHistorial;
window.mostrarResumenRuta = mostrarResumenRuta;
window.centrarMapa = centrarMapa;
window.setSelectMode = setSelectMode;
window.centrarEnDelivery = centrarEnDelivery;
window.verRutaCompleta = verRutaCompleta;
window.rotateMapLeft = rotateMapLeft;
window.rotateMapRight = rotateMapRight;
window.resetMapRotation = resetMapRotation;
window.solicitarEnvio = solicitarEnvio;
window.seleccionarPago = seleccionarPago;
window.calcularCambio = calcularCambio;
window.confirmarPagoEfectivo = confirmarPagoEfectivo;
window.cerrarModalPago = cerrarModalPago;
window.cerrarModalEfectivo = cerrarModalEfectivo;
window.cerrarModalTransferencia = cerrarModalTransferencia;
window.copiarDatosBancarios = copiarDatosBancarios;
window.calcularETA = calcularETA;
window.mostrarTarjetaProgreso = mostrarTarjetaProgreso;
window.ocultarTarjetaProgreso = ocultarTarjetaProgreso;
window.verPerfil = verPerfil;
window.cancelarPedido = cancelarPedido;
window.calificarServicio = calificarServicio;
window.toggleExtraEnResumen = toggleExtraEnResumen;
window.confirmarExtrasDesdeResumen = confirmarExtrasDesdeResumen;
window.cerrarModalResumen = cerrarModalResumen;
window.cerrarSesion = cerrarSesion;
window.cerrarModalHistorial = cerrarModalHistorial;
window.eliminarEnvio = eliminarEnvio;
// ✅ MODALES ACTUALIZADOS
window.mostrarModalConfirmacion = mostrarModalConfirmacion;
window.cerrarModalConfirmacion = cerrarModalConfirmacion;
window.limpiarTodosLosIntervalos = limpiarTodosLosIntervalos;
window.confirmarPagoTransferenciaFinal = confirmarPagoTransferenciaFinal;
window.enviarComprobanteWhatsApp = enviarComprobanteWhatsApp;  // ← AGREGAR ESTA LÍNEA
window.toggleAutoFollowDelivery = toggleAutoFollowDelivery;

console.log("✅ Cliente inicializado - Sistema de modales unificado activo");
