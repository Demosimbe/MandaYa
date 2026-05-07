// Constantes y variables globales
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

let map, userMarker, routeLine;
let currentUser = null, isOnline = false;
let pedidosDisponibles = [], misPedidosActivos = [];
let pedidoSeleccionado = null;
let watchId = null;
let ubicacionInterval = null;
let cargaPedidosInterval = null;

// ==================== NUEVAS VARIABLES PARA RUTAS ====================
let currentRoutingControl = null;  // Control de ruta actual
let recogidaMarker = null;         // Marcador del punto de recogida (origen)
let destinoMarker = null;          // Marcador del punto de destino
let ultimoPedidoDibujado = null;
let ultimaEtapa = null;
let dibujandoRuta = false;
let ultimaPeticionPedidos = 0;
// ==================== CONTROL DE PETICIONES INTELIGENTE ====================
let paginaVisible = true;

document.addEventListener('visibilitychange', () => {
    paginaVisible = !document.hidden;
    if (paginaVisible) {
        console.log("🟢 Página visible - Reactivando actualizaciones");
        if (isOnline) cargarPedidos();
    } else {
        console.log("🔴 Página oculta - Reduciendo actualizaciones");
    }
});
// ==================== FIN OPTIMIZACIÓN ====================

// ==================== INICIALIZACIÓN ====================
function initMap() {
    const cdDelCarmen = { lat: 18.6456, lng: -91.8249 };
    
    map = L.map('map').setView([cdDelCarmen.lat, cdDelCarmen.lng], 13);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CartoDB',
        maxZoom: 18,
        subdomains: 'abcd'
    }).addTo(map);
    
    limitarMapaACarmen(map);
    
    startLocationTracking();
    cargarPedidos();
    
    if(cargaPedidosInterval) clearInterval(cargaPedidosInterval);
    
    cargaPedidosInterval = setInterval(() => { 
        if(isOnline) cargarPedidos(); 
    },  5000);
}

function loadUser() {
    const sesion = localStorage.getItem('sesion_activa');
    if(!sesion) { window.location.href = "index.html"; return; }
    currentUser = JSON.parse(sesion);
    if(currentUser.rol !== 'delivery') { window.location.href = "cliente.html"; return; }
    isOnline = currentUser.online === true;
    
    // ✅ HTML con espacio para el badge de estado
    document.getElementById("userInfo").innerHTML = `
        <div class="flex items-center gap-2">
            <i class="fas fa-motorcycle text-[#FF6200] text-xl"></i>
            <span class="font-medium">${currentUser.nombre}</span>
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
        setTimeout(() => actualizarColorMarcador(), 1000);
    }
    cargarPedidos();
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
    if (currentRoutingControl) {
        try { 
            map.removeControl(currentRoutingControl); 
        } catch(e) {}
        currentRoutingControl = null;
    }
    
    if (recogidaMarker) {
        map.removeLayer(recogidaMarker);
        recogidaMarker = null;
    }
    
    if (destinoMarker) {
        map.removeLayer(destinoMarker);
        destinoMarker = null;
    }
}

// ==================== RUTA DE RECOGIDA (delivery -> origen) ====================
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
    recogidaMarker.bindPopup(`<b>📍 RECOGER AQUÍ</b><br>${pedido.origen}`).openPopup();
    
    mostrarToast(`📍 Ruta de RECOGIDA - Dirígete a: ${pedido.origen}`);
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
    destinoMarker.bindPopup(`<b>🏁 ENTREGAR AQUÍ</b><br>${pedido.destino}`).openPopup();
    
    mostrarToast(`🚚 Ruta de ENTREGA - Desde ${pedido.origen} hasta ${pedido.destino}`);
    
    // ✅ Opcional: cerrar popup después de 5 segundos
    setTimeout(() => {
        if (destinoMarker) destinoMarker.closePopup();
    }, 5000);
}

// ==================== MARCAR PAQUETE COMO RECOGIDO ====================
async function marcarPaqueteRecogido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    // ✅ 1. Mostrar loading feedback
    mostrarToast("📦 Actualizando estado del paquete...");
    
    try {
        // ✅ 2. Actualizar en Supabase
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'recogido',
                paquete_recogido_en: new Date().toISOString()
            })
            .eq('id', pedidoId);
        
        if (error) throw error;
        
        mostrarToast(`✅ ¡Paquete #${pedidoId} RECOGIDO! Ahora dirígete al destino.`);
        
        // ✅ 3. Recargar pedidos y ESPERAR a que termine
        await cargarPedidos();
        
        // ✅ 4. Buscar el pedido actualizado en misPedidosActivos
        // Pequeño delay para asegurar que el estado se actualizó
        setTimeout(async () => {
            const pedidoActualizado = misPedidosActivos.find(p => p.id === pedidoId);
            
            if (pedidoActualizado && pedidoActualizado.estado === 'recogido') {
                // ✅ 5. Dibujar ruta de ENTREGA
                await dibujarRutaEntrega(pedidoActualizado);
                
                // ✅ 6. Actualizar color del marcador del delivery (ahora ocupado)
                await actualizarColorMarcador();
                
                // ✅ 7. Mostrar popup con instrucciones
                if (userMarker) {
                    userMarker.bindPopup(`🏍️ <b>${currentUser.nombre}</b><br>📦 En camino a ENTREGAR`).openPopup();
                    setTimeout(() => userMarker.closePopup(), 3000);
                }
            } else {
                console.error("❌ No se encontró el pedido actualizado", pedidoId);
                mostrarToast("⚠️ El pedido se actualizó, pero no se pudo dibujar la ruta", true);
            }
        }, 500);
        
    } catch(e) {
        console.error('Error marcando paquete recogido:', e);
        mostrarToast("❌ Error al registrar la recogida: " + (e.message || "Verifica tu conexión"), true);
    }
}

