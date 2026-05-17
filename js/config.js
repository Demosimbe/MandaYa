// js/config.js - Versión optimizada con Vite
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Configuración de la app
const APP_CONFIG = {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    osrmApiUrl: import.meta.env.VITE_OSRM_API_URL || 'https://router.project-osrm.org',
    whatsappNumber: import.meta.env.VITE_WHATSAPP_NUMBER || '5219381083498',
    isDev: import.meta.env.DEV,
    isProd: import.meta.env.PROD,
    appVersion: '1.0.0'
};

// Validar que las variables existen (solo en desarrollo)
if (APP_CONFIG.isDev) {
    if (!SUPABASE_URL) console.warn('⚠️ VITE_SUPABASE_URL no está definida');
    if (!SUPABASE_ANON_KEY) console.warn('⚠️ VITE_SUPABASE_ANON_KEY no está definida');
}

let supabaseClient = null;

// Inicializar Supabase
function initSupabase() {
    if (typeof supabase !== 'undefined' && !supabaseClient) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.supabaseClient = supabaseClient;  // ✅ Hacer global
        console.log('✅ Supabase conectado');
    }
    return supabaseClient;
}

// ========== FUNCIONES PARA USUARIOS ==========

// Registrar nuevo usuario (cliente o delivery)
async function registrarUsuarioSupabase(nombre, email, telefono, password, rol) {
    const supabase = initSupabase();
    if (!supabase) return { error: 'Supabase no disponible' };
    
    try {
        // Verificar si el email ya existe
        const { data: existe } = await supabase
            .from('usuarios')
            .select('email')
            .eq('email', email)
            .maybeSingle();
        
        if (existe) return { error: 'El correo ya está registrado' };
        
        // ✅ HASHEAR CONTRASEÑA antes de guardar
        const hashedPassword = await securityManager.hashPassword(password);
        
        // Crear nuevo usuario CONTRASEÑA HASHEADA
        const nuevoUsuario = {
            nombre: nombre,
            email: email,
            telefono: telefono || '',
            password_hash: hashedPassword,  // ← CAMBIADO de 'password' a 'password_hash'
            rol: rol,
            online: false,
            session_token: null,
            device_id: null,
            fecha_registro: new Date().toISOString()
        };
        
        const { data, error } = await supabase
            .from('usuarios')
            .insert([nuevoUsuario])
            .select();
        
        if (error) return { error: error.message };
        
        return { data: data[0], error: null };
        
    } catch(e) {
        console.error('Error en registro:', e);
        return { error: e.message };
    }
}

// Iniciar sesión
async function loginSupabase(email, password) {
    const supabase = initSupabase();
    if (!supabase) return { error: 'Supabase no disponible' };
    
    try {
        // Buscar usuario por email
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        
        if (error) return { error: error.message };
        if (!usuario) return { error: 'Correo o contraseña incorrectos' };
        
        // ✅ VERIFICAR CONTRASEÑA CONTRA EL HASH
        let passwordValida = false;
        
        // Soporte para migración: si existe password_hash, usarlo
        if (usuario.password_hash) {
            passwordValida = await securityManager.verifyPassword(password, usuario.password_hash);
        } 
        // Migración: Si todavía tiene password en texto plano, convertir a hash
        else if (usuario.password && usuario.password === password) {
            // Migrar a hash automáticamente
            const hashedPassword = await securityManager.hashPassword(password);
            await supabase
                .from('usuarios')
                .update({ 
                    password_hash: hashedPassword,
                    password: null  // Eliminar texto plano
                })
                .eq('id', usuario.id);
            passwordValida = true;
        }
        
        if (!passwordValida) {
            return { error: 'Correo o contraseña incorrectos' };
        }
        
        // ✅ INICIAR SESIÓN SEGURA (sesión única)
        const sessionToken = await securityManager.iniciarSesion(usuario);
        
        // Retornar usuario sin datos sensibles
        const usuarioSeguro = {
            id: usuario.id,
            nombre: usuario.nombre,
            email: usuario.email,
            rol: usuario.rol,
            session_token: sessionToken
        };
        
        return { data: usuarioSeguro, error: null };
        
    } catch(e) {
        console.error('Error en login:', e);
        return { error: e.message };
    }
}

// Verificar sesión activa (llamar al cargar cada página)
async function verificarYProtegerSesion() {
    const usuario = securityManager.obtenerUsuarioActual();
    if (!usuario) {
        window.location.href = "index.html";
        return false;
    }
    
    const esValida = await securityManager.verificarSesionUnica();
    if (!esValida) {
        // Ya redirige adentro
        return false;
    }
    
    // Iniciar monitoreo de sesión
    securityManager.iniciarMonitoreoSesion();
    
    return true;
}

