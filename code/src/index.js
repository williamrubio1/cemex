'use strict';

/**
 * Servidor Express: campañas de WhatsApp CETEX (WhatsApp Cloud API).
 *
 *   GET  /webhook    -> verificación de Meta (hub.challenge)
 *   POST /webhook    -> eventos entrantes (mensajes + acuses de estado)
 *   GET  /r/:token   -> registra el clic en "Quiero participar" y redirige
 *   GET  /           -> panel público (agregados, sin datos personales)
 *   GET  /respuestas, /analisis -> vistas internas (con login)
 */

require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const db = require('./db');
const wa = require('./whatsapp');
const stats = require('./stats');
const respuestas = require('./respuestas');
const analisis = require('./analisis');
const auth = require('./auth');
const seg = require('./seguridad');
const { decidir, respuestaFinal } = require('./conversacion');

const PORT = Number(process.env.PORT || 3000);
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.APP_SECRET; // opcional: firma X-Hub-Signature-256
// Dominio público de la plataforma (https://...). Si está, los botones "Quiero participar"
// pasan por /r/<token> para medir el clic antes de redirigir.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

const app = express();
app.set('trust proxy', 1); // detrás del proxy HTTPS de Hostinger (req.secure)
app.disable('x-powered-by');
app.use(seg.cabeceras);

// Límites por IP: general (bots/escáneres) y estricto para el login.
const limiteGeneral = seg.limitador({ ventanaMs: 60 * 1000, max: 120 });
// El webhook queda fuera: Meta envía ráfagas de acuses durante una campaña (y va firmado).
app.use((req, res, next) => (req.path === '/webhook' ? next() : limiteGeneral(req, res, next)));
app.use('/api/login', seg.limitador({ ventanaMs: 15 * 60 * 1000, max: 20, mensaje: 'Demasiados intentos. Espere 15 minutos.' }));
app.use(['/api', '/stats'], seg.sinCache);

app.use(express.json({ limit: '256kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// ─── Panel público de seguimiento ───────────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PANEL = path.join(PUBLIC_DIR, 'index.html');

app.get('/', (_req, res) => res.sendFile(PANEL));
app.get('/panel', (_req, res) => res.redirect('/'));
app.get('/graficas.js', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'graficas.js')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, servicio: 'cetex-whatsapp', ts: new Date().toISOString() });
});

// Campañas (solo id y nombre) para los selectores de los paneles.
app.get('/api/campanas', async (_req, res) => {
  try {
    res.json(await db.listarCampanas());
  } catch (err) {
    seg.fallo(res, 'campanas', err);
  }
});

// /stats: agregados (sin datos personales). Cache corto para aguantar tráfico.
const cacheStats = new Map(); // campana -> { t, data }
app.get('/stats', async (req, res) => {
  try {
    const campana = /^\d+$/.test(String(req.query.campana || '')) ? String(req.query.campana) : 'todas';
    const hit = cacheStats.get(campana);
    if (!hit || Date.now() - hit.t > 15000) {
      cacheStats.set(campana, { t: Date.now(), data: await stats.resumen(campana === 'todas' ? null : Number(campana)) });
    }
    res.json(cacheStats.get(campana).data);
  } catch (err) {
    seg.fallo(res, 'stats', err);
  }
});

// Clic en "Quiero participar": registra y redirige al enlace de inscripción de la campaña.
app.get('/r/:token', async (req, res) => {
  try {
    // Los tokens son aleatorios en hex/base64url: cualquier otra cosa no toca la base.
    const token = /^[A-Za-z0-9_-]{8,64}$/.test(req.params.token) ? req.params.token : null;
    const envio = token ? await db.envioPorToken(token) : null;
    const campana = envio ? await db.getCampana(envio.campana_id) : await db.campanaActiva();
    if (envio) {
      await db.registrarClic(envio.id);
      await db.query(`UPDATE contactos SET estado = 'interesado' WHERE id = ? AND opt_out = 0`, [envio.contacto_id]);
    }
    if (!campana) return res.status(404).send('Enlace no disponible');
    res.redirect(302, campana.url_inscripcion);
  } catch (err) {
    seg.fallo(res, 'r', err, { json: false });
  }
});

