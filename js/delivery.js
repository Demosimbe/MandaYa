// Constantes y variables globales
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

let map, userMarker, routeLine;
let currentUser = null, isOnline = false;
let pedidosDisponibles = [], misPedidosActivos = [];
let pedidoSeleccionado = null;
let watchId = null;
let ubicacionInterval = null;

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
    setInterval(() => { if(isOnline) cargarPedidos(); }, 5000);
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

function cargarPedidos() {
    const todosPedidos = JSON.parse(localStorage.getItem('pedidos_pendientes')) || [];
    pedidosDisponibles = todosPedidos.filter(p => p.estado === 'pendiente');
    misPedidosActivos = todosPedidos.filter(p => p.deliveryId === currentUser?.id && p.estado !== 'completado');
    
    actualizarListaPedidos();
    dibujarRutaSeleccionada();
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
    const todosPedidos = JSON.parse(localStorage.getItem('pedidos_pendientes')) || [];
    const pedidoIndex = todosPedidos.findIndex(p => p.id === pedidoId);
    
    if(pedidoIndex !== -1 && todosPedidos[pedidoIndex].estado === 'pendiente') {
        todosPedidos[pedidoIndex].estado = 'asignado';
        todosPedidos[pedidoIndex].deliveryId = currentUser.id;
        todosPedidos[pedidoIndex].deliveryNombre = currentUser.nombre;
        localStorage.setItem('pedidos_pendientes', JSON.stringify(todosPedidos));
        
        // Guardar también en Supabase
        if (typeof agarrarPedidoEnSupabase !== 'undefined') {
            await agarrarPedidoEnSupabase(pedidoId, currentUser.id, currentUser.nombre);
            console.log('✅ Pedido agarrado también en Supabase');
        }
        
        mostrarToast(`✅ Pedido #${pedidoId} AGARRADO! Dirígete al origen. El cliente verá tu ubicación en tiempo real.`);
        pedidoSeleccionado = null;
        cargarPedidos();
    }
}

async function completarPedido(pedidoId) {
    const todosPedidos = JSON.parse(localStorage.getItem('pedidos_pendientes')) || [];
    const pedidoIndex = todosPedidos.findIndex(p => p.id === pedidoId);
    
    if(pedidoIndex !== -1) {
        todosPedidos[pedidoIndex].estado = 'completado';
        todosPedidos[pedidoIndex].fechaCompletado = new Date().toISOString();
        localStorage.setItem('pedidos_pendientes', JSON.stringify(todosPedidos));
        
        // Guardar también en Supabase
        if (typeof completarPedidoEnSupabase !== 'undefined') {
            await completarPedidoEnSupabase(pedidoId);
            console.log('✅ Pedido completado también en Supabase');
        }
        
        mostrarToast(`✅ Pedido #${pedidoId} COMPLETADO! Ganaste $${todosPedidos[pedidoIndex].tarifa} MXN`);
        cargarPedidos();
    }
}

function toggleOnline() {
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
            const usuarios = JSON.parse(localStorage.getItem('usuarios')) || [];
            const idx = usuarios.findIndex(u => u.id === currentUser.id);
            if(idx !== -1) { usuarios[idx].online = true; localStorage.setItem('usuarios', JSON.stringify(usuarios)); }
            
            // Guardar estado online en Supabase
            if (userMarker && typeof guardarUbicacionEnSupabase !== 'undefined') {
                const coords = userMarker.getLatLng();
                guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, true);
            }
        }
        cargarPedidos();
        
        if(ubicacionInterval) clearInterval(ubicacionInterval);
        ubicacionInterval = setInterval(async () => {
            if(userMarker && currentUser && isOnline) {
                const coords = userMarker.getLatLng();
                localStorage.setItem(`ubicacion_${currentUser.id}`, JSON.stringify({ lat: coords.lat, lng: coords.lng }));
                
                if (typeof guardarUbicacionEnSupabase !== 'undefined') {
                    await guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, true);
                }
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
            const usuarios = JSON.parse(localStorage.getItem('usuarios')) || [];
            const idx = usuarios.findIndex(u => u.id === currentUser.id);
            if(idx !== -1) { usuarios[idx].online = false; localStorage.setItem('usuarios', JSON.stringify(usuarios)); }
            
            // Guardar estado offline en Supabase
            if (userMarker && typeof guardarUbicacionEnSupabase !== 'undefined') {
                const coords = userMarker.getLatLng();
                guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, false);
            }
        }
        if(ubicacionInterval) clearInterval(ubicacionInterval);
    }
}

function verHistorial() {
    const todosPedidos = JSON.parse(localStorage.getItem('pedidos_pendientes')) || [];
    const completados = todosPedidos.filter(p => p.deliveryId === currentUser?.id && p.estado === 'completado');
    if(completados.length === 0) mostrarToast("No tienes entregas completadas");
    else {
        let total = 0;
        let msg = "✅ Entregas completadas:\n";
        completados.forEach(p => { total += p.tarifa; msg += `• #${p.id}: ${p.distanciaReal}km - $${p.tarifa}\n`; });
        msg += `\n💰 Total ganado: $${total} MXN`;
        alert(msg);
    }
}

function verPerfil() { 
    alert(`👤 ${currentUser?.nombre}\n📧 ${currentUser?.email}\n🏍️ Delivery`); 
}

function cerrarSesion() { 
    if(watchId) navigator.geolocation.clearWatch(watchId);
    if(ubicacionInterval) clearInterval(ubicacionInterval);
    
    // Marcar como offline antes de cerrar sesión
    if(currentUser && typeof guardarUbicacionEnSupabase !== 'undefined' && userMarker) {
        const coords = userMarker.getLatLng();
        guardarUbicacionEnSupabase(currentUser.id, currentUser.nombre, coords.lat, coords.lng, false);
    }
    
    if(confirm("¿Cerrar sesión?")){ 
        localStorage.removeItem('sesion_activa'); 
        window.location.href="index.html"; 
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