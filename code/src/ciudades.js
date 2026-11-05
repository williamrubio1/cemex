'use strict';

/**
 * Ciudad / región del contacto. El Excel de CETEX no trae columna de ciudad, así que se deduce:
 *   1) del indicativo del teléfono FIJO (marcación nacional 60X + 7 dígitos), si lo hay;
 *   2) si no, de la hoja de origen (las hojas de Bogotá y Medellín).
 * Si no hay pista, queda NULL ("Sin ciudad").
 */

// Indicativos fijos de Colombia (plan de marcación 2021). 603 no está asignado.
const POR_INDICATIVO = {
  601: 'Bogotá',
  602: 'Cali / Suroccidente',
  604: 'Medellín / Antioquia',
  605: 'Costa Caribe',
  606: 'Eje Cafetero',
  607: 'Santanderes',
  608: 'Otras regiones',
};

const POR_HOJA = {
  BOGOTA: 'Bogotá',
  'BASE COMEX BOGOTA': 'Bogotá',
  'BASE MEDELLIN': 'Medellín / Antioquia',
  'MED-REGIMEN': 'Medellín / Antioquia',
};

/** Todas las etiquetas posibles (para los selectores de la interfaz). */
const ETIQUETAS = [...new Set([...Object.values(POR_INDICATIVO), ...Object.values(POR_HOJA)])];

const RE_CELULAR = /(?<!\d)(?:\+?57[\s\-.]*)?3\d{2}[\s\-.]*\d{3}[\s\-.]*\d{4}(?!\d)/g;

/** Primer indicativo 60X encontrado en un texto de teléfonos (ignora los celulares). */
function indicativoFijo(texto) {
  if (texto == null) return null;
  const sinCelulares = String(texto).replace(RE_CELULAR, ' ');
  // Une los grupos de un mismo número ("(601) 234 5678") y separa por cualquier otro carácter.
  for (const token of sinCelulares.replace(/[\s\-.()]/g, '').split(/\D+/)) {
    const m = token.match(/^(?:57)?(60[124-8])\d{7}$/);
    if (m) return m[1];
  }
  return null;
}

/** Ciudad explícita por indicativo (o null). */
const ciudadPorFijo = (...textos) => {
  for (const t of textos) {
    const ind = indicativoFijo(t);
    if (ind) return POR_INDICATIVO[ind];
  }
  return null;
};

/** Ciudad por hoja de origen (o null). */
const ciudadPorHoja = (hoja) => POR_HOJA[String(hoja || '').trim().toUpperCase()] || null;

module.exports = { ETIQUETAS, indicativoFijo, ciudadPorFijo, ciudadPorHoja };