// ─── Login para la vista interna ────────────────────────────
app.post('/api/login', async (req, res) => {
  const ip = req.ip || 'sin-ip';
  if (auth.bloqueado(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espere 15 minutos.' });

  const { usuario, password } = req.body || {};
  if (typeof usuario !== 'string' || typeof password !== 'string' || usuario.length > 64 || password.length > 256) {
    auth.registrarFallo(ip);
    return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
  }
  try {
    const u = await auth.buscarUsuario(usuario);
    if (!auth.verificarPassword(password, u ? u.hash : null) || !u) {
      auth.registrarFallo(ip);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    auth.limpiarIntentos(ip);
    res.setHeader('Set-Cookie', auth.cookieSesion(req, auth.firmarSesion(u.usuario)));
    res.json({ ok: true, usuario: u.usuario });
  } catch (err) {
    console.error('[login] error:', err.message);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', auth.cookieSesion(req, null));
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  const s = auth.sesionActual(req);
  res.json({ autenticado: !!s, usuario: s ? s.usuario : null });
});

// ─── Vista interna: respuestas por contacto (datos personales) ───────
app.get('/respuestas', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'respuestas.html'));
});

app.get('/api/respuestas', auth.requiereAuth, async (req, res) => {
  try {
    res.json(await respuestas.listar(req.query));
  } catch (err) {
    seg.fallo(res, 'respuestas', err);
  }
});

app.get('/analisis', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'analisis.html'));
});

app.get('/logo.png', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'logo.png'));
});

// Identidad del cliente (quien envía la campaña) y del operador de la plataforma
// para encabezados y pie de los informes (sin datos sensibles).
app.get('/api/config', (_req, res) => {
  res.json({
    cliente: {
      nombre: process.env.CLIENTE_NOMBRE || 'CETEX',
      web: process.env.CLIENTE_WEB || 'cetex.com.co',
    },
    operador: {
      nombre: process.env.OP_NOMBRE || 'Soluctia S.A.S.',
      web: process.env.OP_WEB || 'soluctiasas.com',
      direccion: process.env.OP_DIRECCION || '',
      ciudad: process.env.OP_CIUDAD || '',
      correo: process.env.OP_CORREO || '',
      telefono: process.env.OP_TELEFONO || '',
      nit: process.env.OP_NIT || '',
    },
  });
});

app.get('/api/analisis', auth.requiereAuth, async (req, res) => {
  try {
    res.json(await analisis.resumen(req.query));
  } catch (err) {
    seg.fallo(res, 'analisis', err);
  }
});

app.get('/api/respuestas.xlsx', auth.requiereAuth, async (req, res) => {
  try {
    const filas = await respuestas.todas(req.query);
    const buf = await respuestas.aExcel(filas);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="respuestas-${Date.now()}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    seg.fallo(res, 'respuestas.xlsx', err, { json: false });
  }
});

// ─── Verificación del webhook (Meta) ─────────────────────────
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (VERIFY_TOKEN && mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[webhook] verificación OK');
    return res.status(200).send(String(challenge ?? ''));
  }
  if (!mode && !token) {
    // visita normal al navegador, sin parámetros de verificación
    return res.sendStatus(403);
  }
  console.warn(`[webhook] verificación rechazada (mode=${mode}, token ${token === VERIFY_TOKEN ? 'ok' : 'no coincide'})`);
  return res.sendStatus(403);
});

// ─── Eventos entrantes ──────────────────────────────────────
app.post('/webhook', (req, res) => {
  res.sendStatus(200); // responder de inmediato: Meta reintenta si tarda

  // Solo se procesan eventos firmados por Meta: sin APP_SECRET no hay forma de
  // distinguirlos de un POST falso (que haría enviar mensajes a cualquier número).
  if (!APP_SECRET) {
    console.warn('[webhook] falta APP_SECRET — evento ignorado');
    return;
  }
  if (!firmaValida(req)) {
    console.warn('[webhook] firma X-Hub-Signature-256 inválida — evento ignorado');
    return;
  }

  procesarWebhook(req.body).catch((err) => {
    console.error('[webhook] error procesando evento:', err);
  });
});

// Rutas inexistentes (escáneres buscando /.env, /wp-admin…): 404 sin detalles.
app.use((_req, res) => res.status(404).type('text/plain').send('No encontrado'));

// Errores de parseo de JSON u otros. Al webhook se le responde 200 (evitar reintentos de Meta);
// al resto, un error genérico sin detalles internos.
app.use((err, req, res, _next) => {
  console.error('[http] error:', err.message);
  if (res.headersSent) return;
  if (req.path === '/webhook') return res.sendStatus(200);
  res.status(err.status && err.status < 500 ? err.status : 500).type('text/plain').send('Solicitud inválida');
});

// ─── Lógica ─────────────────────────────────────────────────

function firmaValida(req) {
  const recibida = req.get('x-hub-signature-256') || '';
  const esperada =
    'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody || Buffer.alloc(0)).digest('hex');
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function celularDe(waId) {
  return waId ? '+' + String(waId).replace(/\D/g, '') : null;
}

async function procesarWebhook(body) {
  if (!body || body.object !== 'whatsapp_business_account') {
    console.warn('[webhook] payload inesperado:', body && body.object);
    return;
  }
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const msg of value.messages || []) await procesarMensajeEntrante(msg);
      for (const st of value.statuses || []) await procesarEstado(st);
    }
  }
}

