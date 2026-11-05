'use strict';

/**
 * Endurecimiento HTTP sin dependencias externas:
 * - Cabeceras de seguridad (CSP con hash de los <script> en línea, HSTS, antiframe…).
 * - Límite de peticiones por IP en memoria (ventana fija).
 * - Respuesta de error genérica: nunca se envía al navegador el detalle interno.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CDN = 'https://cdnjs.cloudflare.com';

/** Hash sha256 de cada <script> en línea de las páginas, para permitirlos en la CSP sin 'unsafe-inline'. */
function hashesScriptsEnLinea() {
  const hashes = new Set();
  for (const archivo of ['index.html', 'analisis.html', 'respuestas.html', 'envios.html']) {
    let html = '';
    try {
      // El navegador normaliza CRLF -> LF antes de calcular el hash: hacer lo mismo.
      html = fs.readFileSync(path.join(PUBLIC_DIR, archivo), 'utf8').replace(/\r\n?/g, '\n');
    } catch {
      continue;
    }
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
    }
  }
  return [...hashes].join(' ');
}

const CSP = [
  "default-src 'self'",
  `script-src 'self' ${CDN} ${hashesScriptsEnLinea()}`,
  "style-src 'self' 'unsafe-inline'", // estilos en línea de las páginas y de ECharts
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function cabeceras(_req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

/** Respuestas con datos personales o de sesión: que no queden en caché. */
function sinCache(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * Límite simple por IP: `max` peticiones por `ventanaMs`.
 * Detrás del proxy de Hostinger req.ip sale de X-Forwarded-For (trust proxy = 1).
 */
function limitador({ ventanaMs, max, mensaje = 'Demasiadas solicitudes. Intente más tarde.' }) {
  const cubetas = new Map(); // ip -> { n, reinicio }
  setInterval(() => {
    const ahora = Date.now();
    for (const [ip, c] of cubetas) if (c.reinicio <= ahora) cubetas.delete(ip);
  }, ventanaMs).unref();

  return (req, res, next) => {
    const ip = req.ip || 'sin-ip';
    const ahora = Date.now();
    let c = cubetas.get(ip);
    if (!c || c.reinicio <= ahora) {
      c = { n: 0, reinicio: ahora + ventanaMs };
      cubetas.set(ip, c);
    }
    c.n += 1;
    if (c.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((c.reinicio - ahora) / 1000)));
      return res.status(429).json({ error: mensaje });
    }
    next();
  };
}

/** Registra el detalle en el log del servidor y responde un mensaje genérico. */
function fallo(res, etiqueta, err, { status = 500, json = true } = {}) {
  console.error(`[${etiqueta}] error:`, err && err.message ? err.message : err);
  if (res.headersSent) return;
  if (json) return res.status(status).json({ error: 'Error del servidor. Intente más tarde.' });
  return res.status(status).send('Error del servidor');
}

module.exports = { cabeceras, sinCache, limitador, fallo };
