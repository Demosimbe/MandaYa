// Registrar Service Worker (al inicio del archivo)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(reg => console.log('✅ Service Worker registrado', reg))
        .catch(err => console.log('❌ Service Worker error:', err));
}

// delivery.js - Al principio
import './shared.js';
import './security.js';
import './config.js';
import './map-utils.js'; 

// ==================== PRECARGAR SONIDO DE NOTIFICACIÓN ====================
const audioNotificacion = new Audio('/sounds/notification.mp3');
audioNotificacion.load(); // Precargar el sonido

// Constantes y variables globales
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

let map, userMarker, routeLine;
let currentUser = null, isOnline = false;
let pedidosDisponibles = [], misPedidosActivos = [];
let pedidoSeleccionado = null;
let watchId = null;
let ubicacionInterval = null;
let cargaPedidosInterval = null;
let ultimaUbicacionEnviada = null;
let intervaloActualizacionRuta = null;  // Intervalo para actualizar ruta en tiempo real
let ultimoRecalculoRuta = 0; 
let audioContextInicializado = false;
let sonidoUrgente = null;
let modalUrgenteActivo = false;
let timeoutPedidoUrgente = null;

// ✅ NUEVAS VARIABLES PARA BACKUP Y AUTO-FOLLOW
let backupIntervalId = null;      // Intervalo de respaldo para pantalla bloqueada
let autoFollow = true;            // Seguir la moto automáticamente
let zoomDinamico = true;          // Zoom dinámico al seguir
let ultimoTimestampUbicacion = 0; // Para throttle

// Variables para rutas
let currentRoutingControl = null;
let recogidaMarker = null;
let destinoMarker = null;
let ultimoPedidoDibujado = null;
let ultimaEtapa = null;
let dibujandoRuta = false;
let ultimaPeticionPedidos = 0;
let velocidadAnimacionVariable = true;

// ==================== SMOOTH TRACKING (TIPO UBER) ====================
let smoothAnimationFrame = null;
let posicionActual = null;        // Posición actual interpolada
let posicionDestino = null;       // Posición destino (real del GPS)
let velocidadAnimacion = 0.15;    // Velocidad de interpolación (0-1, más bajo = más suave)
let ultimoAngulo = 0;              // Último ángulo para rotación suave
let anguloActual = 0;              // Ángulo actual (para interpolación)

// Control de página visible
let paginaVisible = true;
// ==================== ROTACIÓN DEL MAPA ====================
let mapRotationAngle = 0;   // ← Mover aquí arriba

// ==================== UTILIDADES ====================
function vibrar(duracion = 200) {
    if (window.navigator.vibrate) {
        window.navigator.vibrate(duracion);
    }
}

// ==================== NOTIFICACIÓN DE NUEVO PEDIDO ====================
function notificarNuevoPedido() {
    // Vibrar
    if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate([300, 100, 300, 100, 300]);
        console.log("📳 Vibración activada");
    }
    
    // Sonido con Web Audio API - Dos tonos (ding-dong)
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        // Primer tono (agudo - "ding") - más largo
        const osc1 = audioContext.createOscillator();
        const gain1 = audioContext.createGain();
        osc1.connect(gain1);
        gain1.connect(audioContext.destination);
        osc1.frequency.value = 880;
        gain1.gain.value = 0.8; // Volumen más alto
        
        // Segundo tono (grave - "dong") - más largo
        const osc2 = audioContext.createOscillator();
        const gain2 = audioContext.createGain();
        osc2.connect(gain2);
        gain2.connect(audioContext.destination);
        osc2.frequency.value = 660;
        gain2.gain.value = 0.8; // Volumen más alto
        
        osc1.start();
        gain1.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5); // 0.5 segundos
        osc1.stop(audioContext.currentTime + 0.5);
        
        setTimeout(() => {
            osc2.start();
            gain2.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5);
            osc2.stop(audioContext.currentTime + 0.5);
        }, 250); // Mayor separación entre tonos
        
        setTimeout(() => {
            audioContext.close();
        }, 1500);
        
        console.log("🔔🔔 Sonido de notificación (ding-dong) reproducido");
    } catch(e) {
        console.log("Error con Web Audio API:", e);
    }
}

document.addEventListener('visibilitychange', () => {
    paginaVisible = !document.hidden;
    if (paginaVisible) {
        console.log("🟢 Página visible - Reactivando actualizaciones");
        if (isOnline) cargarPedidos();
    } else {
        console.log("🔴 Página oculta - Reduciendo actualizaciones");
    }
});

// ==================== INICIALIZACIÓN PRINCIPAL ====================
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 Inicializando delivery...");
    
    // Verificar sesión antes de cualquier cosa
    const sesionValida = await verificarYProtegerSesion();
    if (!sesionValida) return;
    
    // Cargar usuario seguro
    loadUser();
    
    // Inicializar mapa
    initMap();
    
    // Actualizar estadísticas después de un momento
    setTimeout(() => actualizarEstadisticas(), 1000);
    
    // Si está online, iniciar localización y cargar pedidos
    if (isOnline) {
        setTimeout(() => {
            startLocationTracking();
            cargarPedidos(true);
        }, 500);
    }
});

// ==================== FUNCIÓN LOAD USER (SOLO UNA VEZ) ====================
function loadUser() {
    const usuario = securityManager.obtenerUsuarioActual();
    if (!usuario) { 
        window.location.href = "index.html"; 
        return; 
    }
    
    currentUser = usuario;
    
    if (currentUser.rol !== 'delivery') { 
        window.location.href = "cliente.html"; 
        return; 
    }
    
    isOnline = currentUser.online === true;
    
    document.getElementById("userInfo").innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-motorcycle text-[#FF6200] text-xl"></i>
            <span class="font-medium">${sanitizarHTML(currentUser.nombre)}</span>
            <span class="text-gray-400 text-xs">(Delivery)</span>
        </div>
        <div class="text-xs text-gray-500 mt-1">
            <i class="fas fa-star text-yellow-500"></i> Calificación: 4.9
        </div>
        <div id="estadoDeliveryBadge" class="mt-2 text-xs"></div>
    `;
    
    if(isOnline) {
        document.getElementById("onlineToggle").classList.remove("bg-gray-500");
        document.getElementById("onlineToggle").classList.add("bg-green-500");
        document.getElementById("onlineStatusText").innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
    }
}

function mostrarModalNuevoPedidoUrgente(pedido) {
    // Evitar múltiples modales
    if (modalUrgenteActivo) return;
    modalUrgenteActivo = true;
    
    // Limpiar modal existente
    const modalExistente = document.getElementById('urgentModal');
    if (modalExistente) modalExistente.remove();
    
    // Crear modal
    const modal = document.createElement('div');
    modal.id = 'urgentModal';
    modal.className = 'urgent-modal-overlay';
    modal.innerHTML = `
        <div class="urgent-modal-card">
            <div class="urgent-pulse">
                <i class="fas fa-motorcycle text-white text-6xl mb-3"></i>
            </div>
            <h2 class="text-white text-2xl font-bold mb-1">🔥 ¡NUEVO PEDIDO!</h2>
            <p class="text-white/80 text-sm mb-3">Tienes <span id="countdownSegundos" class="font-bold text-xl">20</span> segundos para aceptar</p>
            
            <div class="bg-white/20 rounded-xl p-3 mb-4 text-left">
                <div class="flex justify-between mb-2">
                    <span class="text-white/80 text-xs">CLIENTE</span>
                    <span class="text-white font-bold text-sm">${sanitizarHTML(pedido.clienteNombre || 'Cliente')}</span>
                </div>
                <div class="flex justify-between mb-2">
                    <span class="text-white/80 text-xs">DISTANCIA</span>
                    <span class="text-white font-bold text-sm">${pedido.distanciaReal || '0'} km</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-white/80 text-xs">PAGO</span>
                    <span class="text-white font-bold text-sm">$${pedido.tarifa || '0'} MXN</span>
                </div>
                <div class="h-px bg-white/30 my-2"></div>
                <div class="flex items-start gap-2">
                    <i class="fas fa-circle text-[10px] text-white mt-1"></i>
                    <span class="text-white text-xs flex-1">${sanitizarHTML(pedido.origen || 'Origen no especificado')}</span>
                </div>
                <div class="flex items-start gap-2 mt-2">
                    <i class="fas fa-square text-[10px] text-white mt-1"></i>
                    <span class="text-white text-xs flex-1">${sanitizarHTML(pedido.destino || 'Destino no especificado')}</span>
                </div>
            </div>
            
            <div id="cuentaRegresiva" class="countdown-timer text-white">20</div>
            
            <button id="btnAceptarUrgente" class="btn-aceptar-urgente">
                <i class="fas fa-hand-paper mr-2"></i> ACEPTAR PEDIDO
            </button>
            
            <button id="btnRechazarUrgente" class="text-white/70 text-sm mt-3 w-full py-2">
                Rechazar
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Reproducir sonido fuerte
    reproducirSonidoUrgente();
    
    // Iniciar cuenta regresiva de 20 segundos
    let segundos = 20;
    const countdownElement = document.getElementById('cuentaRegresiva');
    const segundosElement = document.getElementById('countdownSegundos');
    
    const intervaloCuenta = setInterval(() => {
        segundos--;
        if (countdownElement) countdownElement.innerText = segundos;
        if (segundosElement) segundosElement.innerText = segundos;
        
        if (segundos <= 0) {
            clearInterval(intervaloCuenta);
            cerrarModalUrgente();
            mostrarToast("⏰ Tiempo agotado. El pedido pasará a otro delivery.", true);
            modalUrgenteActivo = false;
        }
    }, 1000);
    
    // Evento: Aceptar pedido
    document.getElementById('btnAceptarUrgente').onclick = async () => {
        clearInterval(intervaloCuenta);
        cerrarModalUrgente();
        modalUrgenteActivo = false;
        
        // Llamar a la función existente agarrarPedido
        await agarrarPedido(pedido.id);
    };
    
    // Evento: Rechazar pedido
    document.getElementById('btnRechazarUrgente').onclick = () => {
        clearInterval(intervaloCuenta);
        cerrarModalUrgente();
        modalUrgenteActivo = false;
        mostrarToast("❌ Pedido rechazado", false);
    };
    
    // Guardar timeout por si acaso
    if (timeoutPedidoUrgente) clearTimeout(timeoutPedidoUrgente);
    timeoutPedidoUrgente = setTimeout(() => {
        if (modalUrgenteActivo) {
            cerrarModalUrgente();
            modalUrgenteActivo = false;
        }
    }, 20000);
}

function cerrarModalUrgente() {
    const modal = document.getElementById('urgentModal');
    if (modal) modal.remove();
    if (timeoutPedidoUrgente) clearTimeout(timeoutPedidoUrgente);
}

// ==================== CÁLCULO DE ÁNGULO PARA ROTACIÓN ====================
function calcularAnguloEntrePuntos(puntoA, puntoB) {
    const deltaX = puntoB.lng - puntoA.lng;
    const deltaY = puntoB.lat - puntoA.lat;
    let angulo = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    // Ajustar para que 0° sea hacia arriba (norte)
    angulo = (angulo + 90) % 360;
    return angulo;
}

// Interpolación de ángulos (evita saltos bruscos entre 359° y 1°)
function interpolarAngulo(anguloActual, anguloDestino, velocidad) {
    let diff = anguloDestino - anguloActual;
    // Normalizar a [-180, 180]
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    const nuevoAngulo = anguloActual + diff * velocidad;
    // Normalizar a [0, 360]
    return ((nuevoAngulo % 360) + 360) % 360;
}

// ==================== ANIMACIÓN SMOOTH DEL MARCADOR ====================
function iniciarAnimacionSmooth() {
    if (smoothAnimationFrame) {
        cancelAnimationFrame(smoothAnimationFrame);
        smoothAnimationFrame = null;
    }
    
    function animar() {
        if (userMarker && posicionActual && posicionDestino) {
            // Interpolar posición
            const distanciaX = (posicionDestino.lng - posicionActual.lng) * velocidadAnimacion;
            const distanciaY = (posicionDestino.lat - posicionActual.lat) * velocidadAnimacion;
            
            // Si está muy cerca, ir directamente al destino
            const distanciaTotal = Math.hypot(posicionDestino.lng - posicionActual.lng, posicionDestino.lat - posicionActual.lat);
            
            if (distanciaTotal < 0.00001) {
                // Ya llegó
                posicionActual = { ...posicionDestino };
            } else {
                // Mover suavemente
                posicionActual.lng += distanciaX;
                posicionActual.lat += distanciaY;
            }
            
            // Actualizar marcador en el mapa
            userMarker.setLatLng([posicionActual.lat, posicionActual.lng]);
            
            // Calcular y aplicar rotación si tiene movimiento
            if (distanciaTotal > 0.00001 && posicionDestino) {
                const anguloDestino = calcularAnguloEntrePuntos(posicionActual, posicionDestino);
                anguloActual = interpolarAngulo(anguloActual, anguloDestino, 0.2);
                if (typeof userMarker.setRotationAngle === 'function') {
                    userMarker.setRotationAngle(anguloActual);
                }
            }
        }
        
        smoothAnimationFrame = requestAnimationFrame(animar);
    }
    
    animar();
    console.log("🏍️ Animación smooth iniciada");
}

// ==================== INICIALIZACIÓN DEL MAPA ====================
function initMap() {
    const cdDelCarmen = { lat: 18.6456, lng: -91.8249 };
    
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
    }).setView([cdDelCarmen.lat, cdDelCarmen.lng], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
    
    limitarMapaACarmen(map);
    
    if (cargaPedidosInterval) clearInterval(cargaPedidosInterval);
    cargaPedidosInterval = setInterval(() => { 
        if (isOnline) cargarPedidos(); 
    }, 5000);

    // ==================== ROTACIÓN ====================
    map.on('rotate', function() {
        const transform = map.getContainer().style.transform || '';
        const match = transform.match(/rotate\(([-0-9.]+)deg\)/);
        if (match) {
            mapRotationAngle = parseFloat(match[1]);
        }
        actualizarRotacionMarcadores();
    });

    // Rotación inicial
    map.getContainer().style.transform = 'rotate(0deg)';
    mapRotationAngle = 0;

    console.log("🗺️ Mapa de Delivery inicializado con rotación activada");
}

