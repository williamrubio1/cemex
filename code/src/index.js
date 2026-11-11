'use strict';

/**
 * Servidor Express: campañas de WhatsApp CETEX (WhatsApp Cloud API).
 *
 *   GET  /webhook    -> verificación de Meta (hub.challenge)
 *   POST /webhook    -> eventos entrantes (mensajes + acuses de estado)
 *   GET  /r/:token   -> registra el clic en "Quiero participar" y redirige
 *   GET  /           -> panel público (agregados, sin datos personales)
 *   GET  /respuestas, /analisis -> vistas internas (con login)
 *   GET  /envios     -> envío por lotes y pruebas (con login)
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
const lotes = require('./lotes');
const { enlaceAsesor, enlaceComprobante } = require('./variables');
const { decidir, respuestaFinal } = require('./conversacion');
const { PAGO, waComprobante } = require('./oferta');

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
// Brochures en PDF que el bot envía por WhatsApp (Meta los descarga de aquí).
app.use('/docs', express.static(path.join(PUBLIC_DIR, 'docs'), { index: false, maxAge: '1h', fallthrough: true }));

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

// Clic en un botón con enlace del chat: registra el clic y redirige.
//   /r/<token>                 -> WhatsApp del asesor (mensaje con nombre, empresa y capacitación)
//   /r/<token>?a=web           -> página de inscripción y pago de CETEX
//   /r/<token>?a=comprobante   -> WhatsApp del asesor con "te envío el comprobante de pago…"
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
    const a = req.query.a;
    if (a === 'web') return res.redirect(302, PAGO.web);
    if (a === 'comprobante') {
      const destino = envio && campana ? await enlaceComprobante(campana, envio.contacto_id).catch(() => waComprobante()) : waComprobante();
      return res.redirect(302, destino);
    }
    if (!campana) return res.status(404).send('Enlace no disponible');
    // Al WhatsApp del asesor con un mensaje que ya dice quién es y qué capacitación le interesa.
    const destino = envio ? await enlaceAsesor(campana, envio.contacto_id).catch(() => campana.url_inscripcion) : campana.url_inscripcion;
    res.redirect(302, destino);
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
    // Costo aproximado de una plantilla entregada en Colombia (para estimar lotes):
    // marketing (invitaciones) y utilidad (seguimientos).
    costoMensajeUsd: Number(process.env.COSTO_MENSAJE_USD) || 0.0125,
    costoUtilidadUsd: Number(process.env.COSTO_UTILIDAD_USD) || 0.0008,
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

// ─── Vista interna: envíos por lotes y pruebas ──────────────
app.get('/envios', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'envios.html')));

// Las acciones que cambian datos exigen JSON: un formulario de otro sitio no puede
// enviarlo sin pasar por CORS (complementa la cookie SameSite=Lax).
function soloJson(req, res, next) {
  if (req.is('application/json')) return next();
  res.status(415).json({ error: 'Se requiere JSON' });
}

function errorLote(res, etiqueta, err) {
  if (err instanceof lotes.ErrorUsuario) return res.status(400).json({ error: err.message });
  seg.fallo(res, etiqueta, err);
}

app.get('/api/lotes/opciones', auth.requiereAuth, async (req, res) => {
  try {
    res.json(await lotes.opciones(req.query.campana));
  } catch (err) {
    errorLote(res, 'lotes/opciones', err);
  }
});

app.post('/api/lotes/previsualizar', auth.requiereAuth, soloJson, async (req, res) => {
  try {
    res.json(await lotes.previsualizar(req.body?.campana, req.body?.filtros));
  } catch (err) {
    errorLote(res, 'lotes/previsualizar', err);
  }
});

app.get('/api/lotes', auth.requiereAuth, async (_req, res) => {
  try {
    res.json(await lotes.listar());
  } catch (err) {
    errorLote(res, 'lotes', err);
  }
});

app.post('/api/lotes', auth.requiereAuth, soloJson, async (req, res) => {
  try {
    res.json(await lotes.crear(req.body || {}, auth.sesionActual(req)?.usuario));
  } catch (err) {
    errorLote(res, 'lotes/crear', err);
  }
});

app.post('/api/lotes/:id/:accion', auth.requiereAuth, soloJson, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
    res.json(await lotes.accion(Number(req.params.id), req.params.accion));
  } catch (err) {
    errorLote(res, 'lotes/accion', err);
  }
});

// Envío de prueba de la plantilla (máx. 5 números por solicitud, 10 solicitudes cada 10 min).
app.post(
  '/api/prueba',
  auth.requiereAuth,
  soloJson,
  seg.limitador({ ventanaMs: 10 * 60 * 1000, max: 10, mensaje: 'Demasiadas pruebas seguidas. Espere unos minutos.' }),
  async (req, res) => {
    try {
      const r = await lotes.prueba(req.body || {});
      console.log(`[prueba] ${auth.sesionActual(req)?.usuario}: ${r.resultados.map((x) => `${x.numero} ${x.ok ? 'OK' : 'ERROR'}`).join(', ')}`);
      res.json(r);
    } catch (err) {
      errorLote(res, 'prueba', err);
    }
  }
);

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
      for (const msg of value.messages || []) {
        const perfil = (value.contacts || []).find((c) => c.wa_id === msg.from)?.profile?.name;
        await procesarMensajeEntrante(msg, perfil);
      }
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

async function procesarMensajeEntrante(msg, nombrePerfil) {
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

  let contacto = await db.getContactoPorCelular(celular);
  const entrada = interpretarEntrada(msg);
  console.log(
    `[in] ${celular} ${contacto ? contacto.nombre || '(sin nombre)' : '(desconocido)'} · ${msg.type} · ${JSON.stringify(entrada)}`
  );

  // Quien escribe sin estar en la base se crea como contacto ENTRANTE para guardar su registro.
  if (!contacto && celular) {
    try {
      contacto = await db.crearContactoEntrante(celular, nombrePerfil);
    } catch (err) {
      console.error(`[in] ${celular} no se pudo crear el contacto:`, err.message);
    }
  }

  // ¿A qué envío responde? 1) el mensaje citado (context.id = plantilla), 2) el último envío.
  let envio = msg.context?.id ? await db.envioPorWaId(msg.context.id) : null;
  if (!envio && contacto) envio = await db.ultimoEnvioDeContacto(contacto.id);
  const campana = envio ? await db.getCampana(envio.campana_id) : await db.campanaActiva();
  const registro = contacto && campana ? await db.getRegistro(contacto.id, campana.id) : null;
  // En un seguimiento, lo que respondió en el cuestionario de la campaña de origen (capacitación, nombre…).
  const origen = contacto && campana?.origen_campana_id ? await db.getRegistro(contacto.id, campana.origen_campana_id) : null;

  // Enlaces de los botones, medidos vía /r/<token> cuando hay dominio público.
  const medido = PUBLIC_URL && envio ? `${PUBLIC_URL}/r/${envio.token}` : null;
  const url = medido || campana?.url_inscripcion;
  const enlaces = {
    web: medido ? `${medido}?a=web` : null,
    comprobante: medido ? `${medido}?a=comprobante` : null,
  };
  const plan = decidir({ contacto, campana, registro, origen, entrada, url, enlaces });

  // Primero se guarda el estado (si un envío falla, el contacto vuelve a recibir la pregunta pendiente).
  if (contacto) {
    if (plan.registro && campana) await db.guardarRegistro(contacto.id, campana.id, plan.registro);
    await db.actualizarContacto(contacto.id, { ...plan.contacto, ultima_interaccion: new Date() });
    if (envio && plan.respuesta) {
      await db.registrarRespuesta(envio.id, respuestaFinal(envio.respuesta, plan.respuesta));
    }
  }

  for (let i = 0; i < plan.acciones.length; i++) {
    const accion = plan.acciones[i];
    try {
      const wamid = await enviarAccion(celular, accion);
      // Un PDF tarda más en llegar que un texto: se espera a que Meta lo entregue
      // antes del mensaje siguiente, para que no lleguen en desorden.
      if (accion.tipo === 'documento' && wamid && i < plan.acciones.length - 1) {
        const estado = await esperarEntrega(wamid);
        if (estado !== 'delivered' && estado !== 'read') console.log(`[out] ${celular} PDF sin acuse de entrega (${estado}), se continúa`);
      }
    } catch (err) {
      console.error(`[out] ${celular} error enviando:`, err.message);
      break; // no mandar la pregunta siguiente sin la anterior
    }
  }

  const r = plan.registro;
  console.log(
    `[out] ${celular} -> ${plan.respuesta || 'sin respuesta'}` +
      (r ? ` · paso ${r.paso || registro?.paso} · ${r.clasificacion}` : '') +
      (plan.contacto.estado ? ` (estado: ${plan.contacto.estado})` : '')
  );
}

/** Ejecuta una acción de la conversación vía whatsapp.js. */
async function enviarAccion(celular, accion) {
  if (accion.tipo === 'texto') return wa.enviarTexto(celular, accion.texto);
  if (accion.tipo === 'cta_url') {
    if (!accion.url) return wa.enviarTexto(celular, accion.cuerpo);
    return wa.enviarCtaUrl(celular, accion.cuerpo, accion.boton, accion.url);
  }
  if (accion.tipo === 'botones') return wa.enviarBotones(celular, accion.cuerpo, accion.botones);
  if (accion.tipo === 'lista') return wa.enviarLista(celular, accion.cuerpo, accion.boton, accion.seccion, accion.filas);
  if (accion.tipo === 'documento') return enviarPdf(celular, accion);
  console.warn('[out] acción desconocida:', accion.tipo);
}

