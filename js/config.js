// js/config.js - Versión para Vercel (sin Vite, sin contraseñas en código)

// ==================== CONFIGURACIÓN ====================
// Las variables se inyectan desde Vercel Environment Variables
// NO hay contraseñas escritas aquí

let SUPABASE_URL = null;
let SUPABASE_ANON_KEY = null;

// Intentar obtener variables desde el servidor (Vercel)
if (typeof process !== 'undefined' && process.env) {
    SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
}

// Fallback para desarrollo local (NUNCA para producción)
// Elimina estos valores o déjalos vacíos en producción
if (!SUPABASE_URL && window.location.hostname === 'localhost') {
    console.warn("⚠️ Usando valores por defecto para desarrollo local");
    SUPABASE_URL = "https://tu-proyecto-local.supabase.co";
    SUPABASE_ANON_KEY = "tu-anon-key-local";
}

// Configuración de la app (valores públicos seguros)
const APP_CONFIG = {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    osrmApiUrl: "https://router.project-osrm.org",
    whatsappNumber: "5219381083498",
    isDev: window.location.hostname === 'localhost',
    isProd: window.location.hostname !== 'localhost',
    appVersion: '1.0.0'
};

// Validar que las variables existen (solo en desarrollo local)
if (APP_CONFIG.isDev) {
    if (!SUPABASE_URL) console.warn('⚠️ VITE_SUPABASE_URL no está definida');
    if (!SUPABASE_ANON_KEY) console.warn('⚠️ VITE_SUPABASE_ANON_KEY no está definida');
} else if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("❌ Error: Variables de entorno no configuradas en Vercel");
    console.error("   Ve a: Vercel Dashboard → Project → Settings → Environment Variables");
}

let supabaseClient = null;

// Inicializar Supabase
function initSupabase() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error("❌ Supabase no disponible: Variables de entorno no configuradas");
        return null;
    }
    
    if (typeof supabase !== 'undefined' && !supabaseClient) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.supabaseClient = supabaseClient;
        console.log('✅ Supabase conectado');
    }
    return supabaseClient;
}

// ========== FUNCIONES PARA USUARIOS ==========

async function registrarUsuarioSupabase(nombre, email, telefono, password, rol) {
    const supabase = initSupabase();
    if (!supabase) return { error: 'Supabase no disponible' };
    
    try {
        const { data: existe } = await supabase
            .from('usuarios')
            .select('email')
            .eq('email', email)
            .maybeSingle();
        
        if (existe) return { error: 'El correo ya está registrado' };
        
        const hashedPassword = await securityManager.hashPassword(password);
        
        const nuevoUsuario = {
            nombre: nombre,
            email: email,
            telefono: telefono || '',
            password_hash: hashedPassword,
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

async function loginSupabase(email, password) {
    const supabase = initSupabase();
    if (!supabase) return { error: 'Supabase no disponible' };
    
    try {
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        
        if (error) return { error: error.message };
        if (!usuario) return { error: 'Correo o contraseña incorrectos' };
        
        let passwordValida = false;
        
        if (usuario.password_hash) {
            passwordValida = await securityManager.verifyPassword(password, usuario.password_hash);
        } 
        else if (usuario.password && usuario.password === password) {
            const hashedPassword = await securityManager.hashPassword(password);
            await supabase
                .from('usuarios')
                .update({ 
                    password_hash: hashedPassword,
                    password: null
                })
                .eq('id', usuario.id);
            passwordValida = true;
        }
        
        if (!passwordValida) {
            return { error: 'Correo o contraseña incorrectos' };
        }
        
        const sessionToken = await securityManager.iniciarSesion(usuario);
        
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

async function verificarYProtegerSesion() {
    const usuario = securityManager.obtenerUsuarioActual();
    if (!usuario) {
        window.location.href = "index.html";
        return false;
    }
    
    const esValida = await securityManager.verificarSesionUnica();
    if (!esValida) {
        return false;
    }
    
    securityManager.iniciarMonitoreoSesion();
    
    return true;
}

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

async function deliveryTienePedidoActivo(deliveryId) {
    const supabase = initSupabase();
    if (!supabase) return true;
    
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
        return true;
    }
}

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

async function inicializarSeguridad() {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const sesion = securityManager.obtenerUsuarioActual();
    if (sesion && (window.location.pathname.includes('cliente.html') || window.location.pathname.includes('delivery.html'))) {
        const valida = await securityManager.verificarSesionUnica();
        if (!valida) {
            // Ya redirige
        }
    }
}

// ==================== EXPORTAR FUNCIONES GLOBALMENTE ====================
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

window.APP_CONFIG = APP_CONFIG;
window.getWhatsAppNumber = function() {
    return APP_CONFIG.whatsappNumber || "521234567890";
};

// ==================== INICIALIZACIÓN ====================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarSeguridad);
} else {
    inicializarSeguridad();
}

initSupabase();