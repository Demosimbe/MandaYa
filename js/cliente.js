// Constantes y variables globales
const BOUNDS = { north: 18.70, south: 18.58, east: -91.75, west: -91.88 };

let map, originMarker, destMarker, routeLine, deliveryMarker;
let originCoords = null, destCoords = null;
let currentUser = null, pedidoActual = null;
let selectMode = 'origen';
let seguimientoInterval = null;
let ubicacionInterval = null;
let currentRouteData = null;
let deliverysMarkers = []; // Para los marcadores de deliverys en línea
let deliverysInterval = null;  // Para el intervalo de deliverys en línea
let pedidoPendiente = null; // Variable global para guardar pedido antes de pagar
let clienteRouteControl = null;


// ==================== INICIALIZACIÓN ====================
function initMap() {
    map = L.map('map').setView([18.6456, -91.8249], 13);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CartoDB',
    maxZoom: 18,
    subdomains: 'abcd'
    }).addTo(map);
    
    // ✅ Limitar mapa a Ciudad del Carmen
    limitarMapaACarmen(map);
    
    // Marcador de origen ARRASTRABLE
    const originIcon = L.divIcon({
        html: '<div style="background:#FF6200; width:28px; height:28px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-circle" style="color:white; font-size:12px;"></i></div>',
        iconSize: [28, 28],
        className: 'custom-marker'
    });
    
    originMarker = L.marker([18.6456, -91.8249], { icon: originIcon, draggable: true }).addTo(map);
    originMarker.bindPopup('📍 <b>Origen</b><br>Arrástrame para cambiar');
    
    // Marcador de destino ARRASTRABLE
    const destIcon = L.divIcon({
        html: '<div style="background:#3B82F6; width:28px; height:28px; border-radius:50%; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center;"><i class="fas fa-square" style="color:white; font-size:12px;"></i></div>',
        iconSize: [28, 28],
        className: 'custom-marker'
    });
    
    destMarker = L.marker([18.6556, -91.8149], { icon: destIcon, draggable: true }).addTo(map);
    destMarker.bindPopup('🏁 <b>Destino</b><br>Arrástrame para cambiar');
    
    // Eventos de arrastre con validación de límites
    originMarker.on('dragend', function(e) {
        const coords = e.target.getLatLng();
        if (coords.lat >= 18.58 && coords.lat <= 18.70 && coords.lng >= -91.88 && coords.lng <= -91.75) {
            originCoords = { lat: coords.lat, lng: coords.lng };
            reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
            actualizarRutaYTarifa();
            mostrarToast("📍 Origen actualizado");
        } else {
            mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
            if (originCoords) originMarker.setLatLng([originCoords.lat, originCoords.lng]);
        }
    });
    
    destMarker.on('dragend', function(e) {
        const coords = e.target.getLatLng();
        if (coords.lat >= 18.58 && coords.lat <= 18.70 && coords.lng >= -91.88 && coords.lng <= -91.75) {
            destCoords = { lat: coords.lat, lng: coords.lng };
            reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
            actualizarRutaYTarifa();
            mostrarToast("🏁 Destino actualizado");
        } else {
            mostrarToast("❌ Ubicación fuera de Ciudad del Carmen", true);
            if (destCoords) destMarker.setLatLng([destCoords.lat, destCoords.lng]);
        }
    });
    
    // Click en el mapa con validación
    map.on('click', (e) => {
        if (e.latlng.lat >= 18.58 && e.latlng.lat <= 18.70 && e.latlng.lng >= -91.88 && e.latlng.lng <= -91.75) {
            if (selectMode === 'origen') {
                originMarker.setLatLng(e.latlng);
                originCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
                reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
                actualizarRutaYTarifa();
                mostrarToast("📍 Origen actualizado");
            } else {
                destMarker.setLatLng(e.latlng);
                destCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
                reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
                actualizarRutaYTarifa();
                mostrarToast("🏁 Destino actualizado");
            }
        } else {
            mostrarToast("❌ Solo dentro de Ciudad del Carmen", true);
        }
    });
    
    // Inicializar coordenadas
    originCoords = { lat: 18.6456, lng: -91.8249 };
    destCoords = { lat: 18.6556, lng: -91.8149 };
    
    reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
    reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
    
    setTimeout(() => actualizarRutaYTarifa(), 500);
}

