'use strict';

/**
 * WhatsApp Cloud API — envío de plantilla, texto e interactivos.
 *
 * Endpoint: https://graph.facebook.com/<GRAPH_VERSION>/<PHONE_NUMBER_ID>/messages
 * Auth:     Bearer <WHATSAPP_TOKEN>
 *
 * Cada envío se registra en la tabla `mensajes` (direccion 'out').
 * Todas las funciones devuelven el `wa_message_id` del mensaje enviado.
 */

require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const db = require('./db');

const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v26.0';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
// Si la plantilla usa una variable con NOMBRE (ej. {{nombre}}), poner ese nombre aquí.
// Si usa la posicional {{1}}, dejar vacío. Si no tiene variables, poner "-".
const TEMPLATE_PARAM_NAME = (process.env.TEMPLATE_PARAM_NAME || '').trim();
// Saludo cuando el contacto no tiene nombre: "Hola estimado(a), le saluda CETEX."
const NOMBRE_DEFECTO = process.env.TEMPLATE_NOMBRE_DEFECTO || 'estimado(a)';
// Índice (0, 1, 2…) del botón "Quiero participar" si su URL es DINÁMICA
// (https://<dominio>/r/{{1}}). Vacío = URL estática, no se envía parámetro.
const URL_BTN_INDEX = (process.env.TEMPLATE_URL_BOTON_INDEX || '').trim();