// ==================== CIERRE DE SESIÓN CORREGIDO ====================
function cerrarSesion() {
    console.log("🔐 Mostrando modal de confirmación para delivery...");
    
    // Usar el modal directamente con callbacks
    mostrarModalConfirmacionDelivery(
        "Cerrar Sesión",
        "¿Estás seguro de que deseas cerrar sesión?",
        async () => {
            console.log("✅ Usuario confirmó cierre de sesión, procediendo...");
            
            try {
                // Usar la función centralizada de limpieza
                limpiarIntervalosDelivery();

                // Actualizar estado offline en Supabase
                if (currentUser && supabaseClient) {
                    await setDeliveryOnlineSupabase(currentUser.id, false)
                        .catch(err => console.warn("No se pudo actualizar offline:", err));
                }

                // Cerrar sesión con securityManager
                await securityManager.cerrarSesion();

            } catch (error) {
                console.error("❌ Error durante el cierre de sesión:", error);
                try {
                    await securityManager.cerrarSesion();
                } catch (e) {
                    window.location.href = "index.html";
                }
            }
        },
        () => {
            console.log("❌ Usuario canceló cierre de sesión");
        }
    );
}

async function actualizarBadgeEstado() {
    if (!currentUser) return;
    if (!paginaVisible) return; // ✅ No actualizar si página oculta
    
    const tienePedido = await deliveryTienePedidoActivo(currentUser.id);
    const badge = document.getElementById("estadoDeliveryBadge");
    
    if (badge) {
        if (tienePedido) {
            badge.innerHTML = '<span class="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full"><i class="fas fa-motorcycle mr-1"></i> Ocupado - En entrega</span>';
        } else {
            badge.innerHTML = '<span class="bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full"><i class="fas fa-check-circle mr-1"></i> Disponible para entregas</span>';
        }
    }
}

// ==================== LIMPIAR RUTAS Y MARCADORES ====================
function limpiarRutasYMarcadores() {
    // Limpiar Routing Control de forma segura
    if (currentRoutingControl) {
        try {
            if (currentRoutingControl._map) {
                map.removeControl(currentRoutingControl);
            } else if (currentRoutingControl.getPlan) {
                currentRoutingControl.getPlan().setWaypoints([]);
            }
        } catch (e) {
            console.warn("Error limpiando routing control:", e.message);
        }
        currentRoutingControl = null;
    }

    // Limpiar marcadores
    [recogidaMarker, destinoMarker].forEach(marker => {
        if (marker) {
            try { map.removeLayer(marker); } catch(e) {}
        }
    });

    recogidaMarker = null;
    destinoMarker = null;

    console.log("🧹 Rutas y marcadores limpiados");
}

async function dibujarRutaRecogida(pedido) {
    // ✅ Evitar redibujar si ya estamos en la misma ruta
    if (ultimoPedidoDibujado === pedido.id && ultimaEtapa === 'recogida') {
        console.log("🟢 Ruta de recogida ya activa, omitiendo redibujo");
        return;
    }
    
    if (dibujandoRuta) {
        console.log("⏳ Ya dibujando una ruta, espera...");
        return;
    }
    
    dibujandoRuta = true;
    limpiarRutasYMarcadores();
    ultimoPedidoDibujado = pedido.id;
    ultimaEtapa = 'recogida';
    
    if (!pedido.origenCoords) {
        mostrarToast("❌ No hay coordenadas de origen", true);
        dibujandoRuta = false;
        return;
    }
    
    let ubicacionActual = null;
    if (userMarker) {
        const latLng = userMarker.getLatLng();
        ubicacionActual = { lat: latLng.lat, lng: latLng.lng };
    }
    
    let waypoints = [];
    if (ubicacionActual) {
        waypoints = [
            L.latLng(ubicacionActual.lat, ubicacionActual.lng),
            L.latLng(pedido.origenCoords.lat, pedido.origenCoords.lng)
        ];
    } else {
        waypoints = [
            L.latLng(pedido.origenCoords.lat, pedido.origenCoords.lng)
        ];
    }
    
    currentRoutingControl = L.Routing.control({
        waypoints: waypoints,
        routeWhileDragging: false,
        showAlternatives: false,
        fitSelectedRoutes: true,
        lineOptions: {
            styles: [{ color: '#10B981', weight: 6, opacity: 0.9 }]
        },
        router: L.Routing.osrmv1({
            serviceUrl: 'https://router.project-osrm.org/route/v1'
        }),
        show: false,
        addWaypoints: false,
        draggableWaypoints: false
    }).addTo(map);
    
    setTimeout(() => {
        if (ubicacionActual) {
            map.fitBounds([
                [ubicacionActual.lat, ubicacionActual.lng],
                [pedido.origenCoords.lat, pedido.origenCoords.lng]
            ], { padding: [50, 50] });
        } else {
            map.setView([pedido.origenCoords.lat, pedido.origenCoords.lng], 15);
        }
        map.invalidateSize();
        dibujandoRuta = false;
    }, 300);
    
    if (recogidaMarker) map.removeLayer(recogidaMarker);
    recogidaMarker = L.marker([pedido.origenCoords.lat, pedido.origenCoords.lng], {
        icon: L.divIcon({
            html: '<div style="background:#10B981; width:36px; height:36px; border-radius:50%; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-box" style="color:white; font-size:16px;"></i></div>',
            iconSize: [36, 36]
        })
    }).addTo(map);
    recogidaMarker.bindPopup(`<b>📍 RECOGER AQUÍ</b><br>${sanitizarHTML(pedido.origen)}`);
    
    mostrarToast(`📍 Ruta de RECOGIDA - Dirígete a: ${sanitizarHTML(pedido.destino)}`);
}

function inicializarSonidoUrgente() {
    if (audioContextInicializado) return;
    
    try {
        // Crear sonido con Web Audio API (más confiable)
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        
        // Generar tono de sirena (sube y baja)
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.value = 880;
        gain.gain.value = 0;
        
        osc.start();
        
        // Subir volumen gradualmente
        gain.gain.linearRampToValueAtTime(0.5, now + 0.1);
        
        // Cambiar frecuencia (efecto sirena)
        osc.frequency.linearRampToValueAtTime(660, now + 0.3);
        osc.frequency.linearRampToValueAtTime(880, now + 0.6);
        osc.frequency.linearRampToValueAtTime(660, now + 0.9);
        osc.frequency.linearRampToValueAtTime(880, now + 1.2);
        
        // Bajar volumen
        gain.gain.linearRampToValueAtTime(0, now + 1.8);
        osc.stop(now + 2);
        
        setTimeout(() => ctx.close(), 2500);
        
        audioContextInicializado = true;
    } catch(e) {
        console.log("Error reproduciendo sonido:", e);
    }
}

function reproducirSonidoUrgente() {
    try {
        // Método 1: Web Audio API
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        
        osc1.frequency.value = 880;
        osc2.frequency.value = 660;
        gain.gain.value = 0.5;
        
        osc1.start();
        osc2.start();
        
        gain.gain.exponentialRampToValueAtTime(0.00001, now + 1.5);
        osc1.stop(now + 1.5);
        osc2.stop(now + 1.5);
        
        setTimeout(() => ctx.close(), 2000);
        
    } catch(e) {
        console.log("Error en sonido:", e);
    }
    
    // Método 2: Vibración fuerte
    if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate([300, 100, 300, 100, 500, 200, 300]);
    }
}

// ==================== RUTA DE ENTREGA (origen -> destino) ====================
async function dibujarRutaEntrega(pedido) {
    // ✅ Validar que estamos en el pedido correcto
    if (ultimoPedidoDibujado === pedido.id && ultimaEtapa === 'entrega') {
        console.log("🟢 Ruta de entrega ya activa, omitiendo redibujo");
        return;
    }
    
    if (dibujandoRuta) {
        console.log("⏳ Ya dibujando una ruta, espera...");
        return;
    }
    
    dibujandoRuta = true;
    
    // ✅ Limpiar rutas anteriores
    limpiarRutasYMarcadores();
    ultimoPedidoDibujado = pedido.id;
    ultimaEtapa = 'entrega';
    
    // ✅ Validar coordenadas del origen (recogida) y destino
    if (!pedido.origenCoords || !pedido.destinoCoords) {
        console.error("❌ Faltan coordenadas para ruta de entrega:", {
            origen: pedido.origenCoords,
            destino: pedido.destinoCoords
        });
        mostrarToast("❌ No se pueden dibujar coordenadas de destino. Intenta recargar.", true);
        dibujandoRuta = false;
        return;
    }
    
    console.log("📍 Dibujando ruta de ENTREGA:", {
        desde: pedido.origenCoords,
        hasta: pedido.destinoCoords
    });
    
    // ✅ Crear la ruta desde origen (recogida) hasta destino
    try {
        currentRoutingControl = L.Routing.control({
            waypoints: [
                L.latLng(pedido.origenCoords.lat, pedido.origenCoords.lng),
                L.latLng(pedido.destinoCoords.lat, pedido.destinoCoords.lng)
            ],
            routeWhileDragging: false,
            showAlternatives: false,
            fitSelectedRoutes: true,
            lineOptions: {
                styles: [{ color: '#FF6200', weight: 6, opacity: 0.9 }]
            },
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1'
            }),
            show: false,
            addWaypoints: false,
            draggableWaypoints: false
        }).addTo(map);
        
        // ✅ Ajustar el mapa para ver toda la ruta
        setTimeout(() => {
            map.fitBounds([
                [pedido.origenCoords.lat, pedido.origenCoords.lng],
                [pedido.destinoCoords.lat, pedido.destinoCoords.lng]
            ], { padding: [50, 50] });
            map.invalidateSize();
            dibujandoRuta = false;
        }, 300);
        
    } catch(e) {
        console.error("❌ Error dibujando ruta de entrega:", e);
        mostrarToast("❌ Error al dibujar la ruta", true);
        dibujandoRuta = false;
    }
    
    // ✅ Crear marcador de destino si no existe
    if (destinoMarker) map.removeLayer(destinoMarker);
    destinoMarker = L.marker([pedido.destinoCoords.lat, pedido.destinoCoords.lng], {
        icon: L.divIcon({
            html: '<div style="background:#3B82F6; width:36px; height:36px; border-radius:50%; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-flag-checkered" style="color:white; font-size:16px;"></i></div>',
            iconSize: [36, 36]
        })
    }).addTo(map);
    destinoMarker.bindPopup(`<b>🏁 ENTREGAR AQUÍ</b><br>${sanitizarHTML(pedido.destino)}`).openPopup();
    
    mostrarToast(`🚚 Ruta de ENTREGA - Desde ${sanitizarHTML(pedido.origen)} hasta ${sanitizarHTML(pedido.destino)}`);
    
    // ✅ Opcional: cerrar popup después de 5 segundos
    setTimeout(() => {
        if (destinoMarker) destinoMarker.closePopup();
    }, 5000);
}

