'use strict';

/** Utilidades de teléfonos (sin dependencias de la base de datos). */

/**
 * Normaliza un número a E.164 colombiano: +573XXXXXXXXX.
 * Acepta "300 123 4567", "3001234567", "57 300...", "+57300...".
 * Devuelve null si no parece un celular colombiano válido.
 */
function normalizarCelular(raw) {
  if (raw == null) return null;
  let d = String(raw).replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('57') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('3')) return '+57' + d;
  return null;
}

/**
 * Extrae TODOS los celulares colombianos de un texto libre, en orden.
 * Soporta separadores y basura típica del Excel: "311 -6171638",
 * "(601)5745359-3116394728", "57 310 388 7543 / 601 123 4567".
 */
function extraerCelulares(texto) {
  if (texto == null) return [];
  const re = /(?<!\d)(?:\+?57[\s\-.]*)?(3\d{2})[\s\-.]*(\d{3})[\s\-.]*(\d{4})(?!\d)/g;
  const out = [];
  for (const m of String(texto).matchAll(re)) {
    const c = '+57' + m[1] + m[2] + m[3];
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Números que nunca se deben contactar (p. ej. la línea de ventas de CETEX). */
function celularesExcluidos() {
  return new Set(
    String(process.env.EXCLUIR_CELULARES || '')
      .split(',')
      .map((s) => normalizarCelular(s.trim()))
      .filter(Boolean)
  );
}

module.exports = { normalizarCelular, extraerCelulares, celularesExcluidos };