function startLocationTracking() {
    if("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(
            async (pos) => {
                const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                
                if(userMarker) {
                    // ✅ Solo actualizar la posición del marcador, NO redibujar la ruta
                    userMarker.setLatLng(coords);
                    // ❌ ELIMINADO: bloque que redibujaba la ruta constantemente
                } else {
                    userMarker = crearMarcadorDelivery(
                        coords.lat, 
                        coords.lng, 
                        currentUser.nombre, 
                        '#10B981'
                    );
                    userMarker.addTo(map);
                    userMarker.bindPopup(`🏍️ <b>${currentUser.nombre}</b><br>🟢 Disponible`);
                }
                
                if(currentUser && isOnline) {
                    localStorage.setItem(`ubicacion_${currentUser.id}`, JSON.stringify(coords));
                    
                    if (typeof guardarUbicacionEnSupabase !== 'undefined') {
                        await guardarUbicacionEnSupabase(
                            currentUser.id,
                            currentUser.nombre,
                            coords.lat,
                            coords.lng,
                            true
                        );
                        console.log('✅ Ubicación guardada en Supabase:', coords);
                    }
                }
            },
            (err) => {
                console.error(err);
                mostrarToast("⚠️ No se pudo obtener tu ubicación", true);
            },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
        );
    } else {
        mostrarToast("⚠️ Tu navegador no soporta geolocalización", true);
    }
}

function centrarMapa() {
    if(map) map.setView([18.6456, -91.8249], 13);
    mostrarToast("📍 Mapa centrado en Ciudad del Carmen");
}

