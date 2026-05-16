// js/shared.js - Utilidades compartidas

window.addEventListener('error', (e) => {
    if (e.message && e.message.includes('message port closed')) {
        e.preventDefault();
        return true;
    }
});

// Objeto Shared para utilidades adicionales
const Shared = {
    // Puedes agregar más utilidades aquí si es necesario
    version: '1.0.0'
};

// Sanitiza texto para evitar inyección HTML
function sanitizarHTML(texto) {
    if (!texto) return '';
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function confirmarConModal(mensaje, onConfirm, onCancel) {
    // Crear un modal simple similar al que ya usas
    let modalExistente = document.getElementById("modalConfirmacionSimple");
    if (modalExistente) modalExistente.remove();
    
    const modal = document.createElement('div');
    modal.id = "modalConfirmacionSimple";
    modal.className = "fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10002] p-4";
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-3xl max-w-sm w-full modal-uber text-center p-6">
            <div class="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-question-circle text-3xl text-blue-500"></i>
            </div>
            <p class="text-gray-200 text-sm mb-6">${mensaje}</p>
            <div class="flex gap-3">
                <button id="btnCancelarSimple" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-xl transition-all">Cancelar</button>
                <button id="btnAceptarSimple" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-xl transition-all">Aceptar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById("btnAceptarSimple").onclick = () => {
        modal.remove();
        if (onConfirm) onConfirm();
    };
    document.getElementById("btnCancelarSimple").onclick = () => {
        modal.remove();
        if (onCancel) onCancel();
    };
}

// Función global de toast (única y definitiva)
window.mostrarToast = function(msg, err = false) {
    // Eliminar toasts anteriores para evitar acumulación
    const toastsAnteriores = document.querySelectorAll('.toast-moderno');
    toastsAnteriores.forEach(toast => toast.remove());
    
    const toast = document.createElement('div');
    toast.className = 'toast-moderno';
    
    const isMobile = window.innerWidth < 768;
    const paddingY = isMobile ? '12px' : '14px';
    const paddingX = isMobile ? '20px' : '28px';
    const fontSize = isMobile ? '13px' : '14px';
    
    let icono = err ? 'fa-exclamation-triangle' : 'fa-check-circle';
    let colorFondo = err 
        ? 'linear-gradient(135deg, #dc2626, #b91c1c)' 
        : 'linear-gradient(135deg, #10b981, #059669)';
    
    // Personalizar icono según el mensaje
    if (msg.includes('📍')) icono = 'fa-location-dot';
    else if (msg.includes('🏁')) icono = 'fa-flag-checkered';
    else if (msg.includes('💰') || msg.includes('$')) icono = 'fa-money-bill-wave';
    else if (msg.includes('🚚') || msg.includes('delivery')) icono = 'fa-motorcycle';
    else if (msg.includes('✅')) icono = 'fa-circle-check';
    else if (msg.includes('❌')) icono = 'fa-circle-exclamation';
    else if (msg.includes('🔐')) icono = 'fa-lock';
    else if (msg.includes('📝')) icono = 'fa-pen';
    else if (msg.includes('📦')) icono = 'fa-box';
    
    toast.style.cssText = `
        position: fixed;
        bottom: ${isMobile ? '80px' : '20px'};
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: ${colorFondo};
        color: white;
        padding: ${paddingY} ${paddingX};
        border-radius: ${isMobile ? '30px' : '50px'};
        font-size: ${fontSize};
        font-weight: 500;
        z-index: 100000;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 10px;
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        backdrop-filter: blur(4px);
        border: 1px solid rgba(255,255,255,0.2);
        max-width: ${isMobile ? '85%' : 'auto'};
        white-space: ${isMobile ? 'normal' : 'nowrap'};
        text-align: center;
        line-height: 1.4;
        word-break: break-word;
    `;
    
    const msgSanitizada = sanitizarHTML(msg);
    toast.innerHTML = `<i class="fas ${icono}" style="font-size: ${isMobile ? '16px' : '18px'};"></i><span>${msgSanitizada}</span>`;
    document.body.appendChild(toast);
    
    // Animación de entrada
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toast.style.opacity = '1';
    }, 10);
    
    // Duración según tipo de mensaje
    const duracion = err ? 3500 : (msg.length > 50 ? 3500 : 2500);
    
    // Animación de salida
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    }, duracion);
};

// Exportar Shared globalmente
window.Shared = Shared;

// Agregar estilos para la animación del toast si no existen
if (!document.querySelector('#toast-global-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-global-styles';
    style.textContent = `
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
            15% { opacity: 1; transform: translateX(-50%) translateY(0); }
            85% { opacity: 1; transform: translateX(-50%) translateY(0); }
            100% { opacity: 0; transform: translateX(-50%) translateY(20px); visibility: hidden; }
        }
    `;
    document.head.appendChild(style);
}

console.log("✅ shared.js cargado correctamente");