// WHATSAPP_API_BASE solo se usa en pruebas locales (simulador de la API); en producción, vacío.
const API_BASE = (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/+$/, '');
const BASE_URL = `${API_BASE}/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

// Meta espera el número en E.164 sin '+'
const soloDigitos = (to) => String(to).replace(/\D/g, '');
const recortar = (s, n) => (String(s).length <= n ? String(s) : String(s).slice(0, n));

/** POST al endpoint de mensajes. Lanza con un mensaje útil si la API falla. */
async function llamarAPI(payload) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error('Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID en el .env');
  }
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000), // que un envío colgado no frene el lote
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    const detalle = e.error_data?.details ? ` — ${e.error_data.details}` : '';
    const err = new Error(`WhatsApp API ${res.status}: ${e.message || 'error'}${e.code ? ` (code ${e.code})` : ''}${detalle}`);
    err.code = Number(e.code) || null; // para decidir si se pausa un lote o solo falla ese contacto
    err.status = res.status;
    throw err;
  }
  return data; // { messaging_product, contacts, messages: [{ id }] }
}

async function registrarSalida(to, tipo, contenido, data) {
  try {
    await db.registrarMensaje({
      celular: '+' + soloDigitos(to),
      direccion: 'out',
      tipo,
      contenido,
      wa_message_id: data?.messages?.[0]?.id || null,
    });
  } catch (err) {
    console.warn('[whatsapp] no se pudo registrar el envío en `mensajes`:', err.message);
  }
}

/**
 * Componentes de la plantilla.
 * - `parametros` ([{ nombre, valor }], de campanas.variables): variables con nombre, en orden.
 * - Sin `parametros` (modo anterior): una variable = primer nombre, según TEMPLATE_PARAM_NAME.
 * - Si aplica, el token del botón de URL dinámica.
 */
function componentesPlantilla(nombre, urlToken, parametros) {
  const comps = [];
  if (Array.isArray(parametros)) {
    if (parametros.length) {
      comps.push({
        type: 'body',
        parameters: parametros.map((p) => ({ type: 'text', parameter_name: p.nombre, text: String(p.valor) })),
      });
    }
  } else if (TEMPLATE_PARAM_NAME !== '-') {
    const p = { type: 'text', text: String(nombre || NOMBRE_DEFECTO) };
    if (TEMPLATE_PARAM_NAME) p.parameter_name = TEMPLATE_PARAM_NAME; // variable con nombre
    comps.push({ type: 'body', parameters: [p] });
  }
  if (URL_BTN_INDEX !== '' && urlToken) {
    comps.push({
      type: 'button',
      sub_type: 'url',
      index: URL_BTN_INDEX,
      parameters: [{ type: 'text', text: String(urlToken) }],
    });
  }
  return comps;
}

/**
 * Plantilla de la campaña (único mensaje que se puede enviar fuera de la ventana de 24 h).
 * @param {string} to
 * @param {{plantilla:string, idioma?:string, nombre?:string, urlToken?:string, parametros?:{nombre:string,valor:string}[]|null}} o
 */
async function enviarPlantilla(to, o) {
  const payload = {
    messaging_product: 'whatsapp',
    to: soloDigitos(to),
    type: 'template',
    template: {
      name: o.plantilla || process.env.TEMPLATE_NAME,
      language: { code: o.idioma || process.env.TEMPLATE_LANG || 'es_CO' },
      components: componentesPlantilla(o.nombre, o.urlToken, o.parametros),
    },
  };
  const data = await llamarAPI(payload);
  await registrarSalida(to, 'template', payload.template, data);
  return data.messages?.[0]?.id || null;
}

/** Texto libre (solo dentro de la ventana de 24 h). */
async function enviarTexto(to, texto) {
  const payload = {
    messaging_product: 'whatsapp',
    to: soloDigitos(to),
    type: 'text',
    text: { body: String(texto), preview_url: true },
  };
  const data = await llamarAPI(payload);
  await registrarSalida(to, 'text', payload.text, data);
  return data.messages?.[0]?.id || null;
}

/**
 * Mensaje interactivo con botones de respuesta rápida (1 a 3).
 * @param {string} to
 * @param {string} cuerpo  texto del mensaje (máx. 1024)
 * @param {{id:string,title:string}[]} botones  el título se recorta a 20 caracteres
 */
async function enviarBotones(to, cuerpo, botones) {
  if (!Array.isArray(botones) || botones.length < 1 || botones.length > 3) {
    throw new Error('enviarBotones: se requieren entre 1 y 3 botones');
  }
  const payload = {
    messaging_product: 'whatsapp',
    to: soloDigitos(to),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: recortar(cuerpo, 1024) },
      action: {
        buttons: botones.map((b) => ({
          type: 'reply',
          reply: { id: recortar(b.id, 256), title: recortar(b.title, 20) },
        })),
      },
    },
  };
  const data = await llamarAPI(payload);
  await registrarSalida(to, 'interactive', payload.interactive, data);
  return data.messages?.[0]?.id || null;
}

/**
 * Mensaje interactivo tipo lista (para más de 3 opciones; máx. 10 filas).
 * @param {string} to
 * @param {string} cuerpo       texto del mensaje (máx. 1024)
 * @param {string} tituloBoton  texto del botón que abre la lista (máx. 20)
 * @param {string} seccion      título de la sección (máx. 24)
 * @param {{id:string,title:string,description?:string}[]} filas
 */
async function enviarLista(to, cuerpo, tituloBoton, seccion, filas) {
  if (!Array.isArray(filas) || filas.length < 1 || filas.length > 10) {
    throw new Error('enviarLista: se requieren entre 1 y 10 filas');
  }
  const payload = {
    messaging_product: 'whatsapp',
    to: soloDigitos(to),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: recortar(cuerpo, 1024) },
      action: {
        button: recortar(tituloBoton, 20),
        sections: [
          {
            title: recortar(seccion, 24),
            rows: filas.map((f) => {
              const fila = { id: recortar(f.id, 200), title: recortar(f.title, 24) };
              if (f.description) fila.description = recortar(f.description, 72);
              return fila;
            }),
          },
        ],
      },
    },
  };
  const data = await llamarAPI(payload);
  await registrarSalida(to, 'interactive', payload.interactive, data);
  return data.messages?.[0]?.id || null;
}

/**
 * Mensaje interactivo con un botón que abre un enlace (solo dentro de la ventana de 24 h).
 * @param {string} to
 * @param {string} cuerpo       texto (máx. 1024)
 * @param {string} textoBoton   máx. 20 caracteres
 * @param {string} url
 */
async function enviarCtaUrl(to, cuerpo, textoBoton, url) {
  const payload = {
    messaging_product: 'whatsapp',
    to: soloDigitos(to),
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: recortar(cuerpo, 1024) },
      action: {
        name: 'cta_url',
        parameters: { display_text: recortar(textoBoton, 20), url: String(url) },
      },
    },
  };
  const data = await llamarAPI(payload);
  await registrarSalida(to, 'interactive', payload.interactive, data);
  return data.messages?.[0]?.id || null;
}

// ─── Medios subidos a Meta ──────────────────────────────────
// Un PDF enviado por enlace obliga a Meta a descargarlo en cada envío (lento: el mensaje
// siguiente llega antes). Subido una vez, se reutiliza su id: Meta lo guarda 30 días.
const VIDA_MEDIO_MS = 20 * 24 * 60 * 60 * 1000;
const medios = new Map(); // ruta local -> { t, promesa: Promise<id> }

/** id de Meta de un archivo local (lo sube la primera vez o si el id está por vencer). */
function idMedio(ruta, tipo = 'application/pdf') {
  const m = medios.get(ruta);
  if (m && Date.now() - m.t < VIDA_MEDIO_MS) return m.promesa;
  const promesa = (async () => {
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) throw new Error('Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID en el .env');
    const buf = await fs.readFile(ruta);
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', tipo);
    form.append('file', new Blob([buf], { type: tipo }), path.basename(ruta));
    const res = await fetch(`${API_BASE}/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
      body: form,
      signal: AbortSignal.timeout(90000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) throw new Error(`subida a Meta ${res.status}: ${data.error?.message || 'sin id'}`);
    console.log(`[whatsapp] ${path.basename(ruta)} subido a Meta (id ${data.id})`);
    return data.id;
  })();
  medios.set(ruta, { t: Date.now(), promesa });
  promesa.catch(() => medios.delete(ruta)); // si falla, se reintenta en el próximo envío
  return promesa;
}

/** Olvida el id de un archivo (p. ej. si Meta lo rechaza por vencido). */
const olvidarMedio = (ruta) => medios.delete(ruta);

/**
 * Documento (PDF), solo dentro de la ventana de 24 h.
 * @param {string} to
 * @param {{id?:string, link?:string}} medio  id de un medio subido a Meta, o enlace https público
 * @param {string} archivo   nombre con el que lo ve la persona
 * @param {string} [leyenda] texto bajo el documento (máx. 1024)
 */
async function enviarDocumento(to, medio, archivo, leyenda) {
  const document = medio.id ? { id: String(medio.id) } : { link: String(medio.link) };
  document.filename = recortar(archivo, 240);
  if (leyenda) document.caption = recortar(leyenda, 1024);
  const payload = { messaging_product: 'whatsapp', to: soloDigitos(to), type: 'document', document };
  const data = await llamarAPI(payload);
  await registrarSalida(to, 'document', payload.document, data);
  return data.messages?.[0]?.id || null;
}

module.exports = {
  BASE_URL,
  llamarAPI,
  enviarPlantilla,
  enviarTexto,
  enviarBotones,
  enviarLista,
  enviarCtaUrl,
  enviarDocumento,
  idMedio,
  olvidarMedio,
};