// ==================== MODO OSCURO ====================
function toggleDarkMode() {
    const body = document.body;
    const iconDesktop = document.getElementById('darkModeIcon');
    const iconMobile = document.getElementById('darkModeIconMobile');
    
    if (body.classList.contains('dark-mode')) {
        body.classList.remove('dark-mode');
        localStorage.setItem('delivery_dark_mode', 'false');
        if (iconDesktop) {
            iconDesktop.classList.remove('fa-sun');
            iconDesktop.classList.add('fa-moon');
        }
        if (iconMobile) {
            iconMobile.classList.remove('fa-sun');
            iconMobile.classList.add('fa-moon');
        }
        mostrarToast("☀️ Modo claro activado");
    } else {
        body.classList.add('dark-mode');
        localStorage.setItem('delivery_dark_mode', 'true');
        if (iconDesktop) {
            iconDesktop.classList.remove('fa-moon');
            iconDesktop.classList.add('fa-sun');
        }
        if (iconMobile) {
            iconMobile.classList.remove('fa-moon');
            iconMobile.classList.add('fa-sun');
        }
        mostrarToast("🌙 Modo oscuro activado");
    }
    
    setTimeout(() => {
        if (typeof map !== 'undefined' && map) {
            map.invalidateSize();
        }
    }, 100);
}

function cargarModoOscuro() {
    const darkMode = localStorage.getItem('delivery_dark_mode');
    const iconDesktop = document.getElementById('darkModeIcon');
    const iconMobile = document.getElementById('darkModeIconMobile');
    
    if (darkMode === 'true') {
        document.body.classList.add('dark-mode');
        if (iconDesktop) {
            iconDesktop.classList.remove('fa-moon');
            iconDesktop.classList.add('fa-sun');
        }
        if (iconMobile) {
            iconMobile.classList.remove('fa-moon');
            iconMobile.classList.add('fa-sun');
        }
    } else {
        const hora = new Date().getHours();
        if (hora >= 20 || hora < 6) {
            document.body.classList.add('dark-mode');
            if (iconDesktop) {
                iconDesktop.classList.remove('fa-moon');
                iconDesktop.classList.add('fa-sun');
            }
            if (iconMobile) {
                iconMobile.classList.remove('fa-moon');
                iconMobile.classList.add('fa-sun');
            }
            localStorage.setItem('delivery_dark_mode', 'true');
        }
    }
}

// Ejecutar al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    cargarModoOscuro();
});

// ==================== MARCAR PAQUETE COMO RECOGIDO ====================
async function marcarPaqueteRecogido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    mostrarToast("📦 Actualizando estado del paquete...");
    
    try {
        // ✅ Actualizar en Supabase
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'recogido',
                paquete_recogido_en: new Date().toISOString()
            })
            .eq('id', pedidoId);
        
        if (error) throw error;
        
        mostrarToast(`✅ ¡Paquete #${sanitizarHTML(pedidoId)} RECOGIDO! Ahora dirígete al destino.`);
        vibrar(200);  // <-- AGREGAR
        
          // ✅ Forzar recarga para obtener el nuevo estado 'recogido'
        await cargarPedidos(true);
        
        // ✅ Buscar el pedido actualizado y dibujar ruta de entrega
        const pedidoActualizado = misPedidosActivos.find(p => p.id === pedidoId);
        if (pedidoActualizado && pedidoActualizado.estado === 'recogido') {
            await dibujarRutaEntrega(pedidoActualizado);
            await actualizarColorMarcador();
            
            // ✅ Mostrar popup con instrucciones
            if (userMarker) {
                userMarker.bindPopup(`🏍️ <b>${sanitizarHTML(currentUser.nombre)}</b><br>📦 En camino a ENTREGAR`).openPopup();
                setTimeout(() => userMarker.closePopup(), 3000);
            }
        } else {
            console.error("❌ No se encontró el pedido actualizado", pedidoId);
            mostrarToast("⚠️ El pedido se actualizó, pero no se pudo dibujar la ruta", true);
        }
        
    } catch(e) {
        console.error('Error marcando paquete recogido:', e);
        mostrarToast("❌ Error al registrar la recogida: " + (e.message || "Verifica tu conexión"), true);
    }
}

// ==================== START LOCATION TRACKING (VERSIÓN CORREGIDA) ====================
async function startLocationTracking() {
    if (!("geolocation" in navigator)) {
        mostrarToast("⚠️ Tu navegador no soporta geolocalización", true);
        window.iniciandoLocalizacion = false;
        return;
    }
    
    // Evitar múltiples instancias
    if (window.iniciandoLocalizacion) {
        console.log("⏳ Ya se está iniciando la localización");
        return;
    }
    
    // Verificar que el usuario es delivery
    if (!currentUser || currentUser.rol !== 'delivery') {
        console.log("❌ No se puede iniciar localización: usuario no es delivery");
        window.iniciandoLocalizacion = false;
        return;
    }
    
    window.iniciandoLocalizacion = true;
    mostrarToast("📍 Iniciando seguimiento de ubicación...");

    // ========== FUNCIÓN REUTILIZABLE PARA PROCESAR UBICACIÓN ==========
    const procesarYGuardarUbicacion = async (coords, esBackup = false) => {
        // Validar límites de Ciudad del Carmen
        if (coords.lat < 18.58 || coords.lat > 18.70 || 
            coords.lng < -91.88 || coords.lng > -91.75) {
            console.log("📍 Ubicación fuera de zona:", coords.lat, coords.lng);
            return false;
        }
        
        // Throttle: máximo cada 3 segundos
        const ahora = Date.now();
        if (ahora - ultimoTimestampUbicacion < 3000) {
            return false;
        }
        ultimoTimestampUbicacion = ahora;
        
        const ubicacionConTimestamp = { 
            lat: coords.lat, 
            lng: coords.lng, 
            timestamp: ahora 
        };
        ultimaUbicacionEnviada = ubicacionConTimestamp;
        
        // ========== SMOOTH TRACKING ==========
        if (!userMarker) {
            userMarker = crearMarcadorDelivery(
                coords.lat, 
                coords.lng, 
                currentUser.nombre, 
                isOnline ? '#10B981' : '#9CA3AF'
            );
            userMarker.addTo(map);
            
            posicionActual = { lat: coords.lat, lng: coords.lng };
            posicionDestino = { lat: coords.lat, lng: coords.lng };
            
            iniciarAnimacionSmooth();
        } else {
            posicionDestino = { lat: coords.lat, lng: coords.lng };
            
            if (typeof velocidadAnimacionVariable !== 'undefined' && velocidadAnimacionVariable) {
                const velocidad = calcularVelocidadAproximada(coords.lat, coords.lng);
                velocidadAnimacion = Math.min(0.35, Math.max(0.1, velocidad / 80));
            }
        }

        // Zoom dinámico (código sin cambios)
        if (autoFollow && userMarker) {
            // ... (mantengo tu código de zoom tal cual)
            let velocidad = 0;
            let distanciaAlDestino = null;
            
            if (zoomDinamico) {
                velocidad = calcularVelocidadAproximada(coords.lat, coords.lng);
                
                if (misPedidosActivos.length > 0) {
                    const pedidoActivo = misPedidosActivos[0];
                    if (pedidoActivo.estado === 'asignado' && pedidoActivo.origenCoords) {
                        distanciaAlDestino = calcularDistanciaEntrePuntos(coords, pedidoActivo.origenCoords);
                    } else if (pedidoActivo.estado === 'recogido' && pedidoActivo.destinoCoords) {
                        distanciaAlDestino = calcularDistanciaEntrePuntos(coords, pedidoActivo.destinoCoords);
                    }
                }
                
                let zoom = 16;
                if (velocidad > 50) zoom = 13;
                else if (velocidad > 30) zoom = 14;
                else if (velocidad > 15) zoom = 15;
                
                if (distanciaAlDestino !== null && distanciaAlDestino > 0) {
                    if (distanciaAlDestino < 0.2) zoom = 18;
                    else if (distanciaAlDestino < 0.5) zoom = 17;
                    else if (distanciaAlDestino < 1) zoom = 16;
                    else if (distanciaAlDestino < 2) zoom = 15;
                    else zoom = 14;
                }
                
                zoom = Math.min(18, Math.max(13, zoom));
                
                if (posicionActual) {
                    map.setView([posicionActual.lat, posicionActual.lng], zoom);
                } else {
                    map.setView([coords.lat, coords.lng], zoom);
                }
            }
        }
        
        // Guardar en Supabase
        if (currentUser && isOnline && supabaseClient) {
            await guardarUbicacionConThrottle(
                currentUser.id, 
                currentUser.nombre, 
                coords.lat, 
                coords.lng, 
                true
            );
        }
        
        if (esBackup) {
            console.log("🔄 Backup: ubicación actualizada", coords.lat.toFixed(4), coords.lng.toFixed(4));
        }
        
        return true;
    };

    // ========== MÉTODO 1: UBICACIÓN INICIAL PRECISA ==========
    try {
        const coordsPrecisos = await obtenerUbicacionPrecisa();
        console.log(`📍 Ubicación precisa obtenida: ${coordsPrecisos.lat}, ${coordsPrecisos.lng} (Precisión: ${coordsPrecisos.accuracy}m)`);
        
        await procesarYGuardarUbicacion(coordsPrecisos, false);
        mostrarToast(`✅ Ubicación detectada (precisión ${Math.round(coordsPrecisos.accuracy)}m)`);
        
    } catch (error) {
        console.error("❌ Error obteniendo ubicación precisa:", error);
        mostrarToast("⚠️ No se pudo obtener ubicación precisa. Usando modo estándar...", true);
        
        // Fallback
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const coords = { 
                    lat: pos.coords.latitude, 
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                };
                await procesarYGuardarUbicacion(coords, false);
                mostrarToast("✅ Ubicación detectada (modo estándar)");
                window.iniciandoLocalizacion = false;
            },
            (err) => {
                console.error("Error en fallback:", err);
                window.iniciandoLocalizacion = false;
                mostrarToast("❌ No se pudo obtener ubicación. Verifica GPS y permisos.", true);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
        return; // Salimos aquí porque el fallback ya maneja el estado
    }

    // ========== MÉTODO 2: WATCH POSITION ==========
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }
    
    watchId = navigator.geolocation.watchPosition(
        async (pos) => {
            const coords = { 
                lat: pos.coords.latitude, 
                lng: pos.coords.longitude 
            };
            
            if (ultimaUbicacionEnviada) {
                const distancia = calcularDistanciaMetros(ultimaUbicacionEnviada, coords);
                if (distancia < 15) return;
            }
            
            await procesarYGuardarUbicacion(coords, false);
        },
        (err) => console.error("Error en watchPosition:", err.message),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );

    // ========== MÉTODO 3: BACKUP INTERVAL ==========
    if (backupIntervalId) clearInterval(backupIntervalId);
    
    backupIntervalId = setInterval(() => {
        const ahora = Date.now();
        const necesitaBackup = !ultimaUbicacionEnviada || 
                               (ahora - (ultimaUbicacionEnviada.timestamp || 0)) > 6000;
        
        if (necesitaBackup && isOnline) {
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    await procesarYGuardarUbicacion(coords, true);
                },
                () => {}, // silencioso
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
            );
        }
    }, 6000);

    // ========== VISIBILITY CHANGE ==========
    const handleVisibilityChange = () => {
        if (!document.hidden && isOnline) {
            setTimeout(() => {
                navigator.geolocation.getCurrentPosition(
                    async (pos) => {
                        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                        await procesarYGuardarUbicacion(coords, false);
                    },
                    () => {},
                    { enableHighAccuracy: true, timeout: 5000 }
                );
            }, 500);
        }
    };

    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    console.log("✅ Seguimiento de ubicación iniciado correctamente");
    
    // Limpiar flag al finalizar
    setTimeout(() => {
        window.iniciandoLocalizacion = false;
    }, 2000);
}