async function cargarPedidos() {
    // ✅ THROTTLING: Verificar visibilidad
    if (!paginaVisible) {
        console.log("📴 Página oculta, no se cargan pedidos");
        return;
    }
    
    // ✅ THROTTLING: Mínimo 5 segundos entre peticiones
    const ahora = Date.now();
    if (ahora - ultimaPeticionPedidos < 5000) {
        console.log(`⏳ Throttling: cargarPedidos - demasiado rápido (${ahora - ultimaPeticionPedidos}ms desde última)`);
        return;
    }
    ultimaPeticionPedidos = ahora;
    
    const supabase = supabaseClient;
    if (!supabase) {
        console.error('Supabase no disponible');
        return;
    }
    
    try {
        // ✅ Cargar pedidos pendientes
        const { data: pedidosPendientes, error: errorPendientes } = await supabase
            .from('pedidos')
            .select('*')
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: true });
        
        if (errorPendientes) throw errorPendientes;
        
        // ✅ Cargar pedidos asignados a este delivery
        const { data: pedidosAsignados, error: errorAsignados } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .in('estado', ['asignado', 'recogido'])
            .order('fecha', { ascending: true });
        
        if (errorAsignados) throw errorAsignados;
        
        // ✅ Convertir pedidos
        const nuevosDisponibles = (pedidosPendientes || []).map(p => convertirPedidoDeSupabase(p));
        const nuevosActivos = (pedidosAsignados || []).map(p => convertirPedidoDeSupabase(p));
        
        // ✅ Guardar estado anterior para detectar cambios
        const estadoAnteriorActivo = misPedidosActivos.length > 0 ? misPedidosActivos[0]?.estado : null;
        
        pedidosDisponibles = nuevosDisponibles;
        misPedidosActivos = nuevosActivos;
        
        // ✅ Actualizar UI
        actualizarListaPedidos();
        
        // ✅ Manejar cambios de estado para rutas
        if (misPedidosActivos.length > 0) {
            const pedidoActivo = misPedidosActivos[0];
            const estadoActual = pedidoActivo.estado;
            
            if (estadoAnteriorActivo === 'asignado' && estadoActual === 'recogido') {
                console.log("🔄 Estado cambiado: asignado → recogido. Dibujando ruta de entrega...");
                await dibujarRutaEntrega(pedidoActivo);
            }
            else if (estadoActual === 'recogido' && (!currentRoutingControl || ultimaEtapa !== 'entrega')) {
                console.log("🟠 Pedido en estado recogido, dibujando ruta de entrega...");
                await dibujarRutaEntrega(pedidoActivo);
            }
            else if (estadoActual === 'asignado' && (!currentRoutingControl || ultimaEtapa !== 'recogida')) {
                console.log("🟢 Pedido asignado, dibujando ruta de recogida...");
                await dibujarRutaRecogida(pedidoActivo);
            }
        } else {
            limpiarRutasYMarcadores();
            if (pedidoSeleccionado) {
                dibujarRutaOptimaPedido(pedidoSeleccionado);
            }
        }
        
        // ✅ Actualizar color del marcador y badge
        await actualizarColorMarcador();
        await actualizarBadgeEstado();
        
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
    mostrarToast(`📍 Pedido #${pedidoId} seleccionado - Ruta mostrada en mapa`);
}

async function dibujarRutaOptimaPedido(pedido) {
    limpiarRutasYMarcadores();
    
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
        
        mostrarToast(`📏 Distancia: ${pedido.distanciaReal} km • 💰 $${pedido.tarifa}`);
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
    
    // ✅ VERIFICACIÓN 1: ¿El delivery ya tiene un pedido activo?
    mostrarToast("🔍 Verificando disponibilidad...");
    
    try {
        // Usar la función de config.js
        const tienePedidoActivo = await deliveryTienePedidoActivo(currentUser.id);
        
        if (tienePedidoActivo) {
            const pedidoActivo = await getPedidoActivoDelDelivery(currentUser.id);
            mostrarToast(`❌ Ya tienes un pedido activo (#${pedidoActivo?.id}). Complétalo primero.`, true);
            
            // Resaltar el pedido activo en la lista
            if (pedidoActivo) {
                const elementoActivo = document.querySelector(`[data-pedido-id="${pedidoActivo.id}"]`);
                if (elementoActivo) {
                    elementoActivo.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    elementoActivo.style.border = '2px solid #FF6200';
                    setTimeout(() => {
                        elementoActivo.style.border = '';
                    }, 3000);
                }
            }
            return;
        }
        
        // ✅ VERIFICACIÓN 2: ¿El pedido sigue disponible (estado pendiente)?
        const { data: pedidoActual, error: errorPedido } = await supabase
            .from('pedidos')
            .select('estado')
            .eq('id', pedidoId)
            .single();
        
        if (errorPedido) throw errorPedido;
        
        if (pedidoActual.estado !== 'pendiente') {
            mostrarToast(`❌ El pedido #${pedidoId} ya no está disponible (fue agarrado por otro delivery)`, true);
            await cargarPedidos(); // Recargar lista
            return;
        }
        
        // ✅ VERIFICACIÓN 3: Confirmar con el usuario (opcional pero recomendado)
        const confirmar = confirm(`¿Seguro que quieres AGARRAR el pedido #${pedidoId}?`);
        if (!confirmar) {
            mostrarToast("❌ Acción cancelada");
            return;
        }
        
        // ✅ AGARRAR EL PEDIDO
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'asignado',
                delivery_id: currentUser.id,
                delivery_nombre: currentUser.nombre,
                fecha_asignado: new Date().toISOString()
            })
            .eq('id', pedidoId)
            .eq('estado', 'pendiente'); // Doble verificación: solo si sigue pendiente
        
        if (error) throw error;
        
        mostrarToast(`✅ Pedido #${pedidoId} AGARRADO! Dirígete al origen para recoger.`);
        
        // ✅ Limpiar selección y recargar
        pedidoSeleccionado = null;
        await cargarPedidos();
        await actualizarColorMarcador();
        
        // ✅ Mostrar ruta de recogida inmediatamente
        const pedidoAsignado = misPedidosActivos.find(p => p.id === pedidoId);
        if (pedidoAsignado) {
            await dibujarRutaRecogida(pedidoAsignado);
            // Centrar mapa en la ruta
            setTimeout(() => {
                if (pedidoAsignado.origenCoords) {
                    map.setView([pedidoAsignado.origenCoords.lat, pedidoAsignado.origenCoords.lng], 14);
                }
            }, 500);
        }

    } catch(e) {
        console.error('Error agarrando pedido:', e);
        mostrarToast("❌ Error al agarrar el pedido: " + (e.message || "Intenta de nuevo"), true);
    }
}