function loadUser() {
    const sesion = localStorage.getItem('sesion_activa');
    if (!sesion) { window.location.href = "index.html"; return; }
    currentUser = JSON.parse(sesion);
    if (currentUser.rol !== 'cliente') { window.location.href = "delivery.html"; return; }
    document.getElementById("userInfo").innerHTML = `<div class="flex items-center gap-2"><i class="fas fa-user-circle text-[#FF6200] text-xl"></i><span class="font-medium">${currentUser.nombre}</span><span class="text-gray-400 text-xs">(Cliente)</span></div>`;
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

function limpiarRutaCliente() {
    if (clienteRouteControl) {
        try { map.removeControl(clienteRouteControl); } catch(e) {}
        clienteRouteControl = null;
    }
}

async function dibujarRutaDeliveryEnCliente(ubicacionDelivery, destinoCoords, tipo) {
    if (!ubicacionDelivery || !destinoCoords) {
        console.log("❌ Faltan coordenadas para dibujar ruta:", { ubicacionDelivery, destinoCoords });
        return;
    }
    
    limpiarRutaCliente();
    
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
    
    setTimeout(() => {
        map.fitBounds(waypoints, { padding: [50, 50] });
        map.invalidateSize();
    }, 300);
}

async function actualizarRutaYTarifa() {
    if (originCoords && destCoords) {
        const tarifaContainer = document.getElementById("tarifaContainer");
        tarifaContainer.classList.remove("hidden");
        document.getElementById("tarifaValue").innerHTML = '<div class="loading-spinner"></div> Calculando...';
        
        if (routeLine) {
            if (typeof routeLine.remove === 'function') {
                routeLine.remove();
            } else if (routeLine._map) {
                try { map.removeControl(routeLine); } catch(e) {}
            }
            routeLine = null;
        }
        
        // ✅ Guardar los extras actuales antes de recalcular
        const extrasGuardados = currentRouteData?.extras || null;
        
        const tipoEnvio = document.getElementById("tipoEnvio").value || 'paquete';
        const routeResult = await drawRealRoute(map, originCoords, destCoords, '#FF6200', 5);
        
        if (routeResult && routeResult.routeData) {
            routeLine = routeResult.line;
            const distance = routeResult.routeData.distance;
            const duration = routeResult.routeData.duration;
            const rate = calculateShippingRate(distance, tipoEnvio);
            
            // ✅ Crear currentRouteData manteniendo los extras si existían
            currentRouteData = { 
                distance: distance, 
                duration: duration,
                extras: extrasGuardados || { lluvia: false, noche: false, espera: false }
            };
            
            // ✅ Calcular tarifa base y aplicar extras si existen
            let tarifaMostrar = rate.total;
            if (currentRouteData.extras) {
                if (currentRouteData.extras.lluvia) tarifaMostrar += 10;
                if (currentRouteData.extras.noche) tarifaMostrar += 10;
                if (currentRouteData.extras.espera) tarifaMostrar += 10;
            }
            
            document.getElementById("tarifaValue").innerHTML = `$${tarifaMostrar} MXN`;
            mostrarToast(`📏 Distancia: ${distance.toFixed(2)} km • ⏱️ ${formatDuration(duration)}`);
            
        } else {
            const distance = calcularDistancia();
            const rate = calculateShippingRate(distance, tipoEnvio);
            
            // ✅ Crear currentRouteData manteniendo los extras si existían
            currentRouteData = { 
                distance: distance, 
                duration: distance * 2,
                extras: extrasGuardados || { lluvia: false, noche: false, espera: false }
            };
            
            let tarifaMostrar = rate.total;
            if (currentRouteData.extras) {
                if (currentRouteData.extras.lluvia) tarifaMostrar += 10;
                if (currentRouteData.extras.noche) tarifaMostrar += 10;
                if (currentRouteData.extras.espera) tarifaMostrar += 10;
            }
            
            document.getElementById("tarifaValue").innerHTML = `$${tarifaMostrar} MXN (estimado)`;
            
            routeLine = L.polyline([
                [originCoords.lat, originCoords.lng],
                [destCoords.lat, destCoords.lng]
            ], { color: '#FF6200', weight: 5, opacity: 0.6, dashArray: '5, 10' }).addTo(map);
        }
    }
}

function calcularDistancia() {
    const R = 6371;
    const dLat = (destCoords.lat - originCoords.lat) * Math.PI / 180;
    const dLon = (destCoords.lng - originCoords.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(originCoords.lat * Math.PI / 180) * Math.cos(destCoords.lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function reverseGeocode(latlng, callback) {
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
    
    if (!origen || !destino) {
        mostrarToast("❌ Selecciona origen y destino", true);
        return;
    }
    if (!tipo) {
        mostrarToast("❌ Selecciona el tipo de envío", true);
        return;
    }
    
    let distancia = currentRouteData ? currentRouteData.distance : calcularDistancia();
    const rate = calculateShippingRate(distancia, tipo);
    let tarifaBase = rate.total;
    
    // ✅ Verificar si hay extras guardados del resumen
    let tarifaFinal = tarifaBase;
    if (currentRouteData && currentRouteData.extras) {
        tarifaFinal = tarifaBase;
        if (currentRouteData.extras.lluvia) tarifaFinal += 10;
        if (currentRouteData.extras.noche) tarifaFinal += 10;
        if (currentRouteData.extras.espera) tarifaFinal += 10;
    }
    
    // Guardar pedido temporalmente CON los extras si ya los seleccionó
    pedidoPendiente = {
        id: Date.now(),
        cliente_id: currentUser.id,
        cliente_nombre: currentUser.nombre,
        origen: origen,
        destino: destino,
        origen_lat: originCoords.lat,
        origen_lng: originCoords.lng,
        destino_lat: destCoords.lat,
        destino_lng: destCoords.lng,
        tipo: tipo,
        distancia_real: distancia.toFixed(2),
        tarifa: tarifaFinal,  // ✅ Usar tarifa con extras si existen
        extras: currentRouteData?.extras || { lluvia: false, noche: false, espera: false },
        estado: 'pendiente',
        fecha: new Date().toISOString()
    };
    
    // ✅ IR DIRECTAMENTE AL PAGO
    document.getElementById("modalPago").classList.remove("hidden");
    document.getElementById("modalPago").classList.add("flex");
}

function seleccionarPago(metodo) {
    cerrarModalPago();
    
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

function toggleExtra(extra) {
    extrasSeleccionados[extra] = !extrasSeleccionados[extra];
    
    const checkDiv = document.getElementById(`check${extra.charAt(0).toUpperCase() + extra.slice(1)}`);
     if (!checkDiv) return;
    const checkIcon = checkDiv.querySelector('i');
    
    if (extrasSeleccionados[extra]) {
        checkDiv.classList.remove('border-gray-500');
        checkDiv.classList.add('border-green-500', 'bg-green-500/20');
        checkIcon.classList.remove('hidden');
    } else {
        checkDiv.classList.remove('border-green-500', 'bg-green-500/20');
        checkDiv.classList.add('border-gray-500');
        checkIcon.classList.add('hidden');
    }
}

function calcularTotalConExtras(tarifaBase) {
    let total = tarifaBase;
    if (extrasSeleccionados.lluvia) total += 10;
    if (extrasSeleccionados.noche) total += 10;
    if (extrasSeleccionados.espera) total += 10;
    return total;
}

function mostrarModalExtras(tarifaBase) {
    tarifaBaseSinExtras = tarifaBase;
    
    // Resetear extras
    extrasSeleccionados = { lluvia: false, noche: false, espera: false };
    ['Lluvia', 'Noche', 'Espera'].forEach(extra => {
        const checkDiv = document.getElementById(`check${extra}`);
        if (checkDiv) {
            checkDiv.classList.remove('border-green-500', 'bg-green-500/20');
            checkDiv.classList.add('border-gray-500');
            const checkIcon = checkDiv.querySelector('i');
            if (checkIcon) checkIcon.classList.add('hidden');
        }
    });
    
    document.getElementById("modalExtras").classList.remove("hidden");
    document.getElementById("modalExtras").classList.add("flex");
}

function cerrarModalExtras() {
    document.getElementById("modalExtras").classList.add("hidden");
    document.getElementById("modalExtras").classList.remove("flex");
}

function confirmarExtras() {
    const totalConExtras = calcularTotalConExtras(tarifaBaseSinExtras);
    cerrarModalExtras();
    
    // Actualizar pedido pendiente con la tarifa final
    if (pedidoPendiente) {
        pedidoPendiente.tarifa = totalConExtras;
        pedidoPendiente.extras = { ...extrasSeleccionados };
    }
    
    // Mostrar modal de pago directamente
    document.getElementById("modalPago").classList.remove("hidden");
    document.getElementById("modalPago").classList.add("flex");
}

// ==================== PANEL DE ESTADO DEL PEDIDO (NUEVO) ====================
function mostrarPanelEstado(pedido) {
    const panel = document.getElementById("panelEstadoPedido");
    if (!panel) return;
    
    document.getElementById("pedidoIdLabel").innerText = pedido.id;
    actualizarEstadoPanel(pedido.estado);
    panel.classList.remove("hidden");
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
            // Ocultar el panel de estado cuando se completa
            const panel = document.getElementById("panelEstadoPedido");
            const panelMobile = document.getElementById("panelEstadoPedidoMobile");
            if(panel) panel.classList.add("hidden");
            if(panelMobile) panelMobile.classList.add("hidden");
            
            // Limpiar el pedido actual
            pedidoActual = null;
            
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
                limpiarYResetearUI();
                
            } catch(e) {
                console.error('Error cancelando pedido:', e);
                mostrarToast("❌ Error al cancelar el pedido", true);
            }
        }
    );
}

function limpiarYResetearUI() {
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
    
    // Limpiar campos del formulario
    document.getElementById("origen").value = "";
    document.getElementById("destino").value = "";
    document.getElementById("tipoEnvio").value = "";
    document.getElementById("tarifaContainer").classList.add("hidden");
    
    // Restablecer marcadores a posición por defecto
    if (originMarker && destMarker) {
        originCoords = { lat: 18.6456, lng: -91.8249 };
        destCoords = { lat: 18.6556, lng: -91.8149 };
        originMarker.setLatLng([originCoords.lat, originCoords.lng]);
        destMarker.setLatLng([destCoords.lat, destCoords.lng]);
        reverseGeocode(originCoords, (addr) => document.getElementById("origen").value = addr);
        reverseGeocode(destCoords, (addr) => document.getElementById("destino").value = addr);
    }
    
    // Eliminar ruta y marcador de delivery
    if (routeLine) {
        if (typeof routeLine.remove === 'function') routeLine.remove();
        routeLine = null;
    }
    if (deliveryMarker) {
        map.removeLayer(deliveryMarker);
        deliveryMarker = null;
    }
    
    // Ocultar panel de estado
    document.getElementById("panelEstadoPedido").classList.add("hidden");
    
    // Resetear variables
    pedidoActual = null;
    pedidoPendiente = null;
    
    // Reactivar la carga de deliverys en línea
    if (currentUser && currentUser.rol === 'cliente') {
        if (deliverysInterval) clearInterval(deliverysInterval);
        deliverysInterval = setInterval(() => cargarDeliverysEnLinea(), 5000);
        cargarDeliverysEnLinea();
    }
    
    mostrarToast("🔄 Todo listo. Puedes hacer un nuevo envío.");
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
    const total = pedidoPendiente.tarifa;
    const numeroWhatsApp = "521234567890"; // Cambia por el número del delivery/admin
    const mensaje = `Hola, realicé una transferencia por el envío #${pedidoPendiente.id} por $${total} MXN. Adjunto comprobante.`;
    const url = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
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
        console.error("No hay pedido actual para seguir");
        return;
    }

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
            
            if (pedidoActualizado) {
                pedidoActual = pedidoActualizado;
                
                // ✅ Actualizar el panel de estado con el nombre del delivery si está asignado
                if (pedidoActualizado.estado === 'asignado' && pedidoActualizado.delivery_nombre) {
                    actualizarEstadoPanel('asignado', pedidoActualizado.delivery_nombre);
                } else if (pedidoActualizado.estado === 'recogido' && pedidoActualizado.delivery_nombre) {
                    actualizarEstadoPanel('recogido', pedidoActualizado.delivery_nombre);
                } else if (pedidoActualizado.estado === 'pendiente') {
                    actualizarEstadoPanel('pendiente');
                } else if (pedidoActualizado.estado === 'completado') {
                    actualizarEstadoPanel('completado');
                }
                    
            }
            
            if (pedidoActualizado && (pedidoActualizado.estado === 'asignado' || pedidoActualizado.estado === 'recogido') && pedidoActualizado.delivery_id) {
                // ✅ Detener el intervalo de búsqueda ya que ya fue asignado
                clearInterval(seguimientoInterval);
                seguimientoInterval = null;
                
                mostrarToast(`✅ Delivery asignado: ${pedidoActualizado.delivery_nombre || 'Delivery'}`);
                mostrarDeliveryEnMapa(pedidoActualizado.delivery_id, pedidoActualizado.delivery_nombre);
                seguirUbicacionDelivery(pedidoActualizado.delivery_id);
            } 
            else if (pedidoActualizado && pedidoActualizado.estado === 'completado') {
                clearInterval(seguimientoInterval);
                seguimientoInterval = null;
                // El panel ya se oculta en actualizarEstadoPanel
            }
        } catch(e) {
            console.error('Error en seguimiento:', e);
        }
    }, 3000);
}

