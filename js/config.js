// Configuración de Mapbox
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibWFuZGF5YSIsImEiOiJjbTdlcHBtMHMwOWNsMmtzajlodHR2ZzZzIn0.UvFYKJQi0Z5Zz5Zz5Zz5Zz5';

// Configuración de Supabase
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ewjljddexyajxuzzzssp.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3amxqZGRleHlhanh1enp6c3NwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODAyMDExOSwiZXhwIjoyMDkzNTk2MTE5fQ.Xcb3vGH7a7Q0RA9-RlnZ1wUrWNXAV7YxEWiTPGsOMPU';

export let supabaseClient = null;

// Inicializar Supabase
export function initSupabase() {
    if (typeof supabase !== 'undefined' && !supabaseClient) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('✅ Supabase conectado');
    }
    return supabaseClient;
}

// ========== FUNCIONES PARA USUARIOS ==========

export async function registrarUsuarioSupabase(nombre, email, telefono, password, rol) {
    const supabase = initSupabase();
    if (!supabase) return { error: 'Supabase no disponible' };
    
    try {
        const { data: existe } = await supabase
            .from('usuarios')
            .select('email')
            .eq('email', email)
            .maybeSingle();
        
        if (existe) return { error: 'El correo ya está registrado' };
        
        const nuevoUsuario = {
            id: Date.now().toString(),
            nombre: nombre,
            email: email,
            telefono: telefono || '',
            password: password,
            rol: rol,
            online: false,
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

export async function loginSupabase(email, password) {
    const supabase = initSupabase();
    if (!supabase) return { error: 'Supabase no disponible' };
    
    try {
        const { data, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .eq('password', password)
            .maybeSingle();
        
        if (error) return { error: error.message };
        if (!data) return { error: 'Correo o contraseña incorrectos' };
        
        return { data: data, error: null };
        
    } catch(e) {
        console.error('Error en login:', e);
        return { error: e.message };
    }
}

export async function getDeliverysOnlineSupabase() {
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

export async function setDeliveryOnlineSupabase(userId, online) {
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

export async function tienePedidoActivo(deliveryId) {
    const supabase = initSupabase();
    if (!supabase) return false;
    try {
        const { data, error } = await supabase
            .from('pedidos')
            .select('id')
            .eq('delivery_id', deliveryId)
            .in('estado', ['asignado', 'recogido'])
            .maybeSingle();
        
        if (error) throw error;
        return !!data;
    } catch(e) {
        console.error('Error verificando pedido activo:', e);
        return false;
    }
}

export async function deliveryTienePedidoActivo(deliveryId) {
    return tienePedidoActivo(deliveryId);
}

export async function getPedidoActivoDelDelivery(deliveryId) {
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

export async function getAllUsuariosSupabase() {
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

export async function eliminarUsuarioSupabase(userId) {
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

export async function guardarUbicacionEnSupabase(deliveryId, deliveryNombre, lat, lng, online) {
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

export async function obtenerUbicacionDeSupabase(deliveryId) {
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

export async function crearPedidoEnSupabase(pedido) {
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

export async function agarrarPedidoEnSupabase(pedidoId, deliveryId, deliveryNombre) {
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

export async function completarPedidoEnSupabase(pedidoId) {
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

initSupabase();