// ==================== OBTENER UBICACIÓN PRECISA ====================
function obtenerUbicacionPrecisa() {
    return new Promise((resolve, reject) => {
        const opciones = {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        };
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                };
                console.log(`📍 Ubicación precisa: ${coords.lat}, ${coords.lng} (Precisión: ${coords.accuracy}m)`);
                
                // Si la precisión es mayor a 50m, intentar de nuevo
                if (coords.accuracy > 50) {
                    console.log("⚠️ Precisión baja, reintentando...");
                    setTimeout(() => obtenerUbicacionPrecisa().then(resolve).catch(reject), 1000);
                } else {
                    resolve(coords);
                }
            },
            (error) => {
                console.error("Error obteniendo ubicación precisa:", error);
                reject(error);
            },
            opciones
        );
    });
}

// ==================== AUTO-FOLLOW Y CONTROL DE MAPA ====================
function toggleAutoFollow() {
    autoFollow = !autoFollow;
    mostrarToast(autoFollow ? "🚗 Seguimiento automático activado" : "📍 Control manual del mapa");
}

function toggleZoomDinamico() {
    zoomDinamico = !zoomDinamico;
    mostrarToast(zoomDinamico ? "🔍 Zoom dinámico activado" : "🔍 Zoom fijo");
}

function centrarEnMiUbicacion() {
    if (ultimaUbicacionEnviada) {
        map.setView([ultimaUbicacionEnviada.lat, ultimaUbicacionEnviada.lng], 16);
        mostrarToast("📍 Centrando en tu ubicación");
    } else {
        mostrarToast("❌ No hay ubicación disponible aún", true);
    }
}

// ✅ Función auxiliar: calcular distancia en metros
function calcularDistanciaMetros(punto1, punto2) {
    const R = 6371e3; // Metros
    const φ1 = punto1.lat * Math.PI/180;
    const φ2 = punto2.lat * Math.PI/180;
    const Δφ = (punto2.lat - punto1.lat) * Math.PI/180;
    const Δλ = (punto2.lng - punto1.lng) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

// ✅ Variable para throttle de ubicación
let ultimoGuardadoUbicacion = 0;

// ✅ Función con throttle para guardar ubicación
async function guardarUbicacionConThrottle(deliveryId, deliveryNombre, lat, lng, online) {
    const ahora = Date.now();
    if (ahora - ultimoGuardadoUbicacion < 5000) {
        return; // Guardar máximo cada 5 segundos
    }
    ultimoGuardadoUbicacion = ahora;
    
    await guardarUbicacionEnSupabase(deliveryId, deliveryNombre, lat, lng, online);
}

// ✅ Función alternativa para obtener ubicación (si falla la primera)
function obtenerUbicacionAlternativa() {
    // ✅ Evitar múltiples intentos simultáneos
    if (window.obteniendoUbicacionAlternativa) {
        console.log("⏳ Ya hay un intento de ubicación en curso");
        return;
    }
    
    window.obteniendoUbicacionAlternativa = true;
    mostrarToast("🔄 Reintentando obtener ubicación...");
    
    // ✅ Verificar que el usuario sigue siendo delivery y está online
    if (!currentUser || currentUser.rol !== 'delivery') {
        console.log("❌ Usuario no es delivery, cancelando obtención de ubicación");
        window.obteniendoUbicacionAlternativa = false;
        return;
    }
    
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            try {
                const coords = { 
                    lat: pos.coords.latitude, 
                    lng: pos.coords.longitude 
                };
                
                // ✅ Validar que las coordenadas estén dentro de Ciudad del Carmen
                if (coords.lat < 18.58 || coords.lat > 18.70 || 
                    coords.lng < -91.88 || coords.lng > -91.75) {
                    console.warn("📍 Ubicación fuera de Ciudad del Carmen:", coords);
                    mostrarToast("⚠️ Estás fuera de la zona de servicio (Ciudad del Carmen)", true);
                    window.obteniendoUbicacionAlternativa = false;
                    return;
                }
                
                console.log("📍 Ubicación obtenida en segundo intento:", coords);
                ultimaUbicacionEnviada = coords;
                
                // ✅ Crear o actualizar marcador
                if (!map) {
                    console.error("❌ Mapa no inicializado");
                    window.obteniendoUbicacionAlternativa = false;
                    return;
                }
                
                if (!userMarker) {
                    userMarker = crearMarcadorDelivery(
                        coords.lat, 
                        coords.lng, 
                        currentUser.nombre, 
                        isOnline ? '#10B981' : '#9CA3AF'
                    );
                    userMarker.addTo(map);
                } else {
                    userMarker.setLatLng(coords);
                }
                
                // ✅ Centrar mapa suavemente
                map.setView([coords.lat, coords.lng], 15);
                
                // ✅ Guardar en Supabase SOLO si está online
                if (currentUser && isOnline && supabaseClient) {
                    await guardarUbicacionEnSupabase(
                        currentUser.id,
                        currentUser.nombre,
                        coords.lat,
                        coords.lng,
                        true
                    );
                    console.log("✅ Ubicación guardada en Supabase (segundo intento)");
                }
                
                mostrarToast("✅ Ubicación detectada correctamente");
                
                // ✅ Forzar carga de pedidos después de obtener ubicación
                if (isOnline && typeof cargarPedidos === 'function') {
                    setTimeout(() => cargarPedidos(true), 1000);
                }
                
            } catch (error) {
                console.error("❌ Error procesando ubicación:", error);
                mostrarToast("⚠️ Error al procesar la ubicación", true);
            } finally {
                window.obteniendoUbicacionAlternativa = false;
            }
        },
        (err) => {
            console.error("Error en segundo intento:", err);
            window.obteniendoUbicacionAlternativa = false;
            
            // ✅ Mensajes más descriptivos según el error
            let mensajeError = "⚠️ No se pudo obtener tu ubicación";
            if (err.code === 1) {
                mensajeError = "❌ Permiso de ubicación denegado. Actívalo en la configuración de tu navegador";
            } else if (err.code === 2) {
                mensajeError = "⚠️ Ubicación no disponible. Verifica que el GPS esté activado";
            } else if (err.code === 3) {
                mensajeError = "⏰ Tiempo de espera agotado. Intenta recargar la página";
            }
            
            mostrarToast(mensajeError, true);
            
            // ✅ Sugerencia para el usuario
            setTimeout(() => {
                mostrarToast("💡 Sugerencia: Activa el GPS y recarga la página", false);
            }, 2000);
        },
        { 
            enableHighAccuracy: true, 
            timeout: 10000,  // Aumentado a 10 segundos
            maximumAge: 0    // No usar caché
        }
    );
}

function centrarMapa() {
    if(map) map.setView([18.6456, -91.8249], 13);
    mostrarToast("📍 Mapa centrado en Ciudad del Carmen");
}

async function cargarPedidos(force = false) {
    if (!force && !paginaVisible) {
        console.log("📴 Página oculta, no se cargan pedidos");
        return;
    }
    
    const ahora = Date.now();
    let tiempoEspera = 5000;
    
    if (!force) {
        if (isOnline) {
            tiempoEspera = 2000;
        } else {
            tiempoEspera = 5000;
        }
        
        if (ahora - ultimaPeticionPedidos < tiempoEspera) {
            console.log(`⏳ Throttling: cargarPedidos - demasiado rápido`);
            return;
        }
    }
    ultimaPeticionPedidos = ahora;
    
    const supabase = supabaseClient;
    if (!supabase) {
        console.error('Supabase no disponible');
        return;
    }
    
    try {
        const { data: pedidosPendientes, error: errorPendientes } = await supabase
            .from('pedidos')
            .select('*')
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: true });
        
        if (errorPendientes) throw errorPendientes;
        
        const { data: pedidosAsignados, error: errorAsignados } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .in('estado', ['asignado', 'recogido'])
            .order('fecha', { ascending: true });
        
        if (errorAsignados) throw errorAsignados;
        
        // ✅ Guardar IDs anteriores para detectar nuevos
        const idsPedidosAnteriores = new Set(pedidosDisponibles.map(p => p.id));
        
        const nuevosDisponibles = (pedidosPendientes || []).map(p => convertirPedidoDeSupabase(p));
        const nuevosActivos = (pedidosAsignados || []).map(p => convertirPedidoDeSupabase(p));
        
        const estadoAnteriorActivo = misPedidosActivos.length > 0 ? misPedidosActivos[0]?.estado : null;
        
        pedidosDisponibles = nuevosDisponibles;
        misPedidosActivos = nuevosActivos;
        
        // ✅ Detectar pedidos NUEVOS
        const nuevosPedidos = nuevosDisponibles.filter(p => !idsPedidosAnteriores.has(p.id));
        
        // ✅ NOTIFICAR SOLO si hay NUEVOS pedidos Y no hay pedido activo
        if (!misPedidosActivos.length && nuevosPedidos.length > 0) {
            console.log("🔔 ¡NUEVO PEDIDO DETECTADO!", nuevosPedidos[0]);
            mostrarModalNuevoPedidoUrgente(nuevosPedidos[0]);
        }
        
        actualizarListaPedidos();
        
        // ... resto del código (manejo de rutas, etc.) se mantiene igual
        
        if (misPedidosActivos.length > 0) {
            const pedidoActivo = misPedidosActivos[0];
            const estadoActual = pedidoActivo.estado;
            
            if (estadoActual === 'asignado' && pedidoActivo.origenCoords) {
                const necesitaRecalculo = !currentRoutingControl || 
                                          ultimaEtapa !== 'recogida' ||
                                          ultimoPedidoDibujado !== pedidoActivo.id;
                
                if (necesitaRecalculo || estadoAnteriorActivo !== estadoActual) {
                    console.log("🟢 Dibujando/Actualizando ruta de RECOGIDA...");
                    await dibujarRutaRecogida(pedidoActivo);
                }
            }
            else if (estadoActual === 'recogido' && pedidoActivo.destinoCoords) {
                const necesitaRecalculo = !currentRoutingControl || 
                                          ultimaEtapa !== 'entrega' ||
                                          ultimoPedidoDibujado !== pedidoActivo.id;
                
                if (necesitaRecalculo || estadoAnteriorActivo !== estadoActual) {
                    console.log("🟠 Dibujando/Actualizando ruta de ENTREGA...");
                    await dibujarRutaEntrega(pedidoActivo);
                }
            }
        } else {
            limpiarRutasYMarcadores();
            if (pedidoSeleccionado) {
                dibujarRutaOptimaPedido(pedidoSeleccionado);
            }
        }
        
        await actualizarColorMarcador();
        await actualizarBadgeEstado();

        if (misPedidosActivos.length > 0) {
            iniciarActualizacionRutaTiempoReal();
        } else {
            detenerActualizacionRutaTiempoReal();
        }
          
        console.log(`📦 ${pedidosDisponibles.length} pedidos disponibles, ${misPedidosActivos.length} activos`);
        
    } catch(e) {
        console.error('Error cargando pedidos:', e);
    }
}

function seleccionarPedido(pedidoId) {
    pedidoSeleccionado = pedidosDisponibles.find(p => p.id === pedidoId);
    limpiarRutasYMarcadores();
    dibujarRutaOptimaPedido(pedidoSeleccionado);
    actualizarListaPedidos();
    mostrarToast(`📍 Pedido #${sanitizarHTML(pedidoId)} seleccionado - Ruta mostrada en mapa`);
}

async function dibujarRutaOptimaPedido(pedido) { limpiarRutasYMarcadores();
    
    if (pedido.origenCoords && pedido.destinoCoords) {
        currentRoutingControl = L.Routing.control({
            waypoints: [
                L.latLng(pedido.origenCoords.lat, pedido.origenCoords.lng),
                L.latLng(pedido.destinoCoords.lat, pedido.destinoCoords.lng)
            ],
            routeWhileDragging: false,
            showAlternatives: false,
            lineOptions: {
                styles: [{ color: '#FF6200', weight: 5, opacity: 0.8 }]
            },
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1'
            }),
            show: false,
            addWaypoints: false,
            draggableWaypoints: false
        }).addTo(map);
        
        map.fitBounds([
            [pedido.origenCoords.lat, pedido.origenCoords.lng],
            [pedido.destinoCoords.lat, pedido.destinoCoords.lng]
        ], { padding: [50, 50] });
        
        mostrarToast(`📏 Distancia: ${sanitizarHTML(pedido.distanciaReal)} km • 💰 $${sanitizarHTML(pedido.tarifa)}`);
    }
}

