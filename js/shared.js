// js/shared.js - Utilidades compartidas
const Shared = {
    mostrarToast(msg, isError = false) {
        const existing = document.querySelector('.shared-toast');
        if (existing) existing.remove();
        
        const toast = document.createElement('div');
        toast.className = 'shared-toast';
        toast.textContent = msg;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${isError ? '#dc2626' : '#10b981'};
            color: white;
            padding: 12px 24px;
            border-radius: 9999px;
            z-index: 100000;
            font-size: 14px;
            font-family: system-ui, -apple-system, sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: fadeInOut 3s ease forwards;
        `;
        
        // Agregar animación si no existe
        if (!document.querySelector('#toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
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
        
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
};

window.Shared = Shared;