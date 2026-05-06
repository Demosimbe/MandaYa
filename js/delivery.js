// Constantes y variables globales
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

let map, userMarker, routeLine;
let currentUser = null, isOnline = false;
let pedidosDisponibles = [], misPedidosActivos = [];
let pedidoSeleccionado = null;
let watchId = null;
let ubicacionInterval = null;
let cargaPedidosInterval = null;

// ==================== INICIALIZACIÓN ====================
function initMap() {
    const cdDelCarmen = { lat: 18.6456, lng: -91.8249 };
    
    map = L.map('map').setView([cdDelCarmen.lat, cdDelCarmen.lng], 13);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
        maxZoom: 15
    }).addTo(map);
    
    // ✅ Limitar mapa a Ciudad del Carmen
    limitarMapaACarmen(map);
    
    startLocationTracking();
    cargarPedidos();
    
    // ✅ Limpiar intervalo anterior si existe (por si se llama initMap varias veces)
    if(cargaPedidosInterval) clearInterval(cargaPedidosInterval);
    
    // ✅ Crear nuevo intervalo para recargar pedidos cada 5 segundos
    cargaPedidosInterval = setInterval(() => { 
        if(isOnline) cargarPedidos(); 
    }, 5000);
}

function loadUser() {
    const sesion = localStorage.getItem('sesion_activa');
    if(!sesion) { window.location.href = "index.html"; return; }
    currentUser = JSON.parse(sesion);
    if(currentUser.rol !== 'delivery') { window.location.href = "cliente.html"; return; }
    isOnline = currentUser.online === true;
    document.getElementById("userInfo").innerHTML = `<div class="flex items-center gap-2"><i class="fas fa-motorcycle text-[#FF6200] text-xl"></i><span class="font-medium">${currentUser.nombre}</span><span class="text-gray-400 text-xs">(Delivery)</span></div><div class="text-xs text-gray-500 mt-1"><i class="fas fa-star text-yellow-500"></i> Calificación: 4.9</div>`;
    if(isOnline) {
        document.getElementById("onlineToggle").classList.remove("bg-gray-500");
        document.getElementById("onlineToggle").classList.add("bg-green-500");
        document.getElementById("onlineStatusText").innerHTML = '<i class="fas fa-circle online-dot mr-1"></i> En línea';
    }
    cargarPedidos();
}

