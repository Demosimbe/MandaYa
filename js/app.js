// ==================== VARIABLES GLOBALES ====================
let rolSeleccionado = 'cliente';

// ==================== FUNCIONES DE UTILIDAD ====================
function mostrarToast(mensaje, esError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${esError ? '#dc2626' : '#10b981'};
        color: white;
        padding: 12px 24px;
        border-radius: 50px;
        font-size: 14px;
        z-index: 100000;
        animation: fadeInOut 2.5s ease-in-out forwards;
    `;
    toast.textContent = mensaje;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

function togglePassword() {
    const password = document.getElementById("password");
    const eyeIcon = document.getElementById("eyeIcon");
    if (password.type === "password") {
        password.type = "text";
        eyeIcon.classList.replace("fa-eye", "fa-eye-slash");
    } else {
        password.type = "password";
        eyeIcon.classList.replace("fa-eye-slash", "fa-eye");
    }
}

// ==================== LOGIN con Supabase ====================
document.getElementById("loginForm").addEventListener("submit", async function(e) {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    
    mostrarToast("🔐 Verificando credenciales...");
    
    const resultado = await loginSupabase(email, password);
    
    if (resultado.error) {
        mostrarToast(`❌ ${resultado.error}`, true);
    } else {
        const usuario = resultado.data;
        mostrarToast(`✅ ¡Bienvenido ${usuario.nombre}!`);
        
        // Guardar sesión activa
        localStorage.setItem('sesion_activa', JSON.stringify(usuario));
        
        setTimeout(() => {
            if (usuario.rol === 'cliente') {
                window.location.href = "cliente.html";
            } else {
                window.location.href = "delivery.html";
            }
        }, 1000);
    }
});

// ==================== REGISTRO con Supabase ====================
function mostrarOpcionesRegistro() {
    document.getElementById("modalRegistro").classList.remove("hidden");
    document.getElementById("modalRegistro").classList.add("flex");
}

function cerrarModal() {
    const modal = document.getElementById("modalRegistro");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function abrirFormularioRegistro(rol) {
    rolSeleccionado = rol;
    cerrarModal();
    const modalForm = document.getElementById("modalFormRegistro");
    const title = document.getElementById("registroTitle");
    const subtitle = document.getElementById("registroSubtitle");
    
    if (rol === 'cliente') {
        title.innerHTML = '<i class="fas fa-user mr-2"></i> Crear cuenta Cliente';
        subtitle.textContent = 'Completa tus datos para enviar paquetes';
    } else {
        title.innerHTML = '<i class="fas fa-motorcycle mr-2"></i> Crear cuenta Delivery';
        subtitle.textContent = 'Completa tus datos para comenzar a ganar';
    }
    modalForm.classList.remove("hidden");
    modalForm.classList.add("flex");
}

function cerrarModalRegistroForm() {
    const modalForm = document.getElementById("modalFormRegistro");
    modalForm.classList.add("hidden");
    modalForm.classList.remove("flex");
    document.getElementById("regNombre").value = '';
    document.getElementById("regEmail").value = '';
    document.getElementById("regTelefono").value = '';
    document.getElementById("regPassword").value = '';
    document.getElementById("regConfirmPassword").value = '';
}

const registroForm = document.getElementById("registroForm");
if (registroForm) {
    registroForm.addEventListener("submit", async function(e) {
        e.preventDefault();
        const nombre = document.getElementById("regNombre").value.trim();
        const email = document.getElementById("regEmail").value.trim();
        const telefono = document.getElementById("regTelefono").value.trim();
        const password = document.getElementById("regPassword").value;
        const confirmPassword = document.getElementById("regConfirmPassword").value;
        
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
            mostrarToast(`✅ ¡Registro exitoso! Bienvenido ${nombre}`);
            cerrarModalRegistroForm();
            
            // Iniciar sesión automáticamente
            localStorage.setItem('sesion_activa', JSON.stringify(resultado.data));
            
            setTimeout(() => {
                if (rolSeleccionado === 'cliente') {
                    window.location.href = "cliente.html";
                } else {
                    window.location.href = "delivery.html";
                }
            }, 1500);
        }
    });
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