function dibujarRutaSeleccionada() {
    if (pedidoSeleccionado) {
        dibujarRutaOptimaPedido(pedidoSeleccionado);
    }
}

async function agarrarPedido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    // ✅ PREVENIR DOBLE CLIC
    if (window.agarrandoPedido) {
        mostrarToast("⏳ Procesando solicitud, espera...", true);
        return;
    }
    window.agarrandoPedido = true;
    
    mostrarToast("🔍 Verificando disponibilidad...");
    
    try {
        // ========== 1. VERIFICAR QUE EL DELIVERY NO TENGA PEDIDO ACTIVO ==========
        const tienePedidoActivo = await deliveryTienePedidoActivo(currentUser.id);
        
        if (tienePedidoActivo) {
            const pedidoActivo = await getPedidoActivoDelDelivery(currentUser.id);
            mostrarToast(`❌ Ya tienes un pedido activo (#${sanitizarHTML(pedidoActivo?.id)}). Complétalo primero.`, true);
            
            if (pedidoActivo) {
                const elementoActivo = document.querySelector(`[data-pedido-id="${sanitizarHTML(pedidoActivo.id)}"]`);
                if (elementoActivo) {
                    elementoActivo.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    elementoActivo.style.border = '2px solid #FF6200';
                    setTimeout(() => {
                        elementoActivo.style.border = '';
                    }, 3000);
                }
            }
            window.agarrandoPedido = false;
            return;
        }
        
        // ========== 2. VERIFICAR QUE EL PEDIDO SIGA PENDIENTE ==========
        const { data: pedidoActual, error: errorPedido } = await supabase
            .from('pedidos')
            .select('id, estado, cliente_nombre, origen, destino, tarifa')
            .eq('id', pedidoId)
            .single();
        
        if (errorPedido) throw errorPedido;
        
        if (!pedidoActual) {
            mostrarToast(`❌ El pedido #${sanitizarHTML(pedidoId)} no existe`, true);
            window.agarrandoPedido = false;
            return;
        }
        
        if (pedidoActual.estado !== 'pendiente') {
            mostrarToast(`❌ El pedido #${sanitizarHTML(pedidoId)} ya no está disponible (fue agarrado por otro delivery)`, true);
            await cargarPedidos(true);
            window.agarrandoPedido = false;
            return;
        }
        
        // ========== 3. CONFIRMAR CON MODAL ==========
        const confirmado = await mostrarModalConfirmacionDelivery(
            "Confirmar pedido",
            `¿Seguro que quieres AGARRAR el pedido #${sanitizarHTML(pedidoId)}?\n\n📦 ${sanitizarHTML(pedidoActual.cliente_nombre)}\n📍 ${sanitizarHTML(pedidoActual.origen)}\n💰 $${pedidoActual.tarifa}`
        );
        
        console.log("Confirmado:", confirmado); // ✅ Debería mostrar true o false
        
        if (!confirmado) {
            mostrarToast("❌ Acción cancelada");
            window.agarrandoPedido = false;
            return;
        }
        
        // ========== 4. AGARRAR PEDIDO CON DOBLE VERIFICACIÓN ==========
        // 🔴 CRÍTICO: Usar transacción/condición para evitar race condition
        const { data: updatedPedido, error: updateError } = await supabase
            .from('pedidos')
            .update({
                estado: 'asignado',
                delivery_id: currentUser.id,
                delivery_nombre: currentUser.nombre,
                fecha_asignado: new Date().toISOString()
            })
            .eq('id', pedidoId)
            .eq('estado', 'pendiente')  // ← CLAVE: solo si sigue pendiente
            .select();  // ← Devolver el registro actualizado
        
        // ========== 5. VERIFICAR SI LA ACTUALIZACIÓN FUE EXITOSA ==========
        if (updateError) throw updateError;
        
        // Si no se actualizó ningún registro, alguien más lo agarró
        if (!updatedPedido || updatedPedido.length === 0) {
            mostrarToast(`❌ El pedido #${sanitizarHTML(pedidoId)} fue agarrado por otro delivery justo ahora`, true);
            await cargarPedidos(true);
            window.agarrandoPedido = false;
            return;
        }
        
        // ========== 6. ACTUALIZAR ESTADO LOCAL ==========
        const pedidoAsignado = updatedPedido[0];
        
        // Mostrar éxito
        mostrarToast(`✅ Pedido #${sanitizarHTML(pedidoId)} AGARRADO! Dirígete al origen para recoger.`);
        vibrar(300);
        
        // Limpiar selección
        pedidoSeleccionado = null;
        
        // ========== 7. ACTUALIZAR LISTAS ==========
        // Recargar pedidos desde Supabase
        await cargarPedidos(true);
        
        // Actualizar color del marcador (a naranja porque está ocupado)
        await actualizarColorMarcador();
        
        // ========== 8. MOSTRAR RUTA DE RECOGIDA ==========
        // Buscar el pedido en misPedidosActivos (ya debería estar después de cargarPedidos)
        const pedidoActivo = misPedidosActivos.find(p => p.id === pedidoId);
        
        if (pedidoActivo && pedidoActivo.origenCoords) {
            await dibujarRutaRecogida(pedidoActivo);
            
            // Centrar mapa en el origen
            setTimeout(() => {
                if (map && pedidoActivo.origenCoords) {
                    map.setView([pedidoActivo.origenCoords.lat, pedidoActivo.origenCoords.lng], 14);
                    // Mostrar popup en el origen
                    if (recogidaMarker) {
                        recogidaMarker.openPopup();
                        setTimeout(() => recogidaMarker.closePopup(), 5000);
                    }
                }
            }, 500);
        } else {
            console.warn("⚠️ No se encontró el pedido asignado en misPedidosActivos");
            // Forzar una recarga adicional después de 1 segundo
            setTimeout(() => cargarPedidos(true), 1000);
        }
        
        // ========== 9. ACTUALIZAR BADGE DE ESTADO ==========
        await actualizarBadgeEstado();
        
    } catch(e) {
        console.error('❌ Error agarrando pedido:', e);
        mostrarToast(`❌ Error al agarrar el pedido: ${e.message || "Intenta de nuevo"}`, true);
    } finally {
        // Liberar el lock después de 2 segundos (para prevenir doble clic)
        setTimeout(() => {
            window.agarrandoPedido = false;
        }, 2000);
    }
}

async function completarPedido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
        mostrarToast("🏁 Marcando pedido como entregado...");
        
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'completado',
                fecha_completado: new Date().toISOString()
            })
            .eq('id', pedidoId);
        
        if (error) throw error;
        
        const { data: pedido } = await supabase
            .from('pedidos')
            .select('tarifa')
            .eq('id', pedidoId)
            .single();
        
        mostrarToast(`✅ Pedido #${sanitizarHTML(pedidoId)} ENTREGADO! Ganaste ${sanitizarHTML(pedido?.tarifa || 0)} MXN`);
        vibrar(200);  // <-- AGREGAR

         // ✅ AGREGAR: Actualizar estadísticas después de completar
        await actualizarEstadisticas();
        
        // Limpiar rutas y marcadores
        limpiarRutasYMarcadores();
        
        // Limpiar intervalo de ubicación si existe
        if (ubicacionInterval) {
            clearInterval(ubicacionInterval);
            ubicacionInterval = null;
        }
        
        // Resetear variables de seguimiento
        ultimoPedidoDibujado = null;
        ultimaEtapa = null;
        dibujandoRuta = false;
        
        // Recargar pedidos FORZADAMENTE
        await cargarPedidos(true);
        
        // Actualizar color del marcador
        await actualizarColorMarcador();
        
        // Actualizar badge de estado
        await actualizarBadgeEstado();
        
        // Forzar una actualización adicional después de 1 segundo
        setTimeout(() => {
            cargarPedidos(true);
        }, 1000);
        
    } catch(e) {
        console.error('Error completando pedido:', e);
        mostrarToast("❌ Error al completar el pedido", true);
    }
}

function actualizarListaPedidos() {
    const containerDisponibles = document.getElementById("pedidosDisponibles");
    // Verificar si el delivery ya tiene pedido activo (para UI)
    const tienePedidoActivo = misPedidosActivos.length > 0;
    
    if(pedidosDisponibles.length === 0) {
        containerDisponibles.innerHTML = '<div class="text-center text-gray-400 py-8"><i class="fas fa-box-open text-4xl mb-2 block"></i>No hay pedidos disponibles</div>';
    } else {
        containerDisponibles.innerHTML = pedidosDisponibles.map(p => `
            <div class="bg-white border rounded-xl p-4 shadow-sm pedido-card ${sanitizarHTML(pedidoSeleccionado?.id === p.id ? 'pedido-seleccionado' : '')}" onclick="seleccionarPedido(${sanitizarHTML(p.id)})">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-bold text-[#FF6200]">#${sanitizarHTML(p.id)}</span>
                    <span class="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">Pendiente</span>
            </div>
                <p class="text-sm"><i class="fas fa-circle text-[#FF6200] text-xs mr-1"></i> ${sanitizarHTML(p.origen)}</p>
                <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> ${sanitizarHTML(p.destino)}</p>
                <p class="text-xs text-gray-500 mt-2">📏 ${sanitizarHTML(p.distanciaReal)} km • 💰 $${sanitizarHTML(p.tarifa)}</p>
                <p class="text-xs text-gray-500">👤 Cliente: ${sanitizarHTML(p.clienteNombre)}</p>
                ${tienePedidoActivo ? 
                    `<button disabled class="w-full mt-3 bg-gray-400 cursor-not-allowed text-white py-2 rounded-lg text-sm font-medium transition-all">
                        <i class="fas fa-lock mr-1"></i> Completar pedido actual primero
                    </button>` :
                    `<button onclick="event.stopPropagation(); agarrarPedido(${sanitizarHTML(p.id)})" class="w-full mt-3 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
                        <i class="fas fa-hand-paper mr-1"></i> AGARRAR PEDIDO
                    </button>`
                }
            </div>
        `).join('');
    }
    
    // Resto del código para pedidos activos...
    const containerActivos = document.getElementById("pedidosActivos");
    if(misPedidosActivos.length === 0) {
        containerActivos.innerHTML = '<div class="text-center text-gray-400 py-4"><i class="fas fa-check-circle text-2xl mb-1 block"></i>No hay pedidos activos</div>';
    } else {
        containerActivos.innerHTML = misPedidosActivos.map(p => {
            const esRecogido = p.estado === 'recogido';
            const estaAsignado = p.estado === 'asignado';
            
            return `
            <div class="bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm" data-pedido-id="${sanitizarHTML(p.id)}">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-bold text-[#FF6200]">#${sanitizarHTML(p.id)}</span>
                    <span class="text-xs px-2 py-1 rounded-full ${esRecogido ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}">
                        ${esRecogido ? '📦 Paquete recogido' : '🟡 En camino a recoger'}
                    </span>
                </div>
                <p class="text-sm"><i class="fas fa-circle text-green-500 text-xs mr-1"></i> <strong>Recoger en:</strong> ${sanitizarHTML(p.origen)}</p>
                <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> <strong>Entregar en:</strong> ${sanitizarHTML(p.destino)}</p>
                <p class="text-xs text-gray-500 mt-2">📏 ${sanitizarHTML(p.distanciaReal)} km • 💰 $${sanitizarHTML(p.tarifa)}</p>
                <p class="text-xs text-gray-500">👤 Cliente: ${sanitizarHTML(p.clienteNombre)}</p>
                <div class="mt-3 text-xs text-center text-gray-500">
                    <i class="fas fa-info-circle"></i> Debes completar este pedido antes de agarrar otro
                </div>
                ${estaAsignado ? 
                    `<button onclick="marcarPaqueteRecogido(${p.id})" class="w-full mt-3 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
                        <i class="fas fa-box-open mr-1"></i> 📦 MARCAR PAQUETE RECOGIDO
                    </button>` : 
                    (esRecogido ?
                    `<button onclick="completarPedido(${p.id})" class="w-full mt-3 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
                        <i class="fas fa-check-circle mr-1"></i> 🏁 MARCAR ENTREGADO
                    </button>` : '')
                }
            </div>
            `;
        }).join('');
    }
}

