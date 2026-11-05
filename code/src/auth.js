'use strict';

/**
 * Autenticación mínima para la vista interna.
 * - Contraseñas: scrypt con sal por usuario (`salhex:hashhex`), sin dependencias.
 * - Sesión: cookie HttpOnly firmada con HMAC-SHA256 (SESSION_SECRET).
 */

const crypto = require('crypto');
const db = require('./db');

const SECRET =
  process.env.SESSION_SECRET ||
  (() => {
    console.warn('[auth] SESSION_SECRET no definido: se usa uno aleatorio (las sesiones se pierden al reiniciar)');
    return crypto.randomBytes(32).toString('hex');
  })();

const DURACION_MS = 8 * 60 * 60 * 1000; // 8 h

// ─── Contraseñas ────────────────────────────────────────────
function hashPassword(plano) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(plano), sal, 64);
  return `${sal.toString('hex')}:${h.toString('hex')}`;
}

// Hash de relleno: si el usuario no existe se calcula igual el scrypt, para que el
// tiempo de respuesta no revele qué usuarios existen.
const HASH_RELLENO = hashPassword(crypto.randomBytes(16).toString('hex'));

function verificarPassword(plano, guardado) {
  const [salHex, hashHex] = String(guardado || HASH_RELLENO).split(':');
  if (!guardado) {
    crypto.scryptSync(String(plano), Buffer.from(salHex, 'hex'), 64);
    return false;
  }
  if (!salHex || !hashHex) return false;
  const h = crypto.scryptSync(String(plano), Buffer.from(salHex, 'hex'), 64);
  const a = Buffer.from(hashHex, 'hex');
  return a.length === h.length && crypto.timingSafeEqual(a, h);
}

// ─── Sesión (token en cookie) ──────────────────────────────
const b64 = (buf) => Buffer.from(buf).toString('base64url');

function firmarSesion(usuario) {
  const payload = b64(JSON.stringify({ u: usuario, exp: Date.now() + DURACION_MS }));
  const sig = b64(crypto.createHmac('sha256', SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

function verificarSesion(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const esperado = b64(crypto.createHmac('sha256', SECRET).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!u || !exp || Date.now() > exp) return null;
    return { usuario: u };
  } catch {
    return null;
  }
}

function leerCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(
    raw.split(';').map((c) => {
      const i = c.indexOf('=');
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
    }).filter(([k]) => k)
  );
}

function cookieSesion(req, token) {
  const seguro = req.secure ? '; Secure' : '';
  const maxAge = token ? DURACION_MS / 1000 : 0;
  return `sesion=${token || ''}; HttpOnly${seguro}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function sesionActual(req) {
  return verificarSesion(leerCookies(req).sesion);
}

function requiereAuth(req, res, next) {
  if (sesionActual(req)) return next();
  res.status(401).json({ error: 'Sesión requerida' });
}

// ─── Límite de intentos de login (memoria, por IP) ─────────
const intentos = new Map();
// Limpieza periódica para que el mapa no crezca sin límite con IPs de bots.
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, e] of intentos) if (e.hasta < ahora) intentos.delete(ip);
}, 30 * 60 * 1000).unref();
function registrarFallo(ip) {
  const e = intentos.get(ip) || { n: 0, hasta: 0 };
  e.n += 1;
  if (e.n >= 5) e.hasta = Date.now() + 15 * 60 * 1000;
  intentos.set(ip, e);
}
function bloqueado(ip) {
  const e = intentos.get(ip);
  return e && e.hasta > Date.now();
}
function limpiarIntentos(ip) {
  intentos.delete(ip);
}

// ─── Acceso a `usuarios` ───────────────────────────────────
async function buscarUsuario(usuario) {
  const filas = await db.query('SELECT usuario, hash FROM usuarios WHERE usuario = ? LIMIT 1', [
    String(usuario || '').trim(),
  ]);
  return filas[0] || null;
}

module.exports = {
  hashPassword,
  verificarPassword,
  firmarSesion,
  verificarSesion,
  sesionActual,
  cookieSesion,
  requiereAuth,
  buscarUsuario,
  registrarFallo,
  bloqueado,
  limpiarIntentos,
};
