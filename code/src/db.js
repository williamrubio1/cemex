'use strict';

/**
 * Cliente MySQL (Hostinger) + funciones de lectura/escritura.
 * Todos los DATETIME se guardan y leen en UTC.
 */

require('dotenv').config();
const crypto = require('crypto');
const mysql = require('mysql2/promise');

// Salvaguarda: este proyecto nació como copia del censo de LegalMedica.
// Nunca debe escribir en esa base de producción.
if (/legalmedica/i.test(process.env.DB_NAME || '')) {
  throw new Error(
    `DB_NAME=${process.env.DB_NAME} es la base de LegalMedica. ` +
      'Configura en el .env la base nueva de CETEX antes de continuar.'
  );
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z', // interpretar/enviar fechas como UTC
  charset: 'utf8mb4_unicode_ci',
});

/** Ejecuta una consulta parametrizada y devuelve las filas. */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Prueba la conexión. Lanza si falla. */
async function ping() {
  const rows = await query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

/**
 * Verifica la conexión y aborta con un mensaje claro si falla.
 * Para los scripts de administración que corren desde el PC.
 */
async function exigirConexion() {
  try {
    await ping();
  } catch (err) {
    const host = process.env.DB_HOST || '(sin DB_HOST)';
    console.error(
      `\nNo se pudo conectar a MySQL en ${host}:${process.env.DB_PORT || 3306} — ${err.code || err.message}\n` +
        'Si corres esto desde tu PC, DB_HOST debe ser el host REMOTO de Hostinger\n' +
        '(hPanel → Bases de datos MySQL), no "localhost" ni "127.0.0.1", y tu IP\n' +
        'debe estar habilitada en Remote MySQL.\n'
    );
    await pool.end();
    process.exit(1);
  }
}

const { normalizarCelular, extraerCelulares, celularesExcluidos } = require('./telefonos');

const tokenAleatorio = () => crypto.randomBytes(9).toString('base64url'); // 12 caracteres

// ─── Contactos ──────────────────────────────────────────────

/**
 * Inserta o actualiza un contacto por `celular`.
 * No pisa el progreso de las campañas (estado, opt_out): solo los datos del Excel.
 */
async function upsertContacto(c) {
  const [res] = await pool.execute(
    `INSERT INTO contactos (celular, nombre, primer_nombre, empresa, ciudad, correo, hoja_origen, seminarios_previos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nombre = VALUES(nombre), primer_nombre = VALUES(primer_nombre), empresa = VALUES(empresa),
       ciudad = VALUES(ciudad), correo = VALUES(correo), hoja_origen = VALUES(hoja_origen),
       seminarios_previos = VALUES(seminarios_previos)`,
    [c.celular, c.nombre, c.primer_nombre, c.empresa, c.ciudad ?? null, c.correo, c.hoja_origen, c.seminarios_previos]
  );
  return res.affectedRows === 1 ? 'insertado' : 'actualizado';
}

async function getContactoPorCelular(celular) {
  const rows = await query('SELECT * FROM contactos WHERE celular = ? LIMIT 1', [celular]);
  return rows[0] || null;
}

const COLS_CONTACTO = new Set(['estado', 'opt_out', 'opt_out_en', 'ultima_interaccion']);

/** Actualiza columnas permitidas de un contacto por id. */
async function actualizarContacto(id, campos) {
  const claves = Object.keys(campos).filter((k) => COLS_CONTACTO.has(k));
  if (claves.length === 0) return;
  const set = claves.map((k) => `\`${k}\` = ?`).join(', ');
  await pool.execute(`UPDATE contactos SET ${set} WHERE id = ?`, [...claves.map((k) => campos[k]), id]);
}

// ─── Campañas ───────────────────────────────────────────────

async function getCampana(codigoOId) {
  const rows = /^\d+$/.test(String(codigoOId))
    ? await query('SELECT * FROM campanas WHERE id = ? LIMIT 1', [Number(codigoOId)])
    : await query('SELECT * FROM campanas WHERE codigo = ? LIMIT 1', [String(codigoOId)]);
  return rows[0] || null;
}

/** La campaña activa más reciente (la que atiende respuestas de desconocidos). */
async function campanaActiva() {
  const rows = await query('SELECT * FROM campanas WHERE activa = 1 ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

async function listarCampanas() {
  return query('SELECT id, codigo, nombre, activa FROM campanas ORDER BY id DESC');
}

// ─── Envíos ─────────────────────────────────────────────────

const enteroPositivo = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

/** Contactos que aún no reciben esta campaña (excluye opt-out y sin WhatsApp). */
async function contactosParaEnvio(campanaId, limite = 1000) {
  return query(
    `SELECT c.* FROM contactos c
     LEFT JOIN envios e ON e.contacto_id = c.id AND e.campana_id = ?
     WHERE e.id IS NULL AND c.opt_out = 0 AND c.estado <> 'sin_whatsapp'
       AND COALESCE(c.hoja_origen, '') <> 'PRUEBA'
     ORDER BY c.id
     LIMIT ${enteroPositivo(limite, 1000)}`,
    [campanaId]
  );
}

/**
 * Reintento: recibieron la plantilla de esta campaña, no respondieron, no
 * fallaron, pasaron `horas` desde el último envío y están bajo el tope.
 */
async function contactosParaReintento(campanaId, horas = 48, maxIntentos = 2, limite = 1000) {
  return query(
    `SELECT c.*, e.id AS envio_id, e.intentos FROM contactos c
     JOIN envios e ON e.contacto_id = c.id AND e.campana_id = ?
     WHERE c.opt_out = 0 AND c.estado <> 'sin_whatsapp'
       AND COALESCE(c.hoja_origen, '') <> 'PRUEBA'
       AND e.respondido_en IS NULL AND e.estado_envio <> 'fallido'
       AND e.intentos < ${enteroPositivo(maxIntentos, 2)}
       AND e.enviado_en < (UTC_TIMESTAMP() - INTERVAL ${enteroPositivo(horas, 48)} HOUR)
     ORDER BY c.id
     LIMIT ${enteroPositivo(limite, 1000)}`,
    [campanaId]
  );
}

/** Crea (o renueva, en reintentos) el envío de una campaña a un contacto. */
async function registrarEnvio({ campanaId, contacto, waMessageId, token }) {
  await pool.execute(
    `INSERT INTO envios (campana_id, contacto_id, celular, token, wa_message_id, estado_envio, enviado_en)
     VALUES (?, ?, ?, ?, ?, 'enviado', UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       wa_message_id = VALUES(wa_message_id), estado_envio = 'enviado',
       intentos = intentos + 1, enviado_en = UTC_TIMESTAMP(),
       entregado_en = NULL, leido_en = NULL, fallido_en = NULL, error_code = NULL, error_texto = NULL`,
    [campanaId, contacto.id, contacto.celular, token, waMessageId]
  );
  if (contacto.estado === 'no_contactado') {
    await pool.execute(`UPDATE contactos SET estado = 'contactado' WHERE id = ? AND estado = 'no_contactado'`, [
      contacto.id,
    ]);
  }
}

/** Token existente del envío (para reintentos) o uno nuevo. */
async function tokenDeEnvio(campanaId, contactoId) {
  const rows = await query('SELECT token FROM envios WHERE campana_id = ? AND contacto_id = ? LIMIT 1', [
    campanaId,
    contactoId,
  ]);
  return rows[0]?.token || tokenAleatorio();
}

async function envioPorWaId(waMessageId) {
  if (!waMessageId) return null;
  const rows = await query('SELECT * FROM envios WHERE wa_message_id = ? LIMIT 1', [waMessageId]);
  return rows[0] || null;
}

async function envioPorToken(token) {
  const rows = await query('SELECT * FROM envios WHERE token = ? LIMIT 1', [String(token)]);
  return rows[0] || null;
}

/** Último envío hecho a un contacto (para atribuir respuestas sin contexto). */
async function ultimoEnvioDeContacto(contactoId) {
  const rows = await query('SELECT * FROM envios WHERE contacto_id = ? ORDER BY enviado_en DESC LIMIT 1', [
    contactoId,
  ]);
  return rows[0] || null;
}

const ORDEN_ESTADO_ENVIO = { enviado: 1, entregado: 2, leido: 3 };

/**
 * Aplica un acuse de Meta (sent/delivered/read/failed) al envío de la plantilla.
 * Devuelve el envío actualizado o null si el acuse no es de una plantilla de campaña.
 */
async function aplicarAcuse(st) {
  const envio = await envioPorWaId(st.id);
  if (!envio) return null;
  const t = st.timestamp ? new Date(Number(st.timestamp) * 1000) : new Date();

  if (st.status === 'failed') {
    const e = (st.errors && st.errors[0]) || {};
    await pool.execute(
      `UPDATE envios SET estado_envio = 'fallido', fallido_en = ?, error_code = ?, error_texto = ? WHERE id = ?`,
      [t, e.code || null, String(e.title || e.message || '').slice(0, 255) || null, envio.id]
    );
    // 131026: el número no tiene WhatsApp (o no puede recibir).
    if (Number(e.code) === 131026) {
      await pool.execute(`UPDATE contactos SET estado = 'sin_whatsapp' WHERE id = ? AND opt_out = 0`, [
        envio.contacto_id,
      ]);
    }
    return envio;
  }

  const col = { delivered: 'entregado_en', read: 'leido_en' }[st.status];
  if (!col) return envio; // 'sent' no cambia nada
  const nuevo = st.status === 'read' ? 'leido' : 'entregado';
  // Un "read" implica entregado; no retroceder de leido -> entregado.
  const estado = (ORDEN_ESTADO_ENVIO[nuevo] || 0) > (ORDEN_ESTADO_ENVIO[envio.estado_envio] || 0) ? nuevo : envio.estado_envio;
  if (col === 'entregado_en') {
    await pool.execute(
      `UPDATE envios SET estado_envio = ?, entregado_en = COALESCE(entregado_en, ?) WHERE id = ?`,
      [estado, t, envio.id]
    );
  } else {
    await pool.execute(
      `UPDATE envios SET estado_envio = ?, leido_en = COALESCE(leido_en, ?),
         entregado_en = COALESCE(entregado_en, ?) WHERE id = ?`,
      [estado, t, t, envio.id]
    );
  }
  return envio;
}

/** Registra la respuesta (botón o texto) en el envío. respondido_en guarda la primera. */
async function registrarRespuesta(envioId, respuesta) {
  await pool.execute(
    `UPDATE envios SET respuesta = ?, respondido_en = COALESCE(respondido_en, UTC_TIMESTAMP()) WHERE id = ?`,
    [respuesta, envioId]
  );
}

/** Primer clic en "Quiero participar" (vía /r/<token>). */
async function registrarClic(envioId) {
  await pool.execute(
    `UPDATE envios SET clic_en = COALESCE(clic_en, UTC_TIMESTAMP()),
       respuesta = CASE WHEN respuesta IS NULL OR respuesta = 'texto' THEN 'participar' ELSE respuesta END
     WHERE id = ?`,
    [envioId]
  );
}

// ─── Log e idempotencia ─────────────────────────────────────

/** Registra un mensaje en el log de auditoría. */
async function registrarMensaje({ celular, direccion, tipo, contenido, wa_message_id }) {
  await pool.execute(
    `INSERT INTO mensajes (celular, direccion, tipo, contenido, wa_message_id)
     VALUES (?, ?, ?, ?, ?)`,
    [celular ?? null, direccion, tipo, contenido != null ? JSON.stringify(contenido) : null, wa_message_id ?? null]
  );
}

/**
 * Idempotencia: marca un evento entrante como procesado.
 * Devuelve true si ya estaba procesado (hay que ignorarlo).
 */
async function eventoYaProcesado(waMessageId) {
  if (!waMessageId) return false;
  const [res] = await pool.execute('INSERT IGNORE INTO eventos_procesados (wa_message_id) VALUES (?)', [
    waMessageId,
  ]);
  return res.affectedRows === 0;
}

module.exports = {
  pool,
  query,
  ping,
  exigirConexion,
  normalizarCelular,
  extraerCelulares,
  celularesExcluidos,
  tokenAleatorio,
  upsertContacto,
  getContactoPorCelular,
  actualizarContacto,
  getCampana,
  campanaActiva,
  listarCampanas,
  contactosParaEnvio,
  contactosParaReintento,
  registrarEnvio,
  tokenDeEnvio,
  envioPorWaId,
  envioPorToken,
  ultimoEnvioDeContacto,
  aplicarAcuse,
  registrarRespuesta,
  registrarClic,
  registrarMensaje,
  eventoYaProcesado,
};