// ==================== ACTUALIZAR RUTA EN TIEMPO REAL ====================
async function actualizarRutaEnTiempoReal() {
    // Solo si hay pedido activo
    if (misPedidosActivos.length === 0) return;
    
    const pedidoActivo = misPedidosActivos[0];
    if (!pedidoActivo) return;
    
    // Solo actualizar si estamos en asignado o recogido
    if (pedidoActivo.estado !== 'asignado' && pedidoActivo.estado !== 'recogido') return;
    
    // Obtener ubicación actual del delivery
    let ubicacionActual = null;
    if (userMarker) {
        const latLng = userMarker.getLatLng();
        ubicacionActual = { lat: latLng.lat, lng: latLng.lng };
    } else if (ultimaUbicacionEnviada) {
        ubicacionActual = { lat: ultimaUbicacionEnviada.lat, lng: ultimaUbicacionEnviada.lng };
    }
    
    if (!ubicacionActual) return;
    
    // Determinar destino según estado
    let destinoCoords = null;
    let tipoRuta = null;
    
    if (pedidoActivo.estado === 'asignado' && pedidoActivo.origenCoords) {
        destinoCoords = pedidoActivo.origenCoords;
        tipoRuta = 'recogida';
    } else if (pedidoActivo.estado === 'recogido' && pedidoActivo.destinoCoords) {
        destinoCoords = pedidoActivo.destinoCoords;
        tipoRuta = 'entrega';
    }
    
    if (!destinoCoords) return;
    
    // Calcular distancia a la ruta actual
    let necesitaActualizacion = false;
    
    if (currentRoutingControl && currentRoutingControl.getWaypoints) {
        try {
            const waypoints = currentRoutingControl.getWaypoints();
            if (waypoints && waypoints.length >= 2) {
                const rutaOrigen = waypoints[0].latLng;
                const rutaDestino = waypoints[waypoints.length - 1].latLng;
                
                // Calcular distancia desde ubicación actual a la ruta trazada
                const distanciaALaRuta = calcularDistanciaPuntoALinea(
                    ubicacionActual,
                    { lat: rutaOrigen.lat, lng: rutaOrigen.lng },
                    { lat: rutaDestino.lat, lng: rutaDestino.lng }
                );
                
                // Si está a más de 80 metros de la ruta, recalculamos
                if (distanciaALaRuta > 80) {
                    necesitaActualizacion = true;
                    console.log(`🔄 Delivery desviado de la ruta (${distanciaALaRuta.toFixed(0)}m), recalculando...`);
                }
            }
        } catch(e) {
            console.warn("Error verificando desviación:", e);
            necesitaActualizacion = true;
        }
    } else {
        // No hay ruta actual, dibujar por primera vez
        necesitaActualizacion = true;
    }
    
    // También actualizar cada 15 segundos para mantener sincronía
    const ahora = Date.now();
    if (!ultimoRecalculoRuta) ultimoRecalculoRuta = 0;
    if (ahora - ultimoRecalculoRuta > 15000) {
        necesitaActualizacion = true;
        console.log("🔄 Actualización periódica de ruta (15s)");
    }
    
    if (necesitaActualizacion) {
        ultimoRecalculoRuta = ahora;
        
        // Redibujar ruta desde ubicación actual hasta destino
        if (tipoRuta === 'recogida') {
            await dibujarRutaRecogidaDesdeUbicacion(pedidoActivo, ubicacionActual);
        } else if (tipoRuta === 'entrega') {
            await dibujarRutaEntregaDesdeUbicacion(pedidoActivo, ubicacionActual);
        }
    }
}

// Función para iniciar la actualización en tiempo real
function iniciarActualizacionRutaTiempoReal() {
    if (intervaloActualizacionRuta) {
        clearInterval(intervaloActualizacionRuta);
    }
    
    intervaloActualizacionRuta = setInterval(() => {
        if (paginaVisible && isOnline) {
            actualizarRutaEnTiempoReal();
        }
    }, 5000); // Cada 5 segundos
    
    console.log("🔄 Actualización de ruta en tiempo real iniciada (cada 5s)");
}

// Detener actualización
function detenerActualizacionRutaTiempoReal() {
    if (intervaloActualizacionRuta) {
        clearInterval(intervaloActualizacionRuta);
        intervaloActualizacionRuta = null;
    }
}

// Dibujar ruta de RECOGIDA desde ubicación actual del delivery
async function dibujarRutaRecogidaDesdeUbicacion(pedido, ubicacionActual) {
    if (!pedido.origenCoords || !ubicacionActual) {
        console.error("❌ Faltan coordenadas para ruta de recogida desde ubicación");
        return;
    }
    
    if (dibujandoRuta) {
        console.log("⏳ Ya dibujando una ruta, espera...");
        return;
    }
    
    dibujandoRuta = true;
    
    // Limpiar ruta anterior pero mantener marcadores
    if (currentRoutingControl) {
        try {
            if (currentRoutingControl._map) {
                map.removeControl(currentRoutingControl);
            }
        } catch(e) {}
        currentRoutingControl = null;
    }
    
    const waypoints = [
        L.latLng(ubicacionActual.lat, ubicacionActual.lng),
        L.latLng(pedido.origenCoords.lat, pedido.origenCoords.lng)
    ];
    
    currentRoutingControl = L.Routing.control({
        waypoints: waypoints,
        routeWhileDragging: false,
        showAlternatives: false,
        fitSelectedRoutes: false,  // No forzar zoom para no molestar
        lineOptions: {
            styles: [{ color: '#10B981', weight: 6, opacity: 0.9 }]
        },
        router: L.Routing.osrmv1({
            serviceUrl: 'https://router.project-osrm.org/route/v1'
        }),
        show: false,
        addWaypoints: false,
        draggableWaypoints: false
    }).addTo(map);
    
    dibujandoRuta = false;
    console.log("🔄 Ruta de recogida actualizada desde ubicación actual");
}

// Dibujar ruta de ENTREGA desde ubicación actual del delivery
async function dibujarRutaEntregaDesdeUbicacion(pedido, ubicacionActual) {
    if (!pedido.destinoCoords || !ubicacionActual) {
        console.error("❌ Faltan coordenadas para ruta de entrega desde ubicación");
        return;
    }
    
    if (dibujandoRuta) {
        console.log("⏳ Ya dibujando una ruta, espera...");
        return;
    }
    
    dibujandoRuta = true;
    
    // Limpiar ruta anterior pero mantener marcadores
    if (currentRoutingControl) {
        try {
            if (currentRoutingControl._map) {
                map.removeControl(currentRoutingControl);
            }
        } catch(e) {}
        currentRoutingControl = null;
    }
    
    const waypoints = [
        L.latLng(ubicacionActual.lat, ubicacionActual.lng),
        L.latLng(pedido.destinoCoords.lat, pedido.destinoCoords.lng)
    ];
    
    currentRoutingControl = L.Routing.control({
        waypoints: waypoints,
        routeWhileDragging: false,
        showAlternatives: false,
        fitSelectedRoutes: false,  // No forzar zoom
        lineOptions: {
            styles: [{ color: '#FF6200', weight: 6, opacity: 0.9 }]
        },
        router: L.Routing.osrmv1({
            serviceUrl: 'https://router.project-osrm.org/route/v1'
        }),
        show: false,
        addWaypoints: false,
        draggableWaypoints: false
    }).addTo(map);
    
    dibujandoRuta = false;
    console.log("🔄 Ruta de entrega actualizada desde ubicación actual");
}

// Calcula la distancia mínima desde un punto a una línea (en metros)
function calcularDistanciaPuntoALinea(punto, lineaInicio, lineaFin) {
    const x0 = punto.lng;
    const y0 = punto.lat;
    const x1 = lineaInicio.lng;
    const y1 = lineaInicio.lat;
    const x2 = lineaFin.lng;
    const y2 = lineaFin.lat;
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    
    if (dx === 0 && dy === 0) {
        return Math.sqrt(Math.pow(x0 - x1, 2) + Math.pow(y0 - y1, 2)) * 111000;
    }
    
    const t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy);
    
    let xp, yp;
    if (t < 0) {
        xp = x1;
        yp = y1;
    } else if (t > 1) {
        xp = x2;
        yp = y2;
    } else {
        xp = x1 + t * dx;
        yp = y1 + t * dy;
    }
    
    const distanciaGrados = Math.sqrt(Math.pow(x0 - xp, 2) + Math.pow(y0 - yp, 2));
    return distanciaGrados * 111000;
}

async function toggleOnline() {
    // Prevenir múltiples clics rápidos
    if (window.togglingOnline) {
        console.log("⏳ Ya se está procesando el cambio de estado");
        return;
    }
    window.togglingOnline = true;
    
    const nuevoEstado = !isOnline;
    const btn = document.getElementById("onlineToggle");
    const btnMobile = document.getElementById("onlineToggleMobile");
    const span = document.getElementById("onlineStatusText");
    const spanMobile = document.getElementById("onlineStatusTextMobile");
    
    // Feedback háptico en móvil
    if (window.innerWidth < 768 && window.navigator.vibrate) {
        window.navigator.vibrate(nuevoEstado ? 50 : 50);
    }
    
    // Mostrar loading en el botón
    const textoOriginal = span?.innerHTML;
    if (span) span.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
    if (spanMobile) spanMobile.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
    
    try {
        if (nuevoEstado) {
            // ========== CONECTARSE ==========
            
            // 1. Cambiar UI inmediatamente
            if (btn) {
                btn.classList.remove("bg-gray-500");
                btn.classList.add("bg-green-500", "hover:bg-green-600");
            }
            if (btnMobile) {
                btnMobile.classList.remove("bg-gray-500");
                btnMobile.classList.add("bg-green-500", "hover:bg-green-600");
            }
            
            // 2. Actualizar estado local
            isOnline = true;
            if (currentUser) {
                currentUser.online = true;
                const sesionGuardar = { ...currentUser };
                delete sesionGuardar.password_hash;
                localStorage.setItem('sesion_activa', JSON.stringify(sesionGuardar));
                localStorage.setItem('sesion_segura', JSON.stringify(sesionGuardar));
            }
            
            // 3. Actualizar en Supabase (no esperar)
            setDeliveryOnlineSupabase(currentUser?.id, true).catch(err => {
                console.warn("⚠️ Error actualizando online en Supabase:", err);
            });
            
            // 4. Iniciar localización (FUNDAMENTAL)
            if (!userMarker) {
                mostrarToast("📍 Obteniendo tu ubicación...");
                await startLocationTracking();
            } else {
                // Ya hay marcador, solo actualizar ubicación
                const coords = userMarker.getLatLng();
                if (coords && currentUser) {
                    await guardarUbicacionEnSupabase(
                        currentUser.id, 
                        currentUser.nombre, 
                        coords.lat, 
                        coords.lng, 
                        true
                    );
                }
            }
            
            // 5. Cargar pedidos disponibles
            await cargarPedidos(true);
            
            // 6. Iniciar intervalo de actualización de ubicación (cada 8 segundos)
            if (ubicacionInterval) clearInterval(ubicacionInterval);
            ubicacionInterval = setInterval(async () => {
                if (isOnline && currentUser && ultimaUbicacionEnviada) {
                    await guardarUbicacionConThrottle(
                        currentUser.id, 
                        currentUser.nombre, 
                        ultimaUbicacionEnviada.lat, 
                        ultimaUbicacionEnviada.lng, 
                        true
                    );
                }
            }, 8000);
            
            // 7. Actualizar texto final
            if (span) span.innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
            if (spanMobile) spanMobile.innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
            mostrarToast("✅ En línea - Recibirás pedidos");
            
        } else {
            // ========== DESCONECTARSE ==========
            
            // 1. Cambiar UI
            if (btn) {
                btn.classList.remove("bg-green-500", "hover:bg-green-600");
                btn.classList.add("bg-gray-500");
            }
            if (btnMobile) {
                btnMobile.classList.remove("bg-green-500", "hover:bg-green-600");
                btnMobile.classList.add("bg-gray-500");
            }
            
            // 2. Actualizar estado local
            isOnline = false;
            if (currentUser) {
                currentUser.online = false;
                const sesionGuardar = { ...currentUser };
                delete sesionGuardar.password_hash;
                localStorage.setItem('sesion_activa', JSON.stringify(sesionGuardar));
                localStorage.setItem('sesion_segura', JSON.stringify(sesionGuardar));
            }
            
            // 3. Detener intervalo de ubicación
            if (ubicacionInterval) {
                clearInterval(ubicacionInterval);
                ubicacionInterval = null;
            }
            
            // 4. Guardar estado offline en Supabase
            if (currentUser && ultimaUbicacionEnviada) {
                await guardarUbicacionEnSupabase(
                    currentUser.id, 
                    currentUser.nombre, 
                    ultimaUbicacionEnviada.lat, 
                    ultimaUbicacionEnviada.lng, 
                    false
                );
            }
            setDeliveryOnlineSupabase(currentUser?.id, false).catch(console.error);
            
            // 5. Actualizar texto final
            if (span) span.innerHTML = 'Conectarse';
            if (spanMobile) spanMobile.innerHTML = 'Conectarse';
            mostrarToast("📴 Fuera de línea - No recibirás pedidos");
        }
        
        // 8. Actualizar color del marcador (verde disponible / naranja ocupado)
        await actualizarColorMarcador();
        
        // 9. Forzar actualización de la lista de pedidos (para mostrar/ocultar botones)
        if (typeof actualizarListaPedidos === 'function') {
            actualizarListaPedidos();
        }
        
    } catch (error) {
        console.error("❌ Error en toggleOnline:", error);
        mostrarToast("⚠️ Error al cambiar estado. Reintenta.", true);
        
        // Revertir UI en caso de error
        if (nuevoEstado) {
            // Intentó conectarse pero falló
            if (btn) {
                btn.classList.remove("bg-green-500", "hover:bg-green-600");
                btn.classList.add("bg-gray-500");
            }
            if (btnMobile) {
                btnMobile.classList.remove("bg-green-500", "hover:bg-green-600");
                btnMobile.classList.add("bg-gray-500");
            }
            if (span) span.innerHTML = 'Conectarse';
            if (spanMobile) spanMobile.innerHTML = 'Conectarse';
            isOnline = false;
            if (currentUser) currentUser.online = false;
        } else {
            // Intentó desconectarse pero falló - mantener como estaba
            if (btn) {
                btn.classList.remove("bg-gray-500");
                btn.classList.add("bg-green-500", "hover:bg-green-600");
            }
            if (btnMobile) {
                btnMobile.classList.remove("bg-gray-500");
                btnMobile.classList.add("bg-green-500", "hover:bg-green-600");
            }
            if (span) span.innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
            if (spanMobile) spanMobile.innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
            isOnline = true;
            if (currentUser) currentUser.online = true;
        }
        
    } finally {
        window.togglingOnline = false;
    }
}

