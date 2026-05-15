// js/security.js - Módulo de seguridad completo

// ==================== HASHING DE CONTRASEÑAS ====================
// Usamos crypto.subtle (nativo del navegador, no requiere librerías externas)

class SecurityManager {
    constructor() {
        this.SESSION_KEY = 'sesion_segura';
        this.DEVICE_ID = this.getDeviceId();
        this.activeSessionCheck = null;
    }

    // Obtener ID único del dispositivo
    getDeviceId() {
        let deviceId = localStorage.getItem('device_id');
        if (!deviceId) {
            deviceId = this.generateUUID();
            localStorage.setItem('device_id', deviceId);
        }
        return deviceId;
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // ==================== HASHING DE CONTRASEÑAS ====================
    
    // Generar salt aleatorio
    async generateSalt() {
        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        return Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Hashear contraseña con salt (PBKDF2)
    async hashPassword(password, salt = null) {
        if (!salt) {
            salt = await this.generateSalt();
        }
        
        // Convertir password y salt a ArrayBuffer
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);
        const saltBuffer = encoder.encode(salt);
        
        // Derivar clave usando PBKDF2
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits']
        );
        
        const hashBuffer = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: saltBuffer,
                iterations: 100000,  // 100,000 iteraciones para seguridad
                hash: 'SHA-256'
            },
            keyMaterial,
            256  // 256 bits
        );
        
        // Convertir a hex
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        return `${salt}:${hashHex}`;
    }

    // Verificar contraseña contra hash almacenado
    async verifyPassword(password, storedHash) {
        const [salt, originalHash] = storedHash.split(':');
        const newHash = await this.hashPassword(password, salt);
        const [, newHashValue] = newHash.split(':');
        return originalHash === newHashValue;
    }

    // ==================== CONTROL DE SESIÓN ÚNICA ====================
    
    // Limpiar todo rastro de sesión (para conflictos)
    async limpiarTodo() {
        // Limpiar localStorage
        localStorage.removeItem(this.SESSION_KEY);
        localStorage.removeItem('sesion_activa_temp');
        localStorage.removeItem('device_id');
        console.log("🧹 Sesión limpiada por conflicto");
    }
    
    // Iniciar sesión (guardar token único)
    async iniciarSesion(usuario) {
        const sessionToken = this.generateUUID();
        const sessionData = {
            usuario_id: usuario.id,
            device_id: this.DEVICE_ID,
            session_token: sessionToken,
            fecha_inicio: new Date().toISOString(),
            user_agent: navigator.userAgent,
            ip_hash: await this.hashIP() // Simulado
        };
        
        // Guardar en localStorage (sesión local)
        localStorage.setItem(this.SESSION_KEY, JSON.stringify({
            ...usuario,
            session_token: sessionToken,
            device_id: this.DEVICE_ID
        }));
        
        // Guardar en Supabase (sesión activa)
        const supabase = window.supabaseClient;
        if (supabase) {
            // Marcar usuario como activo con su sesión
            await supabase
                .from('usuarios')
                .update({
                    online: true,
                    session_token: sessionToken,
                    device_id: this.DEVICE_ID,
                    last_login: new Date().toISOString()
                })
                .eq('id', usuario.id);
                
            // Registrar en tabla de sesiones (opcional)
            await this.registrarSesion(sessionData);
        }
        
        return sessionToken;
    }
    
    // Registrar sesión en Supabase (crear tabla si no existe)
    async registrarSesion(sessionData) {
        const supabase = window.supabaseClient;
        if (!supabase) return;
        
        try {
            await supabase.from('sesiones').insert([sessionData]);
        } catch(e) {
            console.log('Tabla sesiones no existe, omitiendo registro');
        }
    }
    