// Obtener todos los deliverys ONLINE
async function getDeliverysOnlineSupabase() {
    const supabase = initSupabase();
    if (!supabase) return [];
    
    try {
        const { data, error } = await supabase
            .from('usuarios')
            .select('id, nombre, online')
            .eq('rol', 'delivery')
            .eq('online', true);
        
        if (error) throw error;
        return data || [];
        
    } catch(e) {
        console.error('Error obteniendo deliverys:', e);
        return [];
    }
}

// Actualizar estado online de un delivery
async function setDeliveryOnlineSupabase(userId, online) {
    const supabase = initSupabase();
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('usuarios')
            .update({ online: online })
            .eq('id', userId);
        
        if (error) console.error('Error actualizando online:', error);
        return { data, error };
        
    } catch(e) {
        console.error('Error:', e);
        return null;
    }
}

// ========== FUNCIONES PARA VERIFICAR ESTADO DEL DELIVERY ==========
async function tienePedidoActivo(deliveryId) {
    const supabase = initSupabase();
    if (!supabase) return false;
    
    try {
        const { data, error } = await supabase
            .from('pedidos')
            .select('id')
            .eq('delivery_id', deliveryId)
            .in('estado', ['asignado'])
            .maybeSingle();
        
        if (error) throw error;
        return !!data; // true si tiene pedido activo, false si no
    } catch(e) {
        console.error('Error verificando pedido activo:', e);
        return false;
    }
}

// Obtener TODOS los usuarios (para admin)
async function getAllUsuariosSupabase() {
    const supabase = initSupabase();
    if (!supabase) return [];
    
    try {
        const { data, error } = await supabase
            .from('usuarios')
            .select('*')
            .order('fecha_registro', { ascending: false });
        
        if (error) throw error;
        return data || [];
        
    } catch(e) {
        console.error('Error obteniendo usuarios:', e);
        return [];
    }
}

// ========== FUNCIONES PARA VERIFICAR PEDIDOS ACTIVOS DEL DELIVERY ==========

async function deliveryTienePedidoActivo(deliveryId) {
    const supabase = initSupabase();
    if (!supabase) return true; // Por seguridad, asumir que tiene pedido si hay error
    
    try {
        const { data, error } = await supabase
            .from('pedidos')
            .select('id, estado')
            .eq('delivery_id', deliveryId)
            .in('estado', ['asignado', 'recogido'])
            .limit(1);
        
        if (error) throw error;
        
        return data && data.length > 0;
    } catch(e) {
        console.error('Error verificando pedido activo:', e);
        return true; // Por seguridad, evitar que agarre pedido si hay error
    }
}

// Versión que también devuelve el pedido activo
async function getPedidoActivoDelDelivery(deliveryId) {
    const supabase = initSupabase();
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('pedidos')
            .select('*')
            .eq('delivery_id', deliveryId)
            .in('estado', ['asignado', 'recogido'])
            .limit(1);
        
        if (error) throw error;
        
        return data && data.length > 0 ? data[0] : null;
    } catch(e) {
        console.error('Error obteniendo pedido activo:', e);
        return null;
    }
}

// Eliminar usuario (solo admin)
async function eliminarUsuarioSupabase(userId) {
    const supabase = initSupabase();
    if (!supabase) return { error: 'Supabase no disponible' };
    
    try {
        const { error } = await supabase
            .from('usuarios')
            .delete()
            .eq('id', userId);
        
        if (error) return { error: error.message };
        return { error: null };
        
    } catch(e) {
        return { error: e.message };
    }
}

// ========== FUNCIONES PARA UBICACIONES ==========

async function guardarUbicacionEnSupabase(deliveryId, deliveryNombre, lat, lng, online) {
    const supabase = initSupabase();
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('ubicaciones')
            .upsert({
                delivery_id: deliveryId,
                delivery_nombre: deliveryNombre,
                lat: lat,
                lng: lng,
                online: online,
                updated_at: new Date()
            }, { onConflict: 'delivery_id' });
        
        if (error) console.error('Error guardando ubicación:', error);
        return { data, error };
    } catch(e) {
        console.error('Error:', e);
        return null;
    }
}

