'use strict';

/**
 * Valores de las variables de cada plantilla y enlace personalizado al asesor.
 *
 * campanas.variables lista las variables de la plantilla en orden (ej. "nombre,capacitacion"):
 *   NULL  -> modo anterior: una variable según TEMPLATE_PARAM_NAME (ver whatsapp.js)
 *   "-"   -> la plantilla no tiene variables
 *
 * Variables disponibles:
 *   nombre        primer nombre (del registro del chat, si no de la base)
 *   capacitacion  la capacitación que eligió en la pregunta A ("el Seminario de Cierre…")
 *   empresa       empresa del registro o de la base
 *
 * En una campaña de seguimiento los datos salen del registro de la campaña de ORIGEN.
 */

const db = require('./db');
const { tipoTitulo } = require('./normalizar');
const { waComprobante, WA_NUMERO } = require('./oferta');

const NOMBRE_DEFECTO = process.env.TEMPLATE_NOMBRE_DEFECTO || 'estimado(a)';

// Cómo se nombra cada respuesta de la pregunta A dentro de una frase ("…para {{capacitacion}}").
const CAPACITACION = {
  cierre: 'el Seminario de Cierre Contable y Fiscal',
  sagrilaft: 'el Taller práctico SAGRILAFT y PTEE',
  ambas: 'el Seminario de Cierre Contable y el Taller SAGRILAFT y PTEE',
};
const CAPACITACION_DEFECTO = 'nuestras capacitaciones';

/** Meta rechaza variables vacías, con saltos de línea o con más de 4 espacios seguidos. */
const limpio = (s, def) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 120) || def;

const listaVariables = (campana) =>
  campana && campana.variables != null && String(campana.variables).trim() !== ''
    ? String(campana.variables).split(',').map((v) => v.trim()).filter(Boolean)
    : null;

/** Registro del cuestionario que aplica a la campaña (el de origen si es seguimiento). */
async function registroDe(campana, contactoId) {
  const id = campana.origen_campana_id || campana.id;
  const rows = await db.query('SELECT * FROM registros WHERE contacto_id = ? AND campana_id = ? LIMIT 1', [contactoId, id]);
  return rows[0] || null;
}

function valores(contacto, registro) {
  const primer = (registro?.nombre || contacto?.primer_nombre || contacto?.nombre || '').split(' ')[0];
  return {
    nombre: limpio(primer ? tipoTitulo(primer) : '', NOMBRE_DEFECTO),
    capacitacion: CAPACITACION[registro?.interes] || CAPACITACION_DEFECTO,
    empresa: limpio(registro?.empresa || contacto?.empresa, 'tu empresa'),
  };
}

/**
 * Parámetros del cuerpo de la plantilla: [{ nombre, valor }] o null (modo anterior).
 * Lanza si la campaña pide una variable desconocida (error de configuración).
 */
async function parametrosPlantilla(campana, contacto) {
  const vars = listaVariables(campana);
  if (!vars) return null;
  if (vars[0] === '-') return [];
  const reg = vars.some((v) => v !== 'nombre') || campana.origen_campana_id ? await registroDe(campana, contacto.id) : null;
  const val = valores(contacto, reg);
  return vars.map((v) => {
    if (!(v in val)) throw new Error(`Variable desconocida "${v}" en la campaña ${campana.codigo}`);
    return { nombre: v, valor: val[v] };
  });
}

/** Quién es el contacto (nombre, empresa) y qué capacitación eligió, para el mensaje al asesor. */
async function quienEs(campana, contactoId) {
  const [contacto] = await db.query('SELECT * FROM contactos WHERE id = ? LIMIT 1', [contactoId]);
  const reg = await registroDe(campana, contactoId);
  const nombre = reg?.nombre || (contacto?.nombre ? tipoTitulo(contacto.nombre) : '');
  const soy = nombre ? `Soy ${nombre}${reg?.empresa ? ` de ${reg.empresa}` : ''}` : '';
  return { soy, capacitacion: CAPACITACION[reg?.interes] || null };
}

/**
 * Enlace al WhatsApp del asesor con un mensaje ya escrito que dice quién es y qué pidió,
 * para que el asesor no tenga que preguntarlo. Solo para enlaces wa.me.
 */
async function enlaceAsesor(campana, contactoId) {
  const base = String(campana.url_inscripcion || '');
  let url;
  try {
    url = new URL(base);
  } catch {
    return base;
  }
  if (!/(^|\.)wa\.me$/.test(url.hostname) || !contactoId) return base;
  const { soy, capacitacion } = await quienEs(campana, contactoId);
  const partes = [];
  if (soy) partes.push(soy);
  if (capacitacion) partes.push(`me interesa ${capacitacion}`);
  if (!partes.length) return base;
  const texto = url.searchParams.get('text') || 'Hola';
  url.searchParams.set('text', `${texto}. ${partes.join(', ')}.`);
  return url.toString();
}

/** Enlace al WhatsApp de ventas para enviar el comprobante de pago ("Soy …, te envío el comprobante…"). */
async function enlaceComprobante(campana, contactoId) {
  const base = waComprobante();
  if (!contactoId) return base;
  const { soy, capacitacion } = await quienEs(campana, contactoId);
  const texto =
    `Hola, CETEX. ${soy ? soy + '. ' : ''}Te envío el comprobante de pago` +
    `${capacitacion ? ` de mi inscripción en ${capacitacion}` : ' de mi inscripción'}.`;
  return `https://wa.me/${WA_NUMERO}?text=${encodeURIComponent(texto)}`;
}

module.exports = { parametrosPlantilla, enlaceAsesor, enlaceComprobante, listaVariables, CAPACITACION, valores };