async function verHistorial() {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("Error de conexión", true);
        return;
    }
    
    mostrarToast("📊 Cargando historial...");
    
    try {
        const { data: completados, error } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .eq('estado', 'completado')
            .order('fecha_completado', { ascending: false });
        
        if (error) throw error;
        
        let totalGanado = 0;
        if (completados && completados.length > 0) {
            completados.forEach(p => { totalGanado += p.tarifa; });
        }
        
        // Eliminar modal existente
        let modalExistente = document.getElementById("modalHistorialDelivery");
        if (modalExistente) modalExistente.remove();
        
        const modal = document.createElement('div');
        modal.id = "modalHistorialDelivery";
        modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[100000] p-2";
        modal.style.overflowY = "auto";
        
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-2xl max-w-md w-full mx-2 my-4 overflow-hidden" style="max-height: 90vh; display: flex; flex-direction: column;">
                <!-- Cabecera compacta -->
                <div class="bg-orange-500 p-3 flex justify-between items-center sticky top-0 z-10">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-history text-white text-xl"></i>
                        <div>
                            <h3 class="font-bold text-white text-base">Mi Historial</h3>
                            <p class="text-white/70 text-xs">Entregas completadas</p>
                        </div>
                    </div>
                    <button onclick="cerrarModalHistorialDelivery()" class="bg-black/30 rounded-full w-8 h-8 flex items-center justify-center active:bg-black/50">
                        <i class="fas fa-times text-white text-sm"></i>
                    </button>
                </div>
                
                <!-- Lista de entregas - scrollable -->
                <div class="overflow-y-auto p-3" style="flex: 1;">
                    ${!completados || completados.length === 0 ? `
                        <div class="text-center text-gray-400 py-8">
                            <i class="fas fa-box-open text-4xl mb-2 block opacity-50"></i>
                            <p class="text-sm">No hay entregas</p>
                        </div>
                    ` : `
                        <div class="space-y-2">
                            ${completados.map(p => `
                                <div class="bg-gray-700 rounded-xl p-3">
                                    <div class="flex justify-between items-start mb-1">
                                        <div class="flex items-center gap-2">
                                            <span class="font-mono text-orange-400 text-xs font-bold">#${p.id.toString().slice(-8)}</span>
                                            <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">✅ Completo</span>
                                        </div>
                                        <span class="text-[10px] text-gray-400">${new Date(p.fecha_completado || p.fecha).toLocaleDateString()}</span>
                                    </div>
                                    
                                    <div class="flex items-start gap-1 my-1">
                                        <i class="fas fa-circle text-[8px] text-orange-500 mt-1"></i>
                                        <span class="text-xs text-gray-300 flex-1 line-clamp-1">${p.origen || 'Origen'}</span>
                                    </div>
                                    
                                    <div class="flex items-start gap-1 mb-1">
                                        <i class="fas fa-square text-[8px] text-blue-500 mt-1"></i>
                                        <span class="text-xs text-gray-300 flex-1 line-clamp-1">${p.destino || 'Destino'}</span>
                                    </div>
                                    
                                    <div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-600">
                                        <div class="flex gap-3">
                                            <span class="text-xs text-gray-400">📏 ${p.distancia_real} km</span>
                                            <span class="text-xs text-gray-400">💰 $${p.tarifa}</span>
                                        </div>
                                        <span class="text-[10px] text-gray-500 capitalize">${p.tipo || 'paquete'}</span>
                                    </div>
                                    
                                    <!-- ✅ BOTÓN ELIMINAR -->
                                    <button onclick="eliminarPedidoHistorial(${p.id})" 
                                        class="bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white px-2 py-1 rounded text-xs transition-all mt-2 w-full">
                                        <i class="fas fa-trash-alt mr-1"></i> Eliminar del historial
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
                
                <!-- Resumen fijo abajo -->
                <div class="border-t border-gray-700 p-3 bg-gray-800">
                    <div class="flex justify-between items-center bg-orange-500/10 rounded-xl p-2">
                        <div>
                            <span class="text-gray-400 text-xs">💰 Total ganado</span>
                            <div class="text-xl font-bold text-orange-500">$${totalGanado}</div>
                        </div>
                        <div class="text-right">
                            <span class="text-gray-400 text-xs">📦 Entregas</span>
                            <div class="text-xl font-bold text-white">${completados?.length || 0}</div>
                        </div>
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

// ==================== ELIMINAR PEDIDO DEL HISTORIAL (DELIVERY) ====================
async function eliminarPedidoHistorial(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("Error de conexión", true);
        return;
    }
    
    // ✅ 1. CERRAR MODAL DE HISTORIAL PRIMERO
    const modalHistorial = document.getElementById("modalHistorialDelivery");
    if (modalHistorial) {
        modalHistorial.remove();
    }
    
    // ✅ 2. Limpiar cualquier modal de confirmación existente
    const modalConfirmExistente = document.getElementById("modalConfirmacionEliminarDelivery");
    if (modalConfirmExistente) modalConfirmExistente.remove();
    
    // ✅ 3. Mensaje de confirmación
    const mensaje = `¿Estás seguro de que quieres eliminar el pedido #${pedidoId} del historial?\n\nEsta acción no afecta tus ganancias totales, solo elimina el registro.`;
    
    // ✅ 4. Crear modal de confirmación con z-index ALTÍSIMO
    const modalConfirm = document.createElement('div');
    modalConfirm.id = "modalConfirmacionEliminarDelivery";
    modalConfirm.className = "fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-[100000] p-4";
    modalConfirm.style.zIndex = "100000";
    
    modalConfirm.innerHTML = `
        <div class="bg-gray-800 rounded-3xl max-w-sm w-full text-center p-6 modal-uber" style="z-index: 100001;">
            <div class="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-trash-alt text-3xl text-red-500"></i>
            </div>
            <p class="text-gray-200 text-sm mb-6">${sanitizarHTML(mensaje)}</p>
            <div class="flex gap-3">
                <button id="btnCancelarEliminarDelivery" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl transition-all font-medium">
                    Cancelar
                </button>
                <button id="btnConfirmarEliminarDelivery" class="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl transition-all font-medium">
                    <i class="fas fa-trash-alt mr-2"></i> Eliminar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modalConfirm);
    
    // ✅ 5. Evento para confirmar eliminación
    document.getElementById("btnConfirmarEliminarDelivery").onclick = async () => {
        modalConfirm.remove();
        
        try {
            const { error } = await supabase
                .from('pedidos')
                .delete()
                .eq('id', pedidoId);
            
            if (error) throw error;
            
            mostrarToast(`🗑️ Pedido #${pedidoId} eliminado del historial`);
            
            // ✅ 6. Volver a abrir historial actualizado
            setTimeout(() => {
                verHistorial();
            }, 300);
            
        } catch(e) {
            console.error('Error eliminando:', e);
            mostrarToast("Error al eliminar el pedido", true);
            setTimeout(() => {
                verHistorial();
            }, 500);
        }
    };
    
    // ✅ 7. Evento para cancelar
    document.getElementById("btnCancelarEliminarDelivery").onclick = () => {
        modalConfirm.remove();
        setTimeout(() => {
            verHistorial();
        }, 100);
    };
    
    // ✅ 8. Cerrar si se hace clic fuera
    modalConfirm.addEventListener('click', (e) => {
        if (e.target === modalConfirm) {
            modalConfirm.remove();
            setTimeout(() => {
                verHistorial();
            }, 100);
        }
    });
}

function cerrarModalHistorialDelivery() {
    const modal = document.getElementById("modalHistorialDelivery");
    if (modal) modal.remove();
}