// Verificar si la sesión actual es válida (sin otra sesión en otro dispositivo)
async verificarSesionUnica() {
    const sesionLocal = localStorage.getItem(this.SESSION_KEY);
    if (!sesionLocal) return false;
    
    let usuarioLocal;
    try {
        usuarioLocal = JSON.parse(sesionLocal);
    } catch(e) {
        console.error("❌ Error parseando sesión local:", e);
        await this.limpiarTodo();
        return false;
    }
    
    const supabase = window.supabaseClient;
    if (!supabase) {
        console.warn("⚠️ Supabase no disponible, asumiendo sesión válida");
        return true; // Si no hay Supabase, asumir válido
    }
    
    try {
        // ✅ Obtener usuario actual desde Supabase
        const { data: usuario, error } = await supabase
            .from('usuarios')
            .select('session_token, device_id, online')
            .eq('id', usuarioLocal.id)
            .single();
        
        // ✅ Manejar error de usuario no encontrado (código PGRST116)
        if (error) {
            if (error.code === 'PGRST116') {
                console.warn("⚠️ Usuario no encontrado en BD, cerrando sesión");
                await this.limpiarTodo();
                this.cerrarSesionForzado();
                return false;
            }
            // Otros errores (red, timeout, etc.) - asumir válido para no bloquear
            console.warn("⚠️ Error de red al verificar sesión:", error.message);
            return true;
        }
        
        // ✅ Usuario no existe en respuesta
        if (!usuario) {
            console.warn("⚠️ Usuario sin datos en BD, cerrando sesión");
            await this.limpiarTodo();
            this.cerrarSesionForzado();
            return false;
        }
        
        // ✅ Si el usuario está offline, permitir acceso (puede ser cierre limpio)
        if (!usuario.online) {
            console.log("📴 Usuario está offline en BD, sesión válida");
            return true;
        }
        
        // ✅ Verificar que el token de sesión coincida Y el device_id
        const sessionValida = usuario.session_token === usuarioLocal.session_token &&
                              usuario.device_id === this.DEVICE_ID;
        
        if (!sessionValida) {
            console.warn("⚠️ Conflicto de sesión detectado - otro dispositivo activo");
            await this.limpiarTodo();
            this.cerrarSesionForzado();
            return false;
        }
        
        // ✅ Sesión válida
        console.log("✅ Sesión verificada correctamente");
        return true;
        
    } catch(e) {
        // ✅ Error inesperado (red caída, excepción, etc.)
        console.error("❌ Error inesperado verificando sesión:", e.message);
        // No cerramos sesión por error de red, asumimos válido para no frustrar usuario
        return true;
    }
}
    
    // Cerrar sesión forzadamente (cuando alguien más inició)
    async cerrarSesionForzado() {
        const sesionLocal = localStorage.getItem(this.SESSION_KEY);
        if (sesionLocal) {
            const usuario = JSON.parse(sesionLocal);
            const supabase = window.supabaseClient;
            if (supabase) {
                await supabase
                    .from('usuarios')
                    .update({
                        online: false,
                        session_token: null,
                        device_id: null
                    })
                    .eq('id', usuario.id);
            }
        }
        
        localStorage.removeItem(this.SESSION_KEY);
        
        // Mostrar mensaje y redirigir
        if (window.mostrarToast) {
            window.mostrarToast("⚠️ Sesión cerrada: iniciaste sesión en otro dispositivo", true);
        } else {
            alert("⚠️ Sesión cerrada: iniciaste sesión en otro dispositivo");
        }
        setTimeout(() => {
            window.location.href = "index.html";
        }, 2000);
    }
    
    // Iniciar monitoreo de sesión única (verificar cada 5 segundos)
    iniciarMonitoreoSesion() {
        if (this.activeSessionCheck) {
            clearInterval(this.activeSessionCheck);
        }
        
        this.activeSessionCheck = setInterval(async () => {
            const esValida = await this.verificarSesionUnica();
            if (!esValida) {
                if (this.activeSessionCheck) {
                    clearInterval(this.activeSessionCheck);
                    this.activeSessionCheck = null;
                }
            }
        }, 5000);
    }
    
    // Detener monitoreo
    detenerMonitoreoSesion() {
        if (this.activeSessionCheck) {
            clearInterval(this.activeSessionCheck);
            this.activeSessionCheck = null;
        }
    }
    
    // Simular hash de IP (para privacidad)
    async hashIP() {
        return 'hashed_' + this.generateUUID().substring(0, 8);
    }
    
    // Cerrar sesión normal
    async cerrarSesion() {
        this.detenerMonitoreoSesion();
        
        const sesionLocal = localStorage.getItem(this.SESSION_KEY);
        if (sesionLocal) {
            const usuario = JSON.parse(sesionLocal);
            const supabase = window.supabaseClient;
            if (supabase) {
                await supabase
                    .from('usuarios')
                    .update({
                        online: false,
                        session_token: null,
                        device_id: null
                    })
                    .eq('id', usuario.id);
            }
        }
        
        localStorage.removeItem(this.SESSION_KEY);
        window.location.href = "index.html";
    }
    
    // Obtener usuario actual (si hay sesión)
    obtenerUsuarioActual() {
        const sesion = localStorage.getItem(this.SESSION_KEY);
        if (!sesion) return null;
        try {
            return JSON.parse(sesion);
        } catch(e) {
            return null;
        }
    }
}

// Instancia global
const securityManager = new SecurityManager();
window.securityManager = securityManager;