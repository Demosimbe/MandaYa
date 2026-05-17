// ==================== VARIABLES GLOBALES ====================
let rolSeleccionado = 'cliente';

// ==================== FUNCIONES DE UTILIDAD ====================
// Fallback por si shared.js no carga
if (typeof window.mostrarToast !== 'function') {
    window.mostrarToast = function(msg, err) {
        console.log(`${err ? '❌' : '✅'} ${msg}`);
        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${err ? '#dc2626' : '#10b981'};
            color: white;
            padding: 12px 24px;
            border-radius: 50px;
            font-size: 14px;
            z-index: 100000;
            animation: fadeInOut 2.5s ease-in-out forwards;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    };
}

function togglePassword() {
    const password = document.getElementById("password");
    const eyeIcon = document.getElementById("eyeIcon");
    if (!password || !eyeIcon) return;
    
    if (password.type === "password") {
        password.type = "text";
        eyeIcon.classList.replace("fa-eye", "fa-eye-slash");
    } else {
        password.type = "password";
        eyeIcon.classList.replace("fa-eye-slash", "fa-eye");
    }
}

// ==================== LOGIN con Supabase ====================
const loginForm = document.getElementById("loginForm");
if (loginForm) {
    loginForm.addEventListener("submit", async function(e) {
        e.preventDefault();
        const email = document.getElementById("email")?.value.trim() || '';
        const password = document.getElementById("password")?.value || '';
        
        if (!email || !password) {
            mostrarToast("❌ Ingresa correo y contraseña", true);
            return;
        }
        
        mostrarToast("🔐 Verificando credenciales...");
        
        const resultado = await loginSupabase(email, password);
        
        if (resultado.error) {
            mostrarToast(`❌ ${resultado.error}`, true);
        } else {
            const usuario = resultado.data;
            mostrarToast(`✅ ¡Bienvenido ${usuario.nombre}!`);
            
            localStorage.setItem('sesion_activa_temp', JSON.stringify(usuario));
            
            setTimeout(() => {
                if (usuario.rol === 'cliente') {
                    window.location.href = "cliente.html";
                } else {
                    window.location.href = "delivery.html";
                }
            }, 1000);
        }
    });
} else {
    console.error("❌ Formulario de login no encontrado");
}

// ==================== REGISTRO con Supabase ====================
function mostrarOpcionesRegistro() {
    const modal = document.getElementById("modalRegistro");
    if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }
}

function cerrarModal() {
    const modal = document.getElementById("modalRegistro");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

function abrirFormularioRegistro(rol) {
    rolSeleccionado = rol;
    cerrarModal();
    const modalForm = document.getElementById("modalFormRegistro");
    const title = document.getElementById("registroTitle");
    const subtitle = document.getElementById("registroSubtitle");
    
    if (!modalForm) return;
    
    if (rol === 'cliente') {
        if (title) title.innerHTML = '<i class="fas fa-user mr-2"></i> Crear cuenta Cliente';
        if (subtitle) subtitle.textContent = 'Completa tus datos para enviar paquetes';
    } else {
        if (title) title.innerHTML = '<i class="fas fa-motorcycle mr-2"></i> Crear cuenta Delivery';
        if (subtitle) subtitle.textContent = 'Completa tus datos para comenzar a ganar';
    }
    modalForm.classList.remove("hidden");
    modalForm.classList.add("flex");
}

function cerrarModalRegistroForm() {
    const modalForm = document.getElementById("modalFormRegistro");
    if (modalForm) {
        modalForm.classList.add("hidden");
        modalForm.classList.remove("flex");
    }
    
    const inputs = ['regNombre', 'regEmail', 'regTelefono', 'regPassword', 'regConfirmPassword'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
}

const registroForm = document.getElementById("registroForm");
if (registroForm) {
    registroForm.addEventListener("submit", async function(e) {
        e.preventDefault();
        
        const nombre = document.getElementById("regNombre")?.value.trim() || '';
        const email = document.getElementById("regEmail")?.value.trim() || '';
        const telefono = document.getElementById("regTelefono")?.value.trim() || '';
        const password = document.getElementById("regPassword")?.value || '';
        const confirmPassword = document.getElementById("regConfirmPassword")?.value || '';
        
        if (!nombre || !email || !telefono || !password) {
            mostrarToast("❌ Completa todos los campos", true);
            return;
        }
        if (password !== confirmPassword) {
            mostrarToast("❌ Las contraseñas no coinciden", true);
            return;
        }
        if (password.length < 4) {
            mostrarToast("❌ La contraseña debe tener al menos 4 caracteres", true);
            return;
        }
        
        mostrarToast("📝 Creando cuenta...");
        
        const resultado = await registrarUsuarioSupabase(nombre, email, telefono, password, rolSeleccionado);
        
        if (resultado.error) {
            mostrarToast(`❌ ${resultado.error}`, true);
        } else {
            mostrarToast(`✅ ¡Registro exitoso! Ahora inicia sesión con ${email}`);
            cerrarModalRegistroForm();
            
            setTimeout(() => {
                window.location.href = "index.html";
            }, 2000);
        }
    });
} else {
    console.error("❌ Formulario de registro no encontrado");
}

// Cerrar modales click fuera
const modalRegistroElement = document.getElementById("modalRegistro");
if (modalRegistroElement) {
    modalRegistroElement.addEventListener("click", function(e) {
        if (e.target === this) cerrarModal();
    });
}

const modalFormRegistroElement = document.getElementById("modalFormRegistro");
if (modalFormRegistroElement) {
    modalFormRegistroElement.addEventListener("click", function(e) {
        if (e.target === this) cerrarModalRegistroForm();
    });
}

// app.js - Actualizar función de WhatsApp
function enviarComprobanteWhatsApp() {
    if (!pedidoPendiente) {
        mostrarToast("❌ No hay información del pedido", true);
        return;
    }
    
    const total = pedidoPendiente.tarifa;
    const pedidoId = pedidoPendiente.id;
    
    // ✅ Usar config centralizada
    const numeroWhatsApp = window.getWhatsAppNumber ? 
        window.getWhatsAppNumber() : '5219381083498';
    
    let mensaje = `🛵 *MANDAYA-NUEVO PEDIDO* 🛵\n`;
    mensaje += `─────────────────────\n`;
    mensaje += `🎫 Pedido: #${pedidoId}\n`;
    mensaje += `👤 Cliente: ${pedidoPendiente.cliente_nombre}\n`;
    mensaje += `─────────────────────\n`;
    mensaje += `📍 Origen:\n${pedidoPendiente.origen}\n`;
    mensaje += `─────────────────────\n`;
    mensaje += `🏁 Destino:\n${pedidoPendiente.destino}\n`;
    mensaje += `─────────────────────\n`;
    mensaje += `📏 ${pedidoPendiente.distancia_real} km | 📦 ${pedidoPendiente.tipo}\n`;
    mensaje += `💰 Total: $${total} MXN\n`;
    mensaje += `─────────────────────\n`;
    mensaje += `✅ Comprobante adjunto\n`;
    mensaje += `🙏 Gracias por usar MandaYa!`;
    
    const mensajeCodificado = encodeURIComponent(mensaje);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${numeroWhatsApp}&text=${mensajeCodificado}`;
    
    console.log("📱 Abriendo WhatsApp con URL:", whatsappUrl);
    window.open(whatsappUrl, '_blank');
    mostrarToast("📱 Abriendo WhatsApp para enviar comprobante");
}