/** Traduce un mensaje entrante a una "entrada" simple para la máquina de estados. */
function interpretarEntrada(msg) {
  switch (msg.type) {
    case 'text':
      return { clase: 'texto', texto: msg.text?.body ?? '' };
    case 'button': // respuesta a los botones de la PLANTILLA
      return { clase: 'boton_plantilla', titulo: msg.button?.text ?? '', payload: msg.button?.payload ?? '' };
    case 'interactive': {
      const i = msg.interactive || {};
      if (i.type === 'button_reply')
        return { clase: 'boton', id: i.button_reply?.id, titulo: i.button_reply?.title };
      if (i.type === 'list_reply')
        return { clase: 'lista', id: i.list_reply?.id, titulo: i.list_reply?.title };
      return { clase: 'interactive_otro' };
    }
    default:
      return { clase: 'otro', tipo: msg.type };
  }
}

async function procesarMensajeEntrante(msg) {
  const waId = msg.id;
  const celular = celularDe(msg.from);

  if (await db.eventoYaProcesado(waId)) {
    console.log(`[in] ${celular} evento repetido (${waId}) — ignorado`);
    return;
  }

  await db.registrarMensaje({
    celular,
    direccion: 'in',
    tipo: msg.type,
    contenido: msg,
    wa_message_id: waId,
  });

  const contacto = await db.getContactoPorCelular(celular);
  const entrada = interpretarEntrada(msg);
  console.log(
    `[in] ${celular} ${contacto ? contacto.nombre || '(sin nombre)' : '(desconocido)'} · ${msg.type} · ${JSON.stringify(entrada)}`
  );

  // ¿A qué envío responde? 1) el mensaje citado (context.id = plantilla), 2) el último envío.
  let envio = msg.context?.id ? await db.envioPorWaId(msg.context.id) : null;
  if (!envio && contacto) envio = await db.ultimoEnvioDeContacto(contacto.id);
  const campana = envio ? await db.getCampana(envio.campana_id) : await db.campanaActiva();

  const url = PUBLIC_URL && envio ? `${PUBLIC_URL}/r/${envio.token}` : campana?.url_inscripcion;
  const plan = decidir(contacto, campana, entrada, url);

  for (const accion of plan.acciones) {
    try {
      await enviarAccion(celular, accion);
    } catch (err) {
      console.error(`[out] ${celular} error enviando:`, err.message);
    }
  }

  if (contacto) {
    await db.actualizarContacto(contacto.id, { ...plan.contacto, ultima_interaccion: new Date() });
    if (envio && plan.respuesta) {
      await db.registrarRespuesta(envio.id, respuestaFinal(envio.respuesta, plan.respuesta));
    }
  }
  console.log(`[out] ${celular} -> ${plan.respuesta || 'sin registro'}${plan.contacto.estado ? ` (estado: ${plan.contacto.estado})` : ''}`);
}

/** Ejecuta una acción de la conversación vía whatsapp.js. */
async function enviarAccion(celular, accion) {
  if (accion.tipo === 'texto') return wa.enviarTexto(celular, accion.texto);
  if (accion.tipo === 'cta_url') {
    if (!accion.url) return wa.enviarTexto(celular, accion.cuerpo);
    return wa.enviarCtaUrl(celular, accion.cuerpo, accion.boton, accion.url);
  }
  if (accion.tipo === 'botones') return wa.enviarBotones(celular, accion.cuerpo, accion.botones);
  console.warn('[out] acción desconocida:', accion.tipo);
}

async function procesarEstado(st) {
  await db.registrarMensaje({
    celular: celularDe(st.recipient_id),
    direccion: 'out',
    tipo: 'status',
    contenido: st,
    wa_message_id: st.id,
  });
  await db.aplicarAcuse(st); // actualiza el envío si el acuse es de una plantilla de campaña
  const err = st.errors && st.errors[0];
  console.log(
    `[status] ${st.recipient_id} ${st.status}${err ? ' · ' + (err.code || '') + ' ' + (err.title || err.message) : ''}`
  );
}

// ─── Arranque ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`cetex-whatsapp escuchando en http://localhost:${PORT}`);
  for (const v of ['WHATSAPP_TOKEN', 'PHONE_NUMBER_ID', 'VERIFY_TOKEN', 'APP_SECRET', 'PUBLIC_URL']) {
    if (!process.env[v]) console.warn(`[config] falta ${v} en el .env`);
  }
  db.ping()
    .then((ok) => console.log(ok ? '[db] conexión OK' : '[db] conexión con problemas'))
    .catch((e) => console.warn('[db] no se pudo conectar:', e.message));
});

module.exports = { app };
