/**
 * math.js
 * Utilidades matemáticas seguras para contabilidad y manejo de moneda.
 * Resuelve problemas de precisión de punto flotante convirtiendo a enteros (céntimos).
 */

export function toCents(val) {
    return Math.round((parseFloat(val) || 0) * 100);
}

export function fromCents(cents) {
    return cents / 100;
}

/**
 * Suma dos montos de forma segura.
 */
export function safeAdd(a, b) {
    return fromCents(toCents(a) + toCents(b));
}

/**
 * Resta dos montos de forma segura (a - b).
 */
export function safeSubtract(a, b) {
    return fromCents(toCents(a) - toCents(b));
}

/**
 * Multiplica un monto por un factor (ej. cantidad) de forma segura.
 * El factor no se convierte a céntimos, solo el monto.
 */
export function safeMultiply(amount, multiplier) {
    return fromCents(Math.round(toCents(amount) * (parseFloat(multiplier) || 0)));
}

/**
 * Divide un monto entre un divisor de forma segura.
 */
export function safeDivide(amount, divisor) {
    const div = parseFloat(divisor) || 1;
    if (div === 0) return 0;
    return fromCents(Math.round(toCents(amount) / div));
}