/**
 * PDF de public/docs/: 1) subido a Meta (rápido), 2) por enlace público, 3) la ficha en texto.
 * Devuelve el wamid del documento, o null si se envió el texto de respaldo.
 */
async function enviarPdf(celular, a) {
  const nombre = path.basename(String(a.pdf || ''));
  const ruta = path.join(PUBLIC_DIR, 'docs', nombre);
  try {
    return await wa.enviarDocumento(celular, { id: await wa.idMedio(ruta) }, a.archivo, a.leyenda);
  } catch (err) {
    // Id inválido o vencido en Meta: se vuelve a subir en el próximo envío.
    if ([100, 131052, 131053].includes(err.code)) wa.olvidarMedio(ruta);
    console.warn(`[out] ${celular} PDF ${nombre} por id falló:`, err.message);
  }
  if (PUBLIC_URL) {
    try {
      return await wa.enviarDocumento(celular, { link: `${PUBLIC_URL}/docs/${encodeURIComponent(nombre)}` }, a.archivo, a.leyenda);
    } catch (err) {
      console.warn(`[out] ${celular} PDF ${nombre} por enlace falló:`, err.message);
    }
  }
  await wa.enviarTexto(celular, a.respaldo || a.leyenda);
  return null;
}

// ─── Espera de entrega (para no adelantar mensajes a un PDF) ─────────
const ESPERA_PDF_MS = Number(process.env.ESPERA_DOCUMENTO_MS) || 20000;
const esperando = new Map(); // wamid -> resolver
const acusesRecientes = new Map(); // wamid -> estado (por si el acuse llega antes de empezar a esperar)

function esperarEntrega(wamid) {
  if (acusesRecientes.has(wamid)) return Promise.resolve(acusesRecientes.get(wamid));
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      esperando.delete(wamid);
      resolve('sin acuse');
    }, ESPERA_PDF_MS);
    esperando.set(wamid, (estado) => {
      clearTimeout(t);
      esperando.delete(wamid);
      resolve(estado);
    });
  });
}

function avisarAcuse(st) {
  if (!['delivered', 'read', 'failed'].includes(st.status)) return;
  const resolver = esperando.get(st.id);
  if (resolver) return resolver(st.status);
  acusesRecientes.set(st.id, st.status);
  if (acusesRecientes.size > 500) acusesRecientes.delete(acusesRecientes.keys().next().value);
}

async function procesarEstado(st) {
  avisarAcuse(st);
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
  // Retoma los lotes en curso (también después de un reinicio).
  lotes.iniciarTrabajador();
});

module.exports = { app };
