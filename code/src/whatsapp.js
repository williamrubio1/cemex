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

const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

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
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data.error || {};
    const detalle = e.error_data?.details ? ` — ${e.error_data.details}` : '';
    throw new Error(`WhatsApp API ${res.status}: ${e.message || 'error'}${e.code ? ` (code ${e.code})` : ''}${detalle}`);
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

/** Componentes de la plantilla: {{1}} = primer nombre y, si aplica, el token del enlace. */
function componentesPlantilla(nombre, urlToken) {
  const comps = [];
  if (TEMPLATE_PARAM_NAME !== '-') {
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
 * @param {{plantilla:string, idioma?:string, nombre?:string, urlToken?:string}} o
 */
async function enviarPlantilla(to, o) {
  const payload = {
    messaging_product: 'whatsapp',
    to: soloDigitos(to),
    type: 'template',
    template: {
      name: o.plantilla || process.env.TEMPLATE_NAME,
      language: { code: o.idioma || process.env.TEMPLATE_LANG || 'es_CO' },
      components: componentesPlantilla(o.nombre, o.urlToken),
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

module.exports = {
  BASE_URL,
  llamarAPI,
  enviarPlantilla,
  enviarTexto,
  enviarBotones,
  enviarLista,
  enviarCtaUrl,
};