function startLocationTracking() {
    if("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(
            async (pos) => {
                const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                
                if(userMarker) {
                    userMarker.setLatLng(coords);
                } else {
                    const motoIcon = getMotoIcon();
                    userMarker = L.marker(coords, { icon: motoIcon }).addTo(map).bindPopup('🏍️ <b>Tu ubicación</b><br>Visible para los clientes');
                }
                
                if(currentUser && isOnline) {
                    // Guardar en localStorage
                    localStorage.setItem(`ubicacion_${currentUser.id}`, JSON.stringify(coords));
                    
                    // Guardar en Supabase
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
    // ✅ Cargar desde Supabase en lugar de localStorage
    const supabase = supabaseClient;
    if (!supabase) {
        console.error('Supabase no disponible');
        return;
    }
    
    try {
        // Obtener pedidos PENDIENTES de Supabase
        const { data: pedidosPendientes, error: errorPendientes } = await supabase
            .from('pedidos')
            .select('*')
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: true });
        
        if (errorPendientes) throw errorPendientes;
        
        // Obtener pedidos ASIGNADOS a este delivery
        const { data: pedidosAsignados, error: errorAsignados } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', currentUser?.id)
            .in('estado', ['asignado']);
        
        if (errorAsignados) throw errorAsignados;
        
        // Convertir formato de Supabase al que usa la interfaz
        pedidosDisponibles = (pedidosPendientes || []).map(p => convertirPedidoDeSupabase(p));
        misPedidosActivos = (pedidosAsignados || []).map(p => convertirPedidoDeSupabase(p));
        
        actualizarListaPedidos();
        dibujarRutaSeleccionada();
        
        console.log(`📦 ${pedidosDisponibles.length} pedidos disponibles, ${misPedidosActivos.length} activos`);
        
    } catch(e) {
        console.error('Error cargando pedidos:', e);
    }
}

function actualizarListaPedidos() {
    const containerDisponibles = document.getElementById("pedidosDisponibles");
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
                <button onclick="event.stopPropagation(); agarrarPedido(${p.id})" class="w-full mt-3 bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
                    <i class="fas fa-hand-paper mr-1"></i> AGARRAR PEDIDO
                </button>
            </div>
        `).join('');
    }
    
    const containerActivos = document.getElementById("pedidosActivos");
    if(misPedidosActivos.length === 0) {
        containerActivos.innerHTML = '<div class="text-center text-gray-400 py-4"><i class="fas fa-check-circle text-2xl mb-1 block"></i>No hay pedidos activos</div>';
    } else {
        containerActivos.innerHTML = misPedidosActivos.map(p => `
            <div class="bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-bold text-[#FF6200]">#${p.id}</span>
                    <span class="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">En curso</span>
                </div>
                <p class="text-sm"><i class="fas fa-circle text-[#FF6200] text-xs mr-1"></i> ${p.origen}</p>
                <p class="text-sm mt-1"><i class="fas fa-square text-blue-600 text-xs mr-1"></i> ${p.destino}</p>
                <p class="text-xs text-gray-500 mt-2">📏 ${p.distanciaReal} km • 💰 $${p.tarifa}</p>
                <button onclick="completarPedido(${p.id})" class="w-full mt-3 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg text-sm font-medium transition-all">
                    <i class="fas fa-check-circle mr-1"></i> COMPLETAR ENTREGA
                </button>
            </div>
        `).join('');
    }
}

function seleccionarPedido(pedidoId) {
    pedidoSeleccionado = pedidosDisponibles.find(p => p.id === pedidoId);
    dibujarRutaSeleccionada();
    actualizarListaPedidos();
    mostrarToast(`📍 Pedido #${pedidoId} seleccionado - Ruta mostrada en mapa`);
}

async function dibujarRutaOptimaPedido(pedido) {
    if (window._currentRoutingControl) {
        try { map.removeControl(window._currentRoutingControl); } catch(e) {}
        window._currentRoutingControl = null;
    }
    
    if (pedido.origenCoords && pedido.destinoCoords) {
        const routingControl = L.Routing.control({
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
        
        window._currentRoutingControl = routingControl;
        
        map.fitBounds([
            [pedido.origenCoords.lat, pedido.origenCoords.lng],
            [pedido.destinoCoords.lat, pedido.destinoCoords.lng]
        ]);
        
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
    
    try {
        // ✅ Actualizar en Supabase
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'asignado',
                delivery_id: currentUser.id,
                delivery_nombre: currentUser.nombre
            })
            .eq('id', pedidoId)
            .eq('estado', 'pendiente');
        
        if (error) throw error;
        
        mostrarToast(`✅ Pedido #${pedidoId} AGARRADO! Dirígete al origen.`);
        pedidoSeleccionado = null;
        cargarPedidos(); // Recargar desde Supabase
        
    } catch(e) {
        console.error('Error agarrando pedido:', e);
        mostrarToast("❌ Error al agarrar el pedido", true);
    }
}

async function completarPedido(pedidoId) {
    const supabase = supabaseClient;
    if (!supabase) {
        mostrarToast("❌ Error de conexión", true);
        return;
    }
    
    try {
        // ✅ Actualizar en Supabase
        const { error } = await supabase
            .from('pedidos')
            .update({
                estado: 'completado',
                fecha_completado: new Date().toISOString()
            })
            .eq('id', pedidoId);
        
        if (error) throw error;
        
        // Obtener tarifa para mostrar
        const { data: pedido } = await supabase
            .from('pedidos')
            .select('tarifa')
            .eq('id', pedidoId)
            .single();
        
        mostrarToast(`✅ Pedido #${pedidoId} COMPLETADO! Ganaste $${pedido?.tarifa || 0} MXN`);
        cargarPedidos(); // Recargar desde Supabase
        
    } catch(e) {
        console.error('Error completando pedido:', e);
        mostrarToast("❌ Error al completar el pedido", true);
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
            
            // ✅ Guardar en Supabase
            await setDeliveryOnlineSupabase(currentUser.id, true);
            
            if (userMarker) {
                const coords = userMarker.getLatLng();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, true);
            }
        }
        cargarPedidos();

        // ✅ Asegurar que el intervalo de carga esté activo
        if(cargaPedidosInterval) clearInterval(cargaPedidosInterval);
        cargaPedidosInterval = setInterval(() => { 
        if(isOnline) cargarPedidos(); 
        }, 5000);
        
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
            
            // ✅ Guardar en Supabase
            await setDeliveryOnlineSupabase(currentUser.id, false);
            
            if (userMarker) {
                const coords = userMarker.getLatLng();
                await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, false);
            }
        }
        if(ubicacionInterval) clearInterval(ubicacionInterval);
    }
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

// En delivery.js - función cerrarSesion()
function cerrarSesion() { 
    if(watchId) navigator.geolocation.clearWatch(watchId);
    
    // ✅ LIMPIAR EL INTERVALO DE UBICACIÓN
    if(ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
    }

    if(cargaPedidosInterval) {
    clearInterval(cargaPedidosInterval);
    cargaPedidosInterval = null;
   }
    
    // Marcar como offline
    if(currentUser && typeof guardarUbicacionEnSupabase !== 'undefined' && userMarker) {
        const coords = userMarker.getLatLng();
        guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, false);
    }
    
    if(confirm("¿Cerrar sesión?")){ 
        localStorage.removeItem('sesion_activa'); 
        window.location.href = "index.html"; 
    } 
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