// utils.js
export const API = "http://192.168.18.93:8000/api";

let session = null;
export function getSession() { return session; }
export function setSession(data) { session = data; }
export function clearSession() { session = null; }

export function getHeaders() {
    return {
        "Content-Type": "application/json",
        ...(session ? { "X-Token": session.token } : {})
    };
}

export function fmt(n) { return `S/ ${(n || 0).toFixed(2)}`; }

let toastTimer = null;
export function showToast(msg, type = "success") {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

// Funciones globales para onclick inline
export function showReceiptModal(imgUrl) {
    document.getElementById("receipt-image").src = imgUrl;
    document.getElementById("download-receipt-btn").href = imgUrl;
    document.getElementById("receipt-modal").classList.remove("hidden");
}
// Exportar a window para que los onclick inline funcionen
window.showReceiptModal = showReceiptModal;