function verPerfil() {
    let modalExistente = document.getElementById("modalPerfilDelivery");
    if (modalExistente) modalExistente.remove();
    
    const modal = document.createElement('div');
    modal.id = "modalPerfilDelivery";
    modal.className = "fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-[100001] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-3xl max-w-sm w-full modal-uber">
            <div class="text-center pt-6 pb-3 border-b border-gray-700">
                <div class="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-3">
                    <i class="fas fa-user-circle text-white text-3xl"></i>
                </div>
                <h2 class="text-xl font-bold text-white">Mi Perfil</h2>
                <p class="text-gray-400 text-sm mt-1">Delivery Partner</p>
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
                            <span class="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full text-xs">Delivery</span>
                        </div>
                    </div>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3 flex items-center gap-3">
                    <i class="fas fa-star text-yellow-500 w-5"></i>
                    <div class="flex-1">
                        <div class="text-xs text-gray-400">Calificación</div>
                        <div class="text-white font-medium">
                            <span class="text-yellow-400">★★★★☆</span> 4.9
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="px-5 pb-5">
                <button onclick="cerrarModalPerfilDelivery()" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all">
                    Cerrar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

function cerrarModalPerfilDelivery() {
    const modal = document.getElementById("modalPerfilDelivery");
    if (modal) modal.remove();
}

// ==================== FUNCIÓN ACTUALIZAR ESTADÍSTICAS CORREGIDA ====================
async function actualizarEstadisticas() {
    const supabase = supabaseClient;
    if (!supabase || !currentUser) {
        console.log("❌ No se pueden actualizar estadísticas: supabase o usuario no disponible");
        return;
    }
    
    try {
        console.log("📊 Actualizando estadísticas para delivery:", currentUser.id);
        
        // Obtener todos los pedidos completados por este delivery
        const { data: completados, error } = await supabase
            .from('pedidos')
            .select('tarifa, estado')
            .eq('delivery_id', currentUser.id)
            .eq('estado', 'completado');
        
        if (error) throw error;
        
        const totalEntregas = completados?.length || 0;
        const totalGanado = completados?.reduce((sum, p) => sum + (p.tarifa || 0), 0) || 0;
        
        // Actualizar elementos del DOM
        const totalEntregasEl = document.getElementById("totalEntregas");
        const totalGanadoEl = document.getElementById("totalGanado");
        
        if (totalEntregasEl) {
            totalEntregasEl.innerText = sanitizarHTML(String(totalEntregas));
            console.log(`✅ Total entregas actualizado: ${sanitizarHTML(totalEntregas)}`);
        } else {
            console.warn("⚠️ Elemento totalEntregas no encontrado");
        }
        
        if (totalGanadoEl) {
            totalGanadoEl.innerText = sanitizarHTML(String(totalGanado));
            console.log(`✅ Total ganado actualizado: ${sanitizarHTML(totalGanado)}`);
        } else {
            console.warn("⚠️ Elemento totalGanado no encontrado");
        }
        
        // También actualizar calificación si quieres (simulada por ahora)
        const calificacionEl = document.getElementById("calificacion");
        if (calificacionEl) {
            // Podrías calcular calificación real desde una tabla 'calificaciones'
            calificacionEl.innerText = "4.9";
        }
        
    } catch(e) {
        console.error('❌ Error actualizando estadísticas:', e);
    }
}

// ==================== MODAL DE CONFIRMACIÓN ====================
function mostrarModalConfirmacionDelivery(titulo, mensaje, onConfirm, onCancel) {
    return new Promise((resolve) => {
        // Eliminar modal existente si hay
        const modalExistente = document.getElementById("modalConfirmacionDelivery");
        if (modalExistente) modalExistente.remove();
        
        const modal = document.createElement('div');
        modal.id = "modalConfirmacionDelivery";
        modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[100000] p-4";
        modal.innerHTML = `
            <div class="bg-gray-800 rounded-3xl max-w-sm w-full modal-uber text-center p-6">
                <div class="w-16 h-16 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="fas fa-motorcycle text-3xl text-orange-500"></i>
                </div>
                <h3 class="text-xl font-bold text-white mb-2">${sanitizarHTML(titulo)}</h3>
                <p class="text-gray-400 text-sm mb-6">${sanitizarHTML(mensaje)}</p>
                <div class="flex gap-3">
                    <button id="btnCancelarConfirm" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl transition-all font-medium">
                        Cancelar
                    </button>
                    <button id="btnAceptarConfirm" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl transition-all font-medium">
                        <i class="fas fa-hand-paper mr-2"></i>Aceptar
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById("btnAceptarConfirm").onclick = () => {
            modal.remove();
            if (onConfirm) onConfirm();
            resolve(true);  // ✅ IMPORTANTE: resolver la Promise
        };
        
        document.getElementById("btnCancelarConfirm").onclick = () => {
            modal.remove();
            if (onCancel) onCancel();
            resolve(false); // ✅ IMPORTANTE: resolver la Promise
        };
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                if (onCancel) onCancel();
                resolve(false);
            }
        });
    });
}

// En delivery.js, modificar actualizarColorMarcador()
async function actualizarColorMarcador() {
    if (!userMarker || !currentUser) return;
    
    const tienePedido = await deliveryTienePedidoActivo(currentUser.id);
    const isDarkMode = document.body.classList.contains('dark-mode');
    
    let color;
    let estadoTexto;
    
    if (tienePedido) {
        color = '#FF6200'; // Naranja - visible en ambos modos
        estadoTexto = '🟠 En una entrega';
    } else {
        color = '#10B981'; // Verde
        estadoTexto = '🟢 Disponible';
    }
    
    // Ajustar color del texto según modo oscuro
    const textBg = isDarkMode ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0.85)';
    const borderColor = isDarkMode ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)';
    
    const nombreMostrar = obtenerPrimerNombre(currentUser.nombre);
    
    const nuevoIcono = L.divIcon({
        html: `
            <div style="text-align: center;">
                <div style="
                    background: ${textBg};
                    color: white;
                    font-size: 11px;
                    font-weight: bold;
                    padding: 3px 8px;
                    border-radius: 14px;
                    margin-bottom: 4px;
                    white-space: nowrap;
                    display: inline-block;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                    border: 0.5px solid ${borderColor};
                ">
                    ${sanitizarHTML(nombreMostrar)}
                </div>
                <div style="
                    background: ${color};
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
        className: 'moto-marker',
        popupAnchor: [0, -25]
    });
    
    userMarker.setIcon(nuevoIcono);
    userMarker.setPopupContent(`🏍️ <b>${sanitizarHTML(currentUser.nombre)}</b><br>${estadoTexto}`);
}

async function actualizarEstadoYColor() { await actualizarColorMarcador();}

// ==================== LIMPIAR RECURSOS AL CERRAR PESTAÑA (DELIVERY) ====================
function limpiarIntervalosDelivery() {
    console.log("🧹 Limpiando todos los recursos del delivery...");

    // Limpiar intervalos principales
    if (ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
        console.log("✅ ubicacionInterval limpiado");
    }
    
    if (cargaPedidosInterval) {
        clearInterval(cargaPedidosInterval);
        cargaPedidosInterval = null;
        console.log("✅ cargaPedidosInterval limpiado");
    }

    // ✅ NUEVO: Limpiar backup interval (para pantalla bloqueada)
    if (backupIntervalId) {
        clearInterval(backupIntervalId);
        backupIntervalId = null;
        console.log("✅ backupIntervalId limpiado");
    }

    // Limpiar geolocalización (watchPosition)
    if (watchId) {
        try {
            navigator.geolocation.clearWatch(watchId);
            console.log("✅ watchId limpiado");
        } catch (e) {
            console.warn("Error al limpiar watchPosition:", e);
        }
        watchId = null;
    }

    // ✅ NUEVO: Limpiar animación smooth (requestAnimationFrame)
    if (smoothAnimationFrame) {
        cancelAnimationFrame(smoothAnimationFrame);
        smoothAnimationFrame = null;
        console.log("✅ smoothAnimationFrame limpiado");
    }

    // Limpiar rutas y marcadores del mapa
    limpiarRutasYMarcadores();
    // Detener actualización de ruta en tiempo real
    detenerActualizacionRutaTiempoReal();

    // Actualizar estado offline en Supabase
    if (currentUser && supabaseClient) {
        // Marcar como offline al cerrar
        setDeliveryOnlineSupabase(currentUser.id, false)
            .catch(err => console.warn("No se pudo actualizar estado offline:", err));

        // Guardar última ubicación como offline
        if (userMarker && typeof userMarker.getLatLng === 'function') {
            try {
                const coords = userMarker.getLatLng();
                if (coords) {
                    guardarUbicacionEnSupabase(
                        currentUser.id, 
                        currentUser.nombre, 
                        coords.lat, 
                        coords.lng, 
                        false
                    ).catch(err => console.warn("Error guardando última ubicación:", err));
                }
            } catch (e) {
                console.warn("Error obteniendo coords del marcador:", e);
            }
        }
    }

    // Resetear variables de smooth tracking
    posicionActual = null;
    posicionDestino = null;
    anguloActual = 0;

    console.log("✅ Todos los recursos de delivery liberados correctamente");
}

// ==================== EVENTOS DE CIERRE DE PÁGINA ====================

// Limpieza al intentar cerrar/recargar la pestaña
window.addEventListener('beforeunload', function(e) {
    console.log("🚪 Delivery: pestaña cerrando o recargando...");
    limpiarIntervalosDelivery();
});

// Mejor alternativa moderna a 'unload'
window.addEventListener('pagehide', function() {
    console.log("💀 Delivery: página ocultada o descargada (pagehide)");
    limpiarIntervalosDelivery();
});

// Opcional: Visibilidad de la página (muy útil)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log("📴 Delivery: pestaña en segundo plano");
        // Aquí podrías pausar algunos intervalos menos críticos
    } else {
        console.log("🟢 Delivery: pestaña visible nuevamente");
        if (isOnline) {
            // Reactivar actualizaciones
            cargarPedidos();
        }
    }
});

// ==================== ROTACIÓN DEL MAPA (2D) ====================
function rotateMapLeft() {
    if (!map) return;
    mapRotationAngle = (mapRotationAngle - 45) % 360;
    applyMapRotationDelivery();
    mostrarToast(`🧭 Mapa girado ${sanitizarHTML(mapRotationAngle)}°`);
}

function rotateMapRight() {
    if (!map) return;
    mapRotationAngle = (mapRotationAngle + 45) % 360;
    applyMapRotationDelivery();
    mostrarToast(`🧭 Mapa girado ${sanitizarHTML(mapRotationAngle)}°`);
}

function resetMapRotation() {
    if (!map) return;
    mapRotationAngle = 0;
    applyMapRotationDelivery();
    mostrarToast("🧭 Orientación restablecida");
}

function applyMapRotationDelivery() {
    const mapContainer = map.getContainer();
    const currentCenter = map.getCenter();
    
    mapContainer.style.transform = `rotate(${sanitizarHTML(mapRotationAngle)}deg)`;
    mapContainer.style.transition = 'transform 0.4s ease';
    
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
    if (userMarker && typeof userMarker.setRotationAngle === 'function') {
        userMarker.setRotationAngle(mapRotationAngle);
    }
    if (recogidaMarker && typeof recogidaMarker.setRotationAngle === 'function') {
        recogidaMarker.setRotationAngle(mapRotationAngle);
    }
    if (destinoMarker && typeof destinoMarker.setRotationAngle === 'function') {
        destinoMarker.setRotationAngle(mapRotationAngle);
    }
    
    setTimeout(() => {
        map.invalidateSize();
        map.setView(currentCenter);
    }, 80);
}

// Calcular velocidad aproximada entre dos puntos
let ultimaPosicionZoom = null;
let ultimoTiempoZoom = null;

function calcularVelocidadAproximada(lat, lng) {
    if (!ultimaPosicionZoom || !ultimoTiempoZoom) {
        ultimaPosicionZoom = { lat, lng };
        ultimoTiempoZoom = Date.now();
        return 0;
    }
    
    // Calcular distancia en km
    const distancia = calcularDistanciaEntrePuntos(
        { lat: ultimaPosicionZoom.lat, lng: ultimaPosicionZoom.lng },
        { lat, lng }
    );
    
    // Calcular tiempo en horas
    const tiempoHoras = (Date.now() - ultimoTiempoZoom) / 3600000;
    
    // Velocidad en km/h
    let velocidad = tiempoHoras > 0 ? distancia / tiempoHoras : 0;
    
    // Actualizar para próxima vez
    ultimaPosicionZoom = { lat, lng };
    ultimoTiempoZoom = Date.now();
    
    // Limitar a máximo 120 km/h (evita picos)
    return Math.min(velocidad, 120);
}

function actualizarRotacionMarcadores() {
    if (userMarker && typeof userMarker.setRotationAngle === 'function') {
        userMarker.setRotationAngle(mapRotationAngle);
    }
    if (recogidaMarker && typeof recogidaMarker.setRotationAngle === 'function') {
        recogidaMarker.setRotationAngle(mapRotationAngle);
    }
    if (destinoMarker && typeof destinoMarker.setRotationAngle === 'function') {
        destinoMarker.setRotationAngle(mapRotationAngle);
    }
}

// ==================== EXPORTAR FUNCIONES GLOBALMENTE ====================
window.centrarMapa = centrarMapa;
window.rotateMapLeft = rotateMapLeft;
window.rotateMapRight = rotateMapRight;
window.resetMapRotation = resetMapRotation;
window.toggleOnline = toggleOnline;
window.toggleDarkMode = toggleDarkMode;
window.verHistorial = verHistorial;
window.verPerfil = verPerfil;
window.cerrarSesion = cerrarSesion;
window.seleccionarPedido = seleccionarPedido;
window.agarrarPedido = agarrarPedido;
window.marcarPaqueteRecogido = marcarPaqueteRecogido;
window.completarPedido = completarPedido;
window.cerrarModalHistorialDelivery = cerrarModalHistorialDelivery;
window.mostrarModalConfirmacionDelivery = mostrarModalConfirmacionDelivery; // ← Mantener exportación
window.cerrarModalPerfilDelivery = cerrarModalPerfilDelivery;
window.limpiarIntervalosDelivery = limpiarIntervalosDelivery;
window.notificarNuevoPedido = notificarNuevoPedido;
// Exportar funciones
window.toggleAutoFollow = toggleAutoFollow;
window.toggleZoomDinamico = toggleZoomDinamico;
window.centrarEnMiUbicacion = centrarEnMiUbicacion;
window.eliminarPedidoHistorial = eliminarPedidoHistorial;
window.mostrarModalNuevoPedidoUrgente = mostrarModalNuevoPedidoUrgente;
window.reproducirSonidoUrgente = reproducirSonidoUrgente;