// ==================== VARIABLES GLOBALES ====================
let rolSeleccionado = 'cliente';

// Inicializar usuarios demo si no existen
if (!localStorage.getItem('usuarios')) {
    localStorage.setItem('usuarios', JSON.stringify([
        {id: 1, nombre: "Cliente Demo", email: "cliente@mandaya.com", telefono: "+52 961 123 4567", password: "1234", rol: "cliente", fechaRegistro: new Date().toISOString()},
        {id: 2, nombre: "Delivery Demo", email: "delivery@mandaya.com", telefono: "+52 961 123 4568", password: "1234", rol: "delivery", fechaRegistro: new Date().toISOString()}
    ]));
}

// ==================== FUNCIONES DE UTILIDAD ====================
function mostrarToast(mensaje, esError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.style.background = esError ? '#dc2626' : '#10b981';
    toast.textContent = mensaje;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
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

// ==================== LOGIN ====================
document.getElementById("loginForm").addEventListener("submit", function(e) {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    
    const usuarios = JSON.parse(localStorage.getItem('usuarios')) || [];
    const usuario = usuarios.find(u => u.email === email && u.password === password);
    
    if (usuario) {
        mostrarToast(`✅ ¡Bienvenido ${usuario.nombre}!`);
        localStorage.setItem('sesion_activa', JSON.stringify(usuario));
        
        setTimeout(() => {
            if (usuario.rol === 'cliente') {
                window.location.href = "cliente.html";
            } else if (usuario.rol === 'delivery') {
                window.location.href = "delivery.html";
            } else {
                window.location.href = "cliente.html";
            }
        }, 1000);
    } else {
        mostrarToast("❌ Correo o contraseña incorrectos", true);
    }
});

// ==================== MODALES REGISTRO ====================
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

// ==================== REGISTRO ====================
const registroForm = document.getElementById("registroForm");
if (registroForm) {
    registroForm.addEventListener("submit", function(e) {
        e.preventDefault();
        const nombre = document.getElementById("regNombre").value.trim();
        const email = document.getElementById("regEmail").value.trim();
        const telefono = document.getElementById("regTelefono").value.trim();
        const password = document.getElementById("regPassword").value;
        const confirmPassword = document.getElementById("regConfirmPassword").value;
        
        if (!nombre || !email || !telefono || !password || !confirmPassword) {
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
        
        const usuarios = JSON.parse(localStorage.getItem('usuarios')) || [];
        if (usuarios.find(u => u.email === email)) {
            mostrarToast("❌ Este correo ya está registrado", true);
            return;
        }
        
        const nuevoUsuario = {
            id: Date.now(),
            nombre: nombre,
            email: email,
            telefono: telefono,
            password: password,
            rol: rolSeleccionado,
            fechaRegistro: new Date().toISOString()
        };
        
        usuarios.push(nuevoUsuario);
        localStorage.setItem('usuarios', JSON.stringify(usuarios));
        mostrarToast(`✅ ¡Registro exitoso! Bienvenido ${nombre}`);
        cerrarModalRegistroForm();
        
        setTimeout(() => {
            if (rolSeleccionado === 'cliente') {
                window.location.href = "cliente.html";
            } else {
                window.location.href = "delivery.html";
            }
        }, 1500);
    });
}

// ==================== CERRAR MODALES CLICK FUERA ====================
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