async function completarPedido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
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
        
        mostrarToast(`✅ Pedido #${pedidoId} ENTREGADO! Ganaste $${pedido?.tarifa || 0} MXN`);
        
        limpiarRutasYMarcadores();
        
        await cargarPedidos();
        await actualizarColorMarcador();
        
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
            <div class="bg-white border rounded-xl p-4 shadow-sm pedido-card ${pedidoSeleccionado?.id === p.id ? 'pedido-seleccionado' : ''}" onclick="seleccionarPedido(${p.id})">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-bold text-[#FF6200]">#${p.id}</span>
                    <span class="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">Pendiente</span>
                </div>
                <p class="text-sm"><i class="fas fa-circle text-[#FF6200] text-xs mr-1"></i> ${p.origen}</p>
                <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> ${p.destino}</p>
                <p class="text-xs text-gray-500 mt-2">📏 ${p.distanciaReal} km • 💰 $${p.tarifa}</p>
                <p class="text-xs text-gray-500">👤 Cliente: ${p.clienteNombre}</p>
                ${tienePedidoActivo ? 
                    `<button disabled class="w-full mt-3 bg-gray-400 cursor-not-allowed text-white py-2 rounded-lg text-sm font-medium transition-all">
                        <i class="fas fa-lock mr-1"></i> Completar pedido actual primero
                    </button>` :
                    `<button onclick="event.stopPropagation(); agarrarPedido(${p.id})" class="w-full mt-3 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
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
            <div class="bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm" data-pedido-id="${p.id}">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-bold text-[#FF6200]">#${p.id}</span>
                    <span class="text-xs px-2 py-1 rounded-full ${esRecogido ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}">
                        ${esRecogido ? '📦 Paquete recogido' : '🟡 En camino a recoger'}
                    </span>
                </div>
                <p class="text-sm"><i class="fas fa-circle text-green-500 text-xs mr-1"></i> <strong>Recoger en:</strong> ${p.origen}</p>
                <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> <strong>Entregar en:</strong> ${p.destino}</p>
                <p class="text-xs text-gray-500 mt-2">📏 ${p.distanciaReal} km • 💰 $${p.tarifa}</p>
                <p class="text-xs text-gray-500">👤 Cliente: ${p.clienteNombre}</p>
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

async function toggleOnline() {
    isOnline = !isOnline;
    const btn = document.getElementById("onlineToggle");
    const span = document.getElementById("onlineStatusText");
    
    if(isOnline) {
        btn.classList.remove("bg-gray-500");
        btn.classList.add("bg-green-500", "hover:bg-green-600");
        span.innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
        mostrarToast("✅ Estás en línea - Los clientes verán que estás disponible");
        
        if(currentUser) {
            currentUser.online = true;
            localStorage.setItem('sesion_activa', JSON.stringify(currentUser));
            
            await setDeliveryOnlineSupabase(currentUser.id, true);
            
            if (userMarker) {
                const coords = userMarker.getLatLng();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, true);
            }
        }
        cargarPedidos();
        
        if(ubicacionInterval) clearInterval(ubicacionInterval);
        ubicacionInterval = setInterval(async () => {
            if(userMarker && currentUser && isOnline) {
                const coords = userMarker.getLatLng();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, true);
            }
        }, 3000);
    } else {
        btn.classList.remove("bg-green-500", "hover:bg-green-600");
        btn.classList.add("bg-gray-500");
        span.innerHTML = 'Conectarse';
        mostrarToast("📴 Estás offline - No recibirás pedidos");
        
        if(currentUser) {
            currentUser.online = false;
            localStorage.setItem('sesion_activa', JSON.stringify(currentUser));
            
            await setDeliveryOnlineSupabase(currentUser.id, false);
            
            if (userMarker) {
                const coords = userMarker.getLatLng();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, false);
            }
        }
        if(ubicacionInterval) clearInterval(ubicacionInterval);
    }
    await actualizarColorMarcador();
}

async function verHistorial() {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("Error de conexión", true);
        return;
    }
    
    try {
        const { data: completados, error } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .eq('estado', 'completado');
        
        if (error) throw error;
        
        if(!completados || completados.length === 0) {
            mostrarToast("No tienes entregas completadas");
        } else {
            let total = 0;
            let msg = "✅ Entregas completadas:\n";
            completados.forEach(p => { 
                total += p.tarifa; 
                msg += `• #${p.id}: ${p.distancia_real}km - $${p.tarifa}\n`;
            });
            msg += `\n💰 Total ganado: $${total} MXN`;
            alert(msg);
        }
    } catch(e) {
        console.error('Error:', e);
        mostrarToast("Error al cargar historial", true);
    }
}