function seguirUbicacionDelivery(deliveryId) {
    if (ubicacionInterval) {
        clearInterval(ubicacionInterval);
        ubicacionInterval = null;
    }

    ubicacionInterval = setInterval(async () => {
        let ubicacion = null;
        
        if (typeof obtenerUbicacionDeSupabase !== 'undefined') {
            const supabaseUbicacion = await obtenerUbicacionDeSupabase(deliveryId);
            if (supabaseUbicacion) {
                ubicacion = { lat: supabaseUbicacion.lat, lng: supabaseUbicacion.lng };
                console.log("📍 Ubicación delivery obtenida:", ubicacion);
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
            if (deliveryMarker) map.removeLayer(deliveryMarker);
            
            deliveryMarker = crearMarcadorDelivery(
                ubicacion.lat, 
                ubicacion.lng, 
                deliveryNombre, 
                '#FF6200'
            );
            deliveryMarker.addTo(map);
            
            // ✅ Dibujar ruta según el estado del pedido
            if (pedidoActual) {
                console.log("📌 Estado pedido:", pedidoActual.estado);
                
                if (pedidoActual.estado === 'asignado') {
                    // Ruta: delivery -> origen (usando origen_lat, origen_lng)
                    if (pedidoActual.origen_lat && pedidoActual.origen_lng) {
                        const origenCoords = { lat: pedidoActual.origen_lat, lng: pedidoActual.origen_lng };
                        console.log("🟢 Dibujando ruta RECOGIDA hacia:", origenCoords);
                        await dibujarRutaDeliveryEnCliente(ubicacion, origenCoords, 'recogida');
                        deliveryMarker.bindPopup(`<b>🏍️ ${deliveryNombre}</b><br>🟠 En camino a recoger tu paquete`);
                    } else {
                        console.log("❌ No hay coordenadas de origen");
                    }
                    
                } else if (pedidoActual.estado === 'recogido') {
                    // Ruta: delivery -> destino (usando destino_lat, destino_lng)
                    if (pedidoActual.destino_lat && pedidoActual.destino_lng) {
                        const destinoCoords = { lat: pedidoActual.destino_lat, lng: pedidoActual.destino_lng };
                        console.log("🟠 Dibujando ruta ENTREGA hacia:", destinoCoords);
                        await dibujarRutaDeliveryEnCliente(ubicacion, destinoCoords, 'entrega');
                        deliveryMarker.bindPopup(`<b>🏍️ ${deliveryNombre}</b><br>📦 En camino a entregar tu paquete`);
                    } else {
                        console.log("❌ No hay coordenadas de destino");
                    }
                }
            }
            
            // Mostrar distancia al destino
            if (pedidoActual && pedidoActual.destino_lat && ubicacion) {
                const destinoCoords = { lat: pedidoActual.destino_lat, lng: pedidoActual.destino_lng };
                const distanciaADestino = calcularDistanciaEntrePuntos(ubicacion, destinoCoords);
                if (distanciaADestino < 0.5) {
                    document.getElementById("deliveryEstado").innerHTML = "🟢 Muy cerca de tu destino 🎯";
                } else if (distanciaADestino < 1) {
                    document.getElementById("deliveryEstado").innerHTML = "🟡 Cerca de tu destino";
                } else {
                    document.getElementById("deliveryEstado").innerHTML = `🔴 A ${distanciaADestino.toFixed(1)} km de tu destino`;
                }
            }
        }
        
        // ✅ Verificar si el pedido ya fue completado
        if (supabase && pedidoActual) {
            const { data: pedidoActualizado } = await supabase
                .from('pedidos')
                .select('estado')
                .eq('id', pedidoActual.id)
                .single();
            
            if (pedidoActualizado?.estado === 'completado') {
                clearInterval(ubicacionInterval);
                ubicacionInterval = null;
                
                ocultarDeliveryInfo();
                limpiarRutaCliente();
                
                const panel = document.getElementById("panelEstadoPedido");
                const panelMobile = document.getElementById("panelEstadoPedidoMobile");
                if(panel) panel.classList.add("hidden");
                if(panelMobile) panelMobile.classList.add("hidden");
                
                if(deliveryMarker) {
                    map.removeLayer(deliveryMarker);
                    deliveryMarker = null;
                }
                
                pedidoActual = null;
                mostrarToast("🎉 ¡Envío completado! Gracias por usar MandaYa");
            }
        }
    }, 2000);
}

function calcularDistanciaEntrePuntos(punto1, punto2) {
    const R = 6371;
    const dLat = (punto2.lat - punto1.lat) * Math.PI / 180;
    const dLon = (punto2.lng - punto1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(punto1.lat * Math.PI / 180) * Math.cos(punto2.lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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

function verHistorial() {
    mostrarHistorialCompleto();
}

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

function cerrarSesion() { 
    mostrarModalConfirmacion(
        "Cerrar Sesión",
        "¿Estás seguro de que deseas cerrar sesión?",
        () => {
            if(seguimientoInterval) { clearInterval(seguimientoInterval); seguimientoInterval = null;}
            if(ubicacionInterval) { clearInterval(ubicacionInterval); ubicacionInterval = null;}
            if(deliverysInterval) { clearInterval(deliverysInterval); deliverysInterval = null; }
            
            localStorage.removeItem('sesion_activa'); 
            window.location.href = "index.html";
        }
    );
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

function mostrarResumenRuta() {
    if (!originCoords || !destCoords) {
        mostrarToast("Selecciona origen y destino primero", true);
        return;
    }
    
    const distancia = currentRouteData ? currentRouteData.distance : calcularDistancia();
    const tipo = document.getElementById("tipoEnvio").value || 'paquete';
    const rate = calculateShippingRate(distancia, tipo);
    const duracion = currentRouteData ? currentRouteData.duration : (distancia * 2);
    
    getRealDistanceAndTime(originCoords, destCoords).then(routeData => {
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

function mostrarModalResumen(distancia, tiempo, tarifa, tipo) {
    const modalExistente = document.getElementById("modalResumenRuta");
    if (modalExistente) modalExistente.remove();
    
    // ✅ Obtener tarifa actual (podría tener extras previos)
    let tarifaActual = tarifa;
    if (currentRouteData && currentRouteData.extras) {
        if (currentRouteData.extras.lluvia) tarifaActual += 10;
        if (currentRouteData.extras.noche) tarifaActual += 10;
        if (currentRouteData.extras.espera) tarifaActual += 10;
    }
    
    // ✅ Preseleccionar los extras que ya estaban guardados
    const extrasPrevios = currentRouteData?.extras || { lluvia: false, noche: false, espera: false };
    
    tarifaBaseSinExtras = tarifa;
    console.log("📌 tarifaBaseSinExtras guardada:", tarifaBaseSinExtras);

    const modal = document.createElement('div');
    modal.id = "modalResumenRuta";
    modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10001] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-3xl max-w-sm w-full modal-uber">
            <div class="text-center pt-6 pb-3 border-b border-gray-700">
                <div class="w-16 h-16 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-3">
                    <i class="fas fa-route text-white text-2xl"></i>
                </div>
                <h2 class="text-xl font-bold text-white">Resumen de Ruta</h2>
                <p class="text-gray-400 text-sm mt-1">Detalles de tu envío</p>
            </div>
            
            <div class="p-5 space-y-3">
                <div class="bg-gray-700 rounded-xl p-3 flex justify-between items-center">
                    <span class="text-gray-400">📍 Distancia real</span>
                    <span class="text-white font-bold">${distancia} km</span>
                </div>
                <div class="bg-gray-700 rounded-xl p-3 flex justify-between items-center">
                    <span class="text-gray-400">⏱️ Tiempo estimado</span>
                    <span class="text-white font-bold">${tiempo}</span>
                </div>
                <div class="bg-gray-700 rounded-xl p-3 flex justify-between items-center">
                    <span class="text-gray-400">📦 Tipo de envío</span>
                    <span class="text-white font-bold">${tipo}</span>
                </div>
                
                <div class="bg-gray-700 rounded-xl p-3">
                    <div class="text-gray-400 text-sm mb-2">🎯 Extras adicionales (+$10 c/u)</div>
                    
                    <div class="flex items-center justify-between py-2 cursor-pointer" onclick="toggleExtraCheckbox('lluvia')">
                        <div class="flex items-center gap-2">
                            <i class="fas fa-cloud-rain text-blue-400"></i>
                            <span class="text-white text-sm">Lluvia 🌧️</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-orange-400 text-sm">+$10</span>
                            <input type="checkbox" id="checkLluviaExtras" class="w-5 h-5 rounded border-gray-500 accent-orange-500" onchange="actualizarTotalConExtras()" ${extrasPrevios.lluvia ? 'checked' : ''}>
                        </div>
                    </div>
                    
                    <div class="flex items-center justify-between py-2 cursor-pointer" onclick="toggleExtraCheckbox('noche')">
                        <div class="flex items-center gap-2">
                            <i class="fas fa-moon text-yellow-400"></i>
                            <span class="text-white text-sm">Noche 🌙</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-orange-400 text-sm">+$10</span>
                            <input type="checkbox" id="checkNocheExtras" class="w-5 h-5 rounded border-gray-500 accent-orange-500" onchange="actualizarTotalConExtras()" ${extrasPrevios.noche ? 'checked' : ''}>
                        </div>
                    </div>
                    
                    <div class="flex items-center justify-between py-2 cursor-pointer" onclick="toggleExtraCheckbox('espera')">
                        <div class="flex items-center gap-2">
                            <i class="fas fa-clock text-purple-400"></i>
                            <span class="text-white text-sm">Espera ⏱️</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-orange-400 text-sm">+$10</span>
                            <input type="checkbox" id="checkEsperaExtras" class="w-5 h-5 rounded border-gray-500 accent-orange-500" onchange="actualizarTotalConExtras()" ${extrasPrevios.espera ? 'checked' : ''}>
                        </div>
                    </div>
                </div>
                
                <div class="bg-orange-500 rounded-xl p-3 flex justify-between items-center">
                    <span class="text-white font-bold">💰 Total a pagar</span>
                    <span class="text-white font-bold text-xl" id="totalConExtras">$${tarifaActual} MXN</span>
                </div>
            </div>
            
            <div class="px-5 pb-5 flex gap-3">
                <button onclick="cerrarModalResumen()" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-xl transition-all">
                    Cancelar
                </button>
                <button id="btnAceptarExtras" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition-all">
                    ✅ Aceptar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // ✅ Inicializar extrasSeleccionados con los valores previos
    extrasSeleccionados = { ...extrasPrevios };
    
    document.getElementById("btnAceptarExtras").onclick = () => {
        confirmarExtrasYContinuar();
    };
}

function confirmarExtrasYContinuar() {
    console.log("🔍 confirmarExtrasYContinuar EJECUTADA");
    
    // ✅ Obtener valores actuales de los checkboxes (ANTES de cerrar el modal)
    const checkLluvia = document.getElementById("checkLluviaExtras");
    const checkNoche = document.getElementById("checkNocheExtras");
    const checkEspera = document.getElementById("checkEsperaExtras");
    
    // ✅ Verificar si los checkboxes existen
    if (!checkLluvia || !checkNoche || !checkEspera) {
        console.error("❌ No se encontraron los checkboxes de extras");
        mostrarToast("❌ Error al leer los extras", true);
        cerrarModalResumen();
        return;
    }
    
    const lluviaSeleccionada = checkLluvia.checked;
    const nocheSeleccionada = checkNoche.checked;
    const esperaSeleccionada = checkEspera.checked;
    
    console.log("Checkboxes:", { 
        lluvia: lluviaSeleccionada, 
        noche: nocheSeleccionada, 
        espera: esperaSeleccionada 
    });
    
    // Actualizar extrasSeleccionados global
    extrasSeleccionados = {
        lluvia: lluviaSeleccionada,
        noche: nocheSeleccionada,
        espera: esperaSeleccionada
    };
    
    // Calcular total con extras
    let totalConExtras = tarifaBaseSinExtras;
    let extrasAplicados = [];
    
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
    
    console.log("Tarifa base:", tarifaBaseSinExtras);
    console.log("Total con extras:", totalConExtras);
    console.log("Extras aplicados:", extrasAplicados);
    
    // ✅ Guardar los extras en currentRouteData
    if (currentRouteData) {
        currentRouteData.extras = { ...extrasSeleccionados };
        currentRouteData.totalConExtras = totalConExtras;
        console.log("✅ currentRouteData.extras actualizado:", currentRouteData.extras);
    }
    
    // ✅ ACTUALIZAR LA TARIFA EN LA PANTALLA PRINCIPAL
    const tarifaElement = document.getElementById("tarifaValue");
    if (tarifaElement) {
        tarifaElement.innerHTML = `$${totalConExtras} MXN`;
        console.log("✅ Tarifa actualizada en pantalla a: $", totalConExtras);
    } else {
        console.error("❌ No se encontró el elemento tarifaValue");
    }
    
    // ✅ También actualizar pedidoPendiente si existe
    if (pedidoPendiente) {
        pedidoPendiente.tarifa = totalConExtras;
        pedidoPendiente.extras = { ...extrasSeleccionados };
    }
    
    // ✅ Mostrar mensaje correcto según los extras seleccionados
    if (extrasAplicados.length > 0) {
        mostrarToast(`✅ Extras aplicados: ${extrasAplicados.join(", ")} (+$${extrasAplicados.length * 10} MXN) - Total: $${totalConExtras} MXN`);
    } else {
        mostrarToast(`✅ Sin extras seleccionados - Total: $${totalConExtras} MXN`);
    }
    
    // ✅ CERRAR EL MODAL
    cerrarModalResumen();
}

function toggleExtraCheckbox(extra) {
    const checkbox = document.getElementById(`check${extra.charAt(0).toUpperCase() + extra.slice(1)}Extras`);
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        actualizarTotalConExtras();
    }
}

function actualizarTotalConExtras() {
    let total = tarifaBaseSinExtras;
    
    const checkLluvia = document.getElementById("checkLluviaExtras");
    const checkNoche = document.getElementById("checkNocheExtras");
    const checkEspera = document.getElementById("checkEsperaExtras");
    
    if (checkLluvia && checkLluvia.checked) total += 10;
    if (checkNoche && checkNoche.checked) total += 10;
    if (checkEspera && checkEspera.checked) total += 10;
    
    // ✅ Mostrar total actualizado en el resumen
    const totalSpan = document.getElementById("totalConExtras");
    if (totalSpan) {
        totalSpan.innerHTML = `$${total} MXN`;
        
        // Animación sutil cuando cambia el total
        totalSpan.style.transform = 'scale(1.05)';
        setTimeout(() => {
            totalSpan.style.transform = 'scale(1)';
        }, 200);
    }
    
    return total;
}

function confirmarExtrasDesdeResumen() {
    // Obtener valores actuales de los checkboxes
    const checkLluvia = document.getElementById("checkLluviaExtras");
    const checkNoche = document.getElementById("checkNocheExtras");
    const checkEspera = document.getElementById("checkEsperaExtras");
    
    // Actualizar extrasSeleccionados
    extrasSeleccionados = {
        lluvia: checkLluvia?.checked || false,
        noche: checkNoche?.checked || false,
        espera: checkEspera?.checked || false
    };
    
    // Calcular total con extras
    let totalConExtras = tarifaBaseSinExtras;
    if (extrasSeleccionados.lluvia) totalConExtras += 10;
    if (extrasSeleccionados.noche) totalConExtras += 10;
    if (extrasSeleccionados.espera) totalConExtras += 10;
    
    // ✅ ACTUALIZAR pedidoPendiente con la tarifa final
    if (pedidoPendiente) {
        pedidoPendiente.tarifa = totalConExtras;
        pedidoPendiente.extras = { ...extrasSeleccionados };
        
        // ✅ También mostrar en consola para verificar
        console.log("Tarifa actualizada con extras:", {
            base: tarifaBaseSinExtras,
            extras: extrasSeleccionados,
            total: totalConExtras
        });
    }
    
    // Cerrar modal de resumen
    cerrarModalResumen();
    
    // ✅ Mostrar modal de pago con la tarifa ACTUALIZADA
    document.getElementById("modalPago").classList.remove("hidden");
    document.getElementById("modalPago").classList.add("flex");
}

function cerrarModalResumen() {
    const modal = document.getElementById("modalResumenRuta");
    if (modal) modal.remove();
}

// ==================== BÚSQUEDA DE DIRECCIONES ====================
let busquedaTimeout = null;

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
        originCoords = coords;
        document.getElementById("origen").value = direccion.split(',')[0];
    } else {
        destMarker.setLatLng([coords.lat, coords.lng]);
        destCoords = coords;
        document.getElementById("destino").value = direccion.split(',')[0];
    }
    
    document.getElementById(`${tipo}Sugerencias`).classList.add('hidden');
    actualizarRutaYTarifa();
    mostrarToast(`📍 ${tipo === 'origen' ? 'Origen' : 'Destino'} actualizado`);
}

// ==================== VER DELIVERYS EN LÍNEA ====================
async function cargarDeliverysEnLinea() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
    
    try {
        const { data: ubicaciones, error } = await supabaseClient
            .from('ubicaciones')
            .select('*')
            .eq('online', true)
            .order('updated_at', { ascending: false });
        
        if (error) throw error;
        
        const deliverysConEstado = await Promise.all(ubicaciones.map(async (delivery) => {
            const tienePedido = await tienePedidoActivo(delivery.delivery_id);
            return { ...delivery, tienePedido };
        }));
        
        deliverysMarkers.forEach(marker => map.removeLayer(marker));
        deliverysMarkers = [];
        
        deliverysConEstado.forEach(delivery => {
            const tienePedido = delivery.tienePedido;
            const color = tienePedido ? '#FF6200' : '#10B981';
            const estadoTexto = tienePedido ? '🟠 En entrega' : '🟢 Disponible';
            
            const marker = crearMarcadorDelivery(
                delivery.lat, 
                delivery.lng, 
                delivery.delivery_nombre, 
                color
            );
            
            marker.bindPopup(`<b>🏍️ ${delivery.delivery_nombre}</b><br>${estadoTexto}`);
            marker.addTo(map);
            deliverysMarkers.push(marker);
        });
        
        console.log(`✅ ${deliverysConEstado.length} deliverys mostrados (${deliverysConEstado.filter(d => d.tienePedido).length} ocupados, ${deliverysConEstado.filter(d => !d.tienePedido).length} disponibles)`);
        
    } catch(e) {
        console.error('Error cargando deliverys:', e);
    }
}

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', () => {
    const origenInput = document.getElementById('origen');
    const destinoInput = document.getElementById('destino');
    const btnCancelarPedido = document.getElementById('btnCancelarPedido');
    
    if (btnCancelarPedido) {
        btnCancelarPedido.addEventListener('click', cancelarPedido);
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
});

window.onload = () => { 
    loadUser(); 
    initMap();
    if (currentUser && currentUser.rol === 'cliente') {
        setTimeout(() => cargarDeliverysEnLinea(), 2000);
        
        if (deliverysInterval) clearInterval(deliverysInterval);
        
        deliverysInterval = setInterval(() => {
            if (currentUser && currentUser.rol === 'cliente') {
                cargarDeliverysEnLinea();
            }
        }, 5000);
    }
};