async function obtenerUbicacionDeSupabase(deliveryId) {
    const supabase = initSupabase();
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('ubicaciones')
            .select('*')
            .eq('delivery_id', deliveryId)
            .maybeSingle();
        
        if (error) console.error('Error:', error);
        return data;
    } catch(e) {
        console.error('Error:', e);
        return null;
    }
}
// ==================== SINCRONIZACIÓN CON MÓVIL ====================
  function sincronizarBloqueoMobile(bloquear) {
        const inputsMobile = ['origenMobile', 'destinoMobile'];
        inputsMobile.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.disabled = bloquear;
                if (bloquear) {
                    input.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
                    input.placeholder = id === 'origenMobile' ? '📍 Origen (bloqueado)' : '🏁 Destino (bloqueado)';
                } else {
                    input.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
                    input.placeholder = id === 'origenMobile' ? 'Buscar dirección...' : 'Buscar dirección...';
                }
            }
        });
    }
    

// ========== FUNCIONES PARA PEDIDOS ==========

async function crearPedidoEnSupabase(pedido) {
    const supabase = initSupabase();
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('pedidos')
            .insert([{
                id: pedido.id,
                cliente_id: pedido.clienteId,
                cliente_nombre: pedido.clienteNombre,
                origen: pedido.origen,
                destino: pedido.destino,
                origen_lat: pedido.origenCoords?.lat,
                origen_lng: pedido.origenCoords?.lng,
                destino_lat: pedido.destinoCoords?.lat,
                destino_lng: pedido.destinoCoords?.lng,
                tipo: pedido.tipo,
                distancia_real: pedido.distanciaReal,
                tarifa: pedido.tarifa,
                estado: pedido.estado,
                fecha: pedido.fecha
            }]);
        
        if (error) console.error('Error:', error);
        return { data, error };
    } catch(e) {
        console.error('Error:', e);
        return null;
    }
}

async function agarrarPedidoEnSupabase(pedidoId, deliveryId, deliveryNombre) {
    const supabase = initSupabase();
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('pedidos')
            .update({
                estado: 'asignado',
                delivery_id: deliveryId,
                delivery_nombre: deliveryNombre
            })
            .eq('id', pedidoId);
        
        if (error) console.error('Error:', error);
        return { data, error };
    } catch(e) {
        console.error('Error:', e);
        return null;
    }
}

async function completarPedidoEnSupabase(pedidoId) {
    const supabase = initSupabase();
    if (!supabase) return null;
    
    try {
        const { data, error } = await supabase
            .from('pedidos')
            .update({
                estado: 'completado',
                fecha_completado: new Date()
            })
            .eq('id', pedidoId);
        
        if (error) console.error('Error:', error);
        return { data, error };
    } catch(e) {
        console.error('Error:', e);
        return null;
    }
}
// Al final de config.js, agregar:
async function inicializarSeguridad() {
    // Pequeño delay para asegurar que todo está cargado
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verificar si hay una sesión activa al cargar
    const sesion = securityManager.obtenerUsuarioActual();
       if (sesion && (window.location.pathname.includes('cliente.html') || window.location.pathname.includes('delivery.html'))) {
        const valida = await securityManager.verificarSesionUnica();
        if (!valida) {
            // Ya redirige
        }
    }
}

// Al final de config.js - EXPORTAR FUNCIONES GLOBALMENTE
window.loginSupabase = loginSupabase;
window.registrarUsuarioSupabase = registrarUsuarioSupabase;
window.verificarYProtegerSesion = verificarYProtegerSesion;
window.getDeliverysOnlineSupabase = getDeliverysOnlineSupabase;
window.setDeliveryOnlineSupabase = setDeliveryOnlineSupabase;
window.getAllUsuariosSupabase = getAllUsuariosSupabase;
window.deliveryTienePedidoActivo = deliveryTienePedidoActivo;
window.getPedidoActivoDelDelivery = getPedidoActivoDelDelivery;
window.eliminarUsuarioSupabase = eliminarUsuarioSupabase;
window.guardarUbicacionEnSupabase = guardarUbicacionEnSupabase;
window.obtenerUbicacionDeSupabase = obtenerUbicacionDeSupabase;
window.sincronizarBloqueoMobile = sincronizarBloqueoMobile;
window.crearPedidoEnSupabase = crearPedidoEnSupabase;
window.agarrarPedidoEnSupabase = agarrarPedidoEnSupabase;
window.completarPedidoEnSupabase = completarPedidoEnSupabase;
window.initSupabase = initSupabase;

// ==================== INICIALIZACIÓN ====================
// Ejecutar después de initSupabase
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarSeguridad);
} else {
    inicializarSeguridad();
}

// Inicializar
initSupabase();