function verPerfil() { 
    alert(`👤 ${currentUser?.nombre}\n📧 ${currentUser?.email}\n🏍️ Delivery`); 
}

function cerrarSesion() { 
    if(watchId) navigator.geolocation.clearWatch(watchId);
    
    if(ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
    }

    if(cargaPedidosInterval) {
        clearInterval(cargaPedidosInterval);
        cargaPedidosInterval = null;
    }
    
    limpiarRutasYMarcadores();
    
    if(currentUser && typeof guardarUbicacionEnSupabase !== 'undefined' && userMarker) {
        const coords = userMarker.getLatLng();
        guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, false);
    }
    
    if(confirm("¿Cerrar sesión?")){ 
        localStorage.removeItem('sesion_activa'); 
        window.location.href = "index.html"; 
    } 
}

async function actualizarColorMarcador() {
    if (!userMarker || !currentUser) return;
    
    const tienePedido = await tienePedidoActivo(currentUser.id);
    
    let color;
    let estadoTexto;
    
    if (tienePedido) {
        color = '#FF6200';
        estadoTexto = '🟠 En una entrega';
    } else {
        color = '#10B981';
        estadoTexto = '🟢 Disponible';
    }
    
    const nombreMostrar = obtenerPrimerNombre(currentUser.nombre);
    
    const nuevoIcono = L.divIcon({
        html: `
            <div style="text-align: center;">
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
    userMarker.setPopupContent(`🏍️ <b>${currentUser.nombre}</b><br>${estadoTexto}`);
    
    console.log(`🎨 Marcador actualizado: ${tienePedido ? 'NARANJA' : 'VERDE'} - ${nombreMostrar}`);
}

async function actualizarEstadoYColor() {
    await actualizarColorMarcador();
}

function mostrarToast(msg, err=false){ 
    const t=document.createElement('div'); 
    t.className='toast-message'; 
    t.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: ${err ? 'linear-gradient(135deg, #dc2626, #ef4444)' : 'linear-gradient(135deg, #10b981, #059669)'};
        color: white;
        padding: 14px 28px;
        border-radius: 50px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transition: all 0.3s ease;
    `;
    t.innerHTML = `<i class="fas ${err ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i> ${msg}`;
    document.body.appendChild(t);
    
    setTimeout(() => {
        t.style.transform = 'translateX(-50%) translateY(0)';
        t.style.opacity = '1';
    }, 10);
    
    setTimeout(() => {
        t.style.transform = 'translateX(-50%) translateY(20px)';
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

window.onload = () => { 
    loadUser(); 
    initMap();
};