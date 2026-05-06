// Configuración de Supabase - UNICO ARCHIVO
if (typeof window.SUPABASE_URL === 'undefined') {
    window.SUPABASE_URL = 'https://ewjljddexyajxuzzzssp.supabase.co';
    window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3amxqZGRleHlhanh1enp6c3NwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODAyMDExOSwiZXhwIjoyMDkzNTk2MTE5fQ.Xcb3vGH7a7Q0RA9-RlnZ1wUrWNXAV7YxEWiTPGsOMPU';
}

const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

let supabaseClient = null;
let supabaseInicializado = false;

function initSupabase() {
    if (typeof supabase !== 'undefined' && !supabaseClient) {
        try {
            supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            supabaseInicializado = true;
            console.log('✅ Supabase inicializado');
        } catch(e) {
            console.error('❌ Error inicializando Supabase:', e);
            supabaseInicializado = false;
        }
    }
    return supabaseClient;
}

// Guardar ubicación del delivery en Supabase
async function guardarUbicacionEnSupabase(deliveryId, deliveryNombre, lat, lng, online) {
    if (!supabaseInicializado) initSupabase();
    if (!supabaseClient) return null;
    
    try {
        const { data, error } = await supabaseClient
            .from('ubicaciones')
            .upsert({
                delivery_id: deliveryId,
                delivery_nombre: deliveryNombre,
                lat: lat,
                lng: lng,
                online: online,
                updated_at: new Date()
            }, {
                onConflict: 'delivery_id'
            });
        
        if (error) console.error('Error guardando ubicación:', error);
        return { data, error };
    } catch(e) {
        console.error('Error en guardarUbicacionEnSupabase:', e);
        return null;
    }
}

// Obtener ubicación de un delivery
async function obtenerUbicacionDeSupabase(deliveryId) {
    if (!supabaseInicializado) initSupabase();
    if (!supabaseClient) return null;
    
    try {
        const { data, error } = await supabaseClient
            .from('ubicaciones')
            .select('*')
            .eq('delivery_id', deliveryId)
            .maybeSingle();
        
        if (error) console.error('Error obteniendo ubicación:', error);
        return data;
    } catch(e) {
        console.error('Error en obtenerUbicacionDeSupabase:', e);
        return null;
    }
}

// Suscribirse a cambios en tiempo real
function suscribirUbicacionEnTiempoReal(deliveryId, callback) {
    if (!supabaseInicializado) initSupabase();
    if (!supabaseClient) return null;
    
    try {
        const subscription = supabaseClient
            .channel(`ubicaciones_${deliveryId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'ubicaciones',
                filter: `delivery_id=eq.${deliveryId}`
            }, (payload) => {
                if (payload.new && callback) {
                    callback(payload.new);
                }
            })
            .subscribe();
        
        return subscription;
    } catch(e) {
        console.error('Error en suscripción:', e);
        return null;
    }
}

// Crear pedido en Supabase
async function crearPedidoEnSupabase(pedido) {
    if (!supabaseInicializado) initSupabase();
    if (!supabaseClient) return null;
    
    try {
        const { data, error } = await supabaseClient
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
        
        if (error) console.error('Error creando pedido:', error);
        return { data, error };
    } catch(e) {
        console.error('Error en crearPedidoEnSupabase:', e);
        return null;
    }
}

// Obtener pedidos pendientes
async function obtenerPedidosPendientesDeSupabase() {
    if (!supabaseInicializado) initSupabase();
    if (!supabaseClient) return [];
    
    try {
        const { data, error } = await supabaseClient
            .from('pedidos')
            .select('*')
            .eq('estado', 'pendiente')
            .order('fecha', { ascending: true });
        
        if (error) console.error('Error obteniendo pedidos:', error);
        return data || [];
    } catch(e) {
        console.error('Error en obtenerPedidosPendientesDeSupabase:', e);
        return [];
    }
}

// Agarrar pedido
async function agarrarPedidoEnSupabase(pedidoId, deliveryId, deliveryNombre) {
    if (!supabaseInicializado) initSupabase();
    if (!supabaseClient) return null;
    
    try {
        const { data, error } = await supabaseClient
            .from('pedidos')
            .update({
                estado: 'asignado',
                delivery_id: deliveryId,
                delivery_nombre: deliveryNombre
            })
            .eq('id', pedidoId)
            .eq('estado', 'pendiente');
        
        if (error) console.error('Error agarrando pedido:', error);
        return { data, error };
    } catch(e) {
        console.error('Error en agarrarPedidoEnSupabase:', e);
        return null;
    }
}

// Completar pedido
async function completarPedidoEnSupabase(pedidoId) {
    if (!supabaseInicializado) initSupabase();
    if (!supabaseClient) return null;
    
    try {
        const { data, error } = await supabaseClient
            .from('pedidos')
            .update({
                estado: 'completado',
                fecha_completado: new Date()
            })
            .eq('id', pedidoId);
        
        if (error) console.error('Error completando pedido:', error);
        return { data, error };
    } catch(e) {
        console.error('Error en completarPedidoEnSupabase:', e);
        return null;
    }
}

// Obtener pedidos activos de un delivery
async function obtenerPedidosActivosDeSupabase(deliveryId) {
    if (!supabaseInicializado) initSupabase();
    if (!supabaseClient) return [];
    
    try {
        const { data, error } = await supabaseClient
            .from('pedidos')
            .select('*')
            .eq('delivery_id', deliveryId)
            .in('estado', ['asignado'])
            .order('fecha', { ascending: true });
        
        if (error) console.error('Error obteniendo pedidos activos:', error);
        return data || [];
    } catch(e) {
        console.error('Error en obtenerPedidosActivosDeSupabase:', e);
        return [];
    }
}

// Obtener pedidos de un cliente
async function obtenerPedidosClienteDeSupabase(clienteId) {
    if (!supabaseInicializado) initSupabase();
    if (!supabaseClient) return [];
    
    try {
        const { data, error } = await supabaseClient
            .from('pedidos')
            .select('*')
            .eq('cliente_id', clienteId)
            .order('fecha', { ascending: false });
        
        if (error) console.error('Error obteniendo pedidos del cliente:', error);
        return data || [];
    } catch(e) {
        console.error('Error en obtenerPedidosClienteDeSupabase:', e);
        return [];
    }
}

// Inicializar solo una vez
if (!window.supabaseInitialized) {
    window.supabaseInitialized = true;
    initSupabase();
}