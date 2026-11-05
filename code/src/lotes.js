'use strict';

/**
 * Envíos masivos por lotes (vista interna /envios).
 *
 * - Un lote es una lista FIJA de contactos (tabla lote_contactos) armada con filtros.
 * - Un "trabajador" dentro del servidor envía la plantilla contacto por contacto.
 *   Si la plataforma se reinicia, el trabajador retoma los pendientes.
 * - Hostinger puede correr varias copias de la app: cada lote lo toma UN solo proceso
 *   (columnas worker / lease_hasta) y cada contacto se reclama con un UPDATE atómico,
 *   así nunca se le envía dos veces al mismo contacto.
 * - Tope diario opcional (límite de Meta de destinatarios únicos por 24 h): al
 *   alcanzarlo el lote queda "esperando_cupo" y continúa solo cuando se libera.
 */

const os = require('os');
const crypto = require('crypto');
const db = require('./db');
const wa = require('./whatsapp');
const { extraerCelulares, celularesExcluidos } = require('./telefonos');

const q = async (sql, p = []) => (await db.pool.query(sql, p))[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRUEBA = 'PRUEBA'; // hoja_origen de los números de prueba: fuera de lotes y KPIs
const ACTIVOS = "('en_curso','esperando_cupo')";
const ABIERTOS = "('en_curso','esperando_cupo','pausado')";
const WORKER = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`.slice(0, 80);
const SIN_CIUDAD = 'Sin ciudad';

class ErrorUsuario extends Error {} // errores para mostrar tal cual en la interfaz

// ─── Filtros ────────────────────────────────────────────────

const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
const lista = (v) =>
  (Array.isArray(v) ? v : v ? String(v).split('|') : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 300);

function normalizarFiltros(f = {}) {
  const cantidad = parseInt(f.cantidad, 10);
  return {
    hojas: lista(f.hojas),
    ciudades: lista(f.ciudades),
    empresas: lista(f.empresas),
    empresaContiene: String(f.empresaContiene || '').trim().slice(0, 100),
    seminario: String(f.seminario || '').trim().slice(0, 100),
    soloNuevos: bool(f.soloNuevos),
    conNombre: bool(f.conNombre),
    conCorreo: bool(f.conCorreo),
    cantidad: Number.isFinite(cantidad) && cantidad > 0 ? Math.min(cantidad, 100000) : null,
    orden: ['base', 'aleatorio', 'empresa', 'ciudad'].includes(f.orden) ? f.orden : 'base',
  };
}

const ORDEN_SQL = {
  base: 'k.id',
  aleatorio: 'RAND()',
  empresa: 'k.empresa, k.id',
  ciudad: 'k.ciudad IS NULL, k.ciudad, k.id',
};

/**
 * FROM + WHERE de los contactos que pueden entrar a un lote de la campaña:
 * no han recibido la campaña, no pidieron baja, tienen WhatsApp, no son de prueba,
 * no están excluidos y no están ya pendientes en otro lote abierto.
 */
function candidatos(campanaId, f) {
  const where = [
    'e.id IS NULL',
    'k.opt_out = 0',
    "k.estado <> 'sin_whatsapp'",
    `COALESCE(k.hoja_origen, '') <> '${PRUEBA}'`,
    `NOT EXISTS (SELECT 1 FROM lote_contactos lc JOIN lotes l ON l.id = lc.lote_id
       WHERE lc.contacto_id = k.id AND l.campana_id = ? AND l.estado IN ${ABIERTOS}
         AND lc.estado IN ('pendiente','enviando'))`,
  ];
  const params = [campanaId, campanaId]; // JOIN + NOT EXISTS

  const excl = [...celularesExcluidos()];
  if (excl.length) {
    where.push(`k.celular NOT IN (${excl.map(() => '?').join(', ')})`);
    params.push(...excl);
  }
  if (f) {
    if (f.hojas.length) {
      where.push(
        '(' + f.hojas.map(() => "FIND_IN_SET(?, REPLACE(COALESCE(k.hoja_origen, ''), '; ', ',')) > 0").join(' OR ') + ')'
      );
      params.push(...f.hojas);
    }
    if (f.ciudades.length) {
      const nombradas = f.ciudades.filter((c) => c !== SIN_CIUDAD);
      const partes = [];
      if (nombradas.length) {
        partes.push(`k.ciudad IN (${nombradas.map(() => '?').join(', ')})`);
        params.push(...nombradas);
      }
      if (f.ciudades.includes(SIN_CIUDAD)) partes.push('k.ciudad IS NULL');
      where.push('(' + partes.join(' OR ') + ')');
    }
    if (f.empresas.length) {
      where.push(`k.empresa IN (${f.empresas.map(() => '?').join(', ')})`);
      params.push(...f.empresas);
    }
    if (f.empresaContiene) {
      where.push('k.empresa LIKE ?');
      params.push(`%${f.empresaContiene}%`);
    }
    if (f.seminario) {
      where.push('k.seminarios_previos LIKE ?');
      params.push(`%${f.seminario}%`);
    }
    if (f.soloNuevos) where.push("k.estado = 'no_contactado'");
    if (f.conNombre) where.push('k.primer_nombre IS NOT NULL');
    if (f.conCorreo) where.push('k.correo IS NOT NULL');
  }
  return {
    sql: `FROM contactos k LEFT JOIN envios e ON e.contacto_id = k.id AND e.campana_id = ? WHERE ${where.join(' AND ')}`,
    params,
  };
}

const contar = (filas, clave) => {
  const m = new Map();
  for (const r of filas) for (const k of clave(r)) m.set(k, (m.get(k) || 0) + 1);
  return [...m].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n || String(a.k).localeCompare(String(b.k)));
};
const hojasDe = (r) => String(r.hoja_origen || 'Sin hoja').split('; ').filter(Boolean);
const ciudadDe = (r) => [r.ciudad || SIN_CIUDAD];
const empresaDe = (r) => (r.empresa ? [r.empresa] : []);

async function campanaOError(id) {
  const c = id ? await db.getCampana(id) : await db.campanaActiva();
  if (!c) throw new ErrorUsuario('La campaña no existe');
  return c;
}

/** Destinatarios únicos que recibieron plantilla en las últimas 24 h (para el tope de Meta). */
async function usados24h() {
  const [r] = await q('SELECT COUNT(*) AS n FROM envios WHERE enviado_en >= UTC_TIMESTAMP() - INTERVAL 24 HOUR');
  return Number(r.n) || 0;
}

/** Opciones para armar un lote: bases, ciudades y empresas con su cantidad disponible. */
async function opciones(campanaId) {
  const campana = await campanaOError(campanaId);
  const { sql, params } = candidatos(campana.id, null);
  const filas = await q(`SELECT k.hoja_origen, k.ciudad, k.empresa ${sql}`, params);
  return {
    campana: { id: campana.id, nombre: campana.nombre, plantilla: campana.plantilla },
    disponibles: filas.length,
    hojas: contar(filas, hojasDe),
    ciudades: contar(filas, ciudadDe),
    empresas: contar(filas, empresaDe).slice(0, 1500),
    usados24h: await usados24h(),
  };
}

/** Cuántos contactos quedan con estos filtros (y un resumen por ciudad, base y empresa). */
async function previsualizar(campanaId, filtrosCrudos) {
  const campana = await campanaOError(campanaId);
  const f = normalizarFiltros(filtrosCrudos);
  const { sql, params } = candidatos(campana.id, f);
  const filas = await q(`SELECT k.hoja_origen, k.ciudad, k.empresa, k.primer_nombre IS NOT NULL AS con_nombre ${sql}`, params);
  const seleccionados = f.cantidad ? Math.min(f.cantidad, filas.length) : filas.length;
  return {
    coinciden: filas.length,
    seleccionados,
    conNombre: filas.filter((r) => Number(r.con_nombre)).length,
    porCiudad: contar(filas, ciudadDe).slice(0, 10),
    porHoja: contar(filas, hojasDe),
    empresas: contar(filas, empresaDe).slice(0, 8),
    nEmpresas: new Set(filas.map((r) => r.empresa).filter(Boolean)).size,
  };
}

// ─── Crear y controlar lotes ────────────────────────────────

async function crear({ campana: campanaId, filtros: filtrosCrudos, nombre, tope_diario, mps }, usuario) {
  const campana = await campanaOError(campanaId);
  const f = normalizarFiltros(filtrosCrudos);

  const [activo] = await q(`SELECT id FROM lotes WHERE estado IN ${ACTIVOS} LIMIT 1`);
  if (activo) throw new ErrorUsuario(`Ya hay un lote enviándose (#${activo.id}). Páuselo o espere a que termine.`);

  const tope = parseInt(tope_diario, 10);
  const vel = parseFloat(mps);
  const { sql, params } = candidatos(campana.id, f);
  const ids = (
    await q(`SELECT k.id ${sql} ORDER BY ${ORDEN_SQL[f.orden]}${f.cantidad ? ` LIMIT ${f.cantidad}` : ''}`, params)
  ).map((r) => r.id);
  if (!ids.length) throw new ErrorUsuario('No hay contactos disponibles con estos filtros.');

  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query(
      `INSERT INTO lotes (campana_id, nombre, filtros, total, estado, tope_diario, mps, creado_por, creado_en)
       VALUES (?, ?, ?, ?, 'en_curso', ?, ?, ?, UTC_TIMESTAMP())`,
      [
        campana.id,
        String(nombre || '').trim().slice(0, 200) || null,
        JSON.stringify(f),
        ids.length,
        Number.isFinite(tope) && tope > 0 ? Math.min(tope, 1000000) : null,
        Number.isFinite(vel) ? Math.min(Math.max(vel, 0.5), 20) : 5,
        usuario || null,
      ]
    );
    const loteId = res.insertId;
    for (let i = 0; i < ids.length; i += 1000) {
      const filas = ids.slice(i, i + 1000).map((id, j) => [loteId, id, i + j + 1]);
      await conn.query('INSERT INTO lote_contactos (lote_id, contacto_id, orden) VALUES ?', [filas]);
    }
    await conn.commit();
    console.log(`[lotes] #${loteId} creado por ${usuario}: ${ids.length} contactos · campaña ${campana.codigo}`);
    avisar();
    return obtener(loteId);
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

const COLS_LOTE = `l.id, l.campana_id, c.nombre AS campana, l.nombre, l.filtros, l.total, l.enviados, l.fallidos,
  l.omitidos, l.estado, l.motivo, l.tope_diario, l.mps, l.creado_por, l.creado_en, l.finalizado_en`;

function formatearLote(l) {
  if (!l) return null;
  let filtros = l.filtros;
  if (typeof filtros === 'string') {
    try { filtros = JSON.parse(filtros); } catch { filtros = null; }
  }
  const procesados = l.enviados + l.fallidos + l.omitidos;
  return { ...l, filtros, mps: Number(l.mps), procesados, pendientes: Math.max(0, l.total - procesados) };
}

async function listar(limite = 30) {
  const filas = await q(
    `SELECT ${COLS_LOTE} FROM lotes l JOIN campanas c ON c.id = l.campana_id ORDER BY l.id DESC LIMIT ${Math.min(Number(limite) || 30, 100)}`
  );
  const [t] = await q('SELECT UTC_TIMESTAMP() AS ahora');
  return { ahora: t.ahora, usados24h: await usados24h(), lotes: filas.map(formatearLote) };
}

async function obtener(id) {
  const [l] = await q(`SELECT ${COLS_LOTE} FROM lotes l JOIN campanas c ON c.id = l.campana_id WHERE l.id = ?`, [id]);
  return formatearLote(l);
}

/** Pausar / reanudar / cancelar. */
async function accion(id, que) {
  const l = await obtener(id);
  if (!l) throw new ErrorUsuario('El lote no existe');
  if (que === 'pausar') {
    await q(`UPDATE lotes SET estado = 'pausado', motivo = 'Pausado por el usuario' WHERE id = ? AND estado IN ${ACTIVOS}`, [id]);
  } else if (que === 'reanudar') {
    const [otro] = await q(`SELECT id FROM lotes WHERE estado IN ${ACTIVOS} AND id <> ? LIMIT 1`, [id]);
    if (otro) throw new ErrorUsuario(`Ya hay otro lote enviándose (#${otro.id}).`);
    await q(`UPDATE lotes SET estado = 'en_curso', motivo = NULL WHERE id = ? AND estado = 'pausado'`, [id]);
    avisar();
  } else if (que === 'cancelar') {
    await q(
      `UPDATE lotes SET estado = 'cancelado', motivo = 'Cancelado por el usuario', finalizado_en = UTC_TIMESTAMP()
       WHERE id = ? AND estado IN ${ABIERTOS}`,
      [id]
    );
  } else {
    throw new ErrorUsuario('Acción no válida');
  }
  return obtener(id);
}

// ─── Trabajador ─────────────────────────────────────────────

let corriendo = false;
let despertar = null;

function avisar() {
  if (despertar) despertar();
}

async function esperar(ms) {
  await new Promise((r) => {
    const t = setTimeout(r, ms);
    despertar = () => {
      clearTimeout(t);
      r();
    };
  });
  despertar = null;
}

/** Arranca el bucle del trabajador (una vez por proceso). */
function iniciarTrabajador() {
  if (corriendo) return;
  corriendo = true;
  console.log(`[lotes] trabajador ${WORKER} activo`);
  (async () => {
    await sleep(3000); // dejar que arranque el servidor
    for (;;) {
      let espera = 10000;
      try {
        const lote = await tomarLote();
        if (lote) espera = await trabajar(lote);
      } catch (err) {
        console.error('[lotes] error del trabajador:', err.message);
        espera = 15000;
      }
      await esperar(espera);
    }
  })();
}

/** Toma (o renueva) el lote activo si nadie más lo está enviando. */
async function tomarLote() {
  await q(
    `UPDATE lotes SET worker = ?, lease_hasta = UTC_TIMESTAMP() + INTERVAL 60 SECOND
     WHERE estado IN ${ACTIVOS} AND (worker IS NULL OR worker = ? OR lease_hasta IS NULL OR lease_hasta < UTC_TIMESTAMP())
     ORDER BY id LIMIT 1`,
    [WORKER, WORKER]
  );
  const [l] = await q(`SELECT * FROM lotes WHERE worker = ? AND estado IN ${ACTIVOS} ORDER BY id LIMIT 1`, [WORKER]);
  return l || null;
}

/** Renueva el lease; false si el lote ya no es de este proceso o dejó de estar en curso. */
async function renovar(loteId, estado = 'en_curso') {
  await q(`UPDATE lotes SET lease_hasta = UTC_TIMESTAMP() + INTERVAL 60 SECOND WHERE id = ? AND worker = ? AND estado = ?`, [
    loteId,
    WORKER,
    estado,
  ]);
  // Se verifica con SELECT (affectedRows puede ser 0 si el valor no cambió dentro del mismo segundo).
  const [l] = await q('SELECT estado, worker FROM lotes WHERE id = ?', [loteId]);
  return !!l && l.worker === WORKER && l.estado === estado;
}

const marcar = (loteId, contactoId, estado, texto = null) =>
  q(
    `UPDATE lote_contactos SET estado = ?, error_texto = ?, procesado_en = UTC_TIMESTAMP() WHERE lote_id = ? AND contacto_id = ?`,
    [estado, texto ? String(texto).slice(0, 255) : null, loteId, contactoId]
  );

const sumar = (loteId, col) => q(`UPDATE lotes SET ${col} = ${col} + 1 WHERE id = ?`, [loteId]);

/**
 * Contactos que quedaron "enviando" porque el proceso se cayó en medio del envío:
 * si el envío quedó registrado se dan por enviados; si no, vuelven a pendiente.
 */
async function recuperarColgados(lote) {
  const colgados = await q(
    `SELECT lc.contacto_id, e.id AS envio_id FROM lote_contactos lc
     LEFT JOIN envios e ON e.contacto_id = lc.contacto_id AND e.campana_id = ? AND e.enviado_en >= lc.procesado_en - INTERVAL 30 SECOND
     WHERE lc.lote_id = ? AND lc.estado = 'enviando' AND lc.procesado_en < UTC_TIMESTAMP() - INTERVAL 2 MINUTE`,
    [lote.campana_id, lote.id]
  );
  for (const c of colgados) {
    if (c.envio_id) {
      await marcar(lote.id, c.contacto_id, 'enviado');
      await sumar(lote.id, 'enviados');
    } else {
      await q(`UPDATE lote_contactos SET estado = 'pendiente' WHERE lote_id = ? AND contacto_id = ? AND estado = 'enviando'`, [
        lote.id,
        c.contacto_id,
      ]);
    }
  }
  if (colgados.length) console.log(`[lotes] #${lote.id}: ${colgados.length} contacto(s) recuperados tras un reinicio`);
}

/**
 * Qué hacer ante un error de Meta:
 *   reintentar -> límite de velocidad momentáneo / red
 *   pausar     -> afecta a todo el lote (token, plantilla, cuenta, límite de spam)
 *   fallar     -> solo ese contacto
 */
function clasificar(err) {
  if (!err.status) return ['reintentar']; // red / tiempo de espera (no hubo respuesta de Meta)
  const c = Number(err.code) || null;
  if (c === 130429) return ['reintentar'];
  if ([131048, 80007, 4, 133016, 368].includes(c)) return ['pausar', `Meta está limitando los envíos (code ${c}). Reanude más tarde.`];
  if ([190, 10, 200, 3].includes(c)) return ['pausar', `Problema con el token o los permisos de WhatsApp (code ${c}).`];
  if (c >= 132000 && c < 133000) return ['pausar', `Problema con la plantilla (code ${c}). Revísela en WhatsApp Manager.`];
  if ([131031, 131042, 131045, 133010].includes(c)) return ['pausar', `Problema con la cuenta de WhatsApp o el pago (code ${c}).`];
  return ['fallar'];
}

/** Envía el lote hasta terminar, pausarse o quedar sin cupo. Devuelve ms de espera para el bucle. */
async function trabajar(lote) {
  await recuperarColgados(lote);

  if (lote.estado === 'esperando_cupo') {
    if (lote.tope_diario && (await usados24h()) >= lote.tope_diario) {
      await renovar(lote.id, 'esperando_cupo');
      return 60000;
    }
    await q(`UPDATE lotes SET estado = 'en_curso', motivo = NULL WHERE id = ? AND estado = 'esperando_cupo'`, [lote.id]);
    console.log(`[lotes] #${lote.id}: hay cupo de nuevo, continúa`);
  }

  const campana = await db.getCampana(lote.campana_id);
  if (!campana) {
    await q(`UPDATE lotes SET estado = 'pausado', motivo = 'La campaña ya no existe' WHERE id = ?`, [lote.id]);
    return 10000;
  }
  const pausa = Math.round(1000 / Math.max(0.5, Number(lote.mps) || 5));
  const excluidos = celularesExcluidos();
  let usados = lote.tope_diario ? await usados24h() : 0;
  let revisarCupo = Date.now();
  let fallosSeguidos = 0;
  let reintentosRed = 0;

  for (;;) {
    // Renovar el lease y, de paso, detectar pausa/cancelación pedida por el usuario.
    if (!(await renovar(lote.id))) return 2000;

    if (lote.tope_diario) {
      if (Date.now() - revisarCupo > 30000) {
        usados = await usados24h();
        revisarCupo = Date.now();
      }
      if (usados >= lote.tope_diario) {
        await q(
          `UPDATE lotes SET estado = 'esperando_cupo', motivo = ? WHERE id = ? AND estado = 'en_curso'`,
          [`Tope diario de ${lote.tope_diario} alcanzado: continúa solo cuando se libere cupo (24 h móviles).`, lote.id]
        );
        console.log(`[lotes] #${lote.id}: tope diario alcanzado, en espera`);
        return 60000;
      }
    }

    const [c] = await q(
      `SELECT k.* FROM lote_contactos lc JOIN contactos k ON k.id = lc.contacto_id
       WHERE lc.lote_id = ? AND lc.estado = 'pendiente' ORDER BY lc.orden LIMIT 1`,
      [lote.id]
    );
    if (!c) {
      const [enCurso] = await q(`SELECT COUNT(*) AS n FROM lote_contactos WHERE lote_id = ? AND estado = 'enviando'`, [lote.id]);
      if (Number(enCurso.n) > 0) return 30000; // esperar a que se recuperen
      await q(
        `UPDATE lotes SET estado = 'completado', motivo = NULL, finalizado_en = UTC_TIMESTAMP(), worker = NULL
         WHERE id = ? AND estado = 'en_curso'`,
        [lote.id]
      );
      console.log(`[lotes] #${lote.id} completado`);
      return 1000;
    }

    // Reclamar el contacto (si otro proceso lo tomó, seguir con el siguiente).
    const [rec] = await db.pool.query(
      `UPDATE lote_contactos SET estado = 'enviando', procesado_en = UTC_TIMESTAMP()
       WHERE lote_id = ? AND contacto_id = ? AND estado = 'pendiente'`,
      [lote.id, c.id]
    );
    if (rec.affectedRows !== 1) continue;

    // Revalidar justo antes de enviar: pudo darse de baja o recibir la campaña por otra vía.
    let omitir = null;
    if (c.opt_out) omitir = 'Pidió no recibir mensajes';
    else if (c.estado === 'sin_whatsapp') omitir = 'Sin WhatsApp';
    else if (excluidos.has(c.celular)) omitir = 'Número excluido';
    else {
      const [ya] = await q('SELECT id FROM envios WHERE campana_id = ? AND contacto_id = ? LIMIT 1', [campana.id, c.id]);
      if (ya) omitir = 'Ya había recibido esta campaña';
    }
    if (omitir) {
      await marcar(lote.id, c.id, 'omitido', omitir);
      await sumar(lote.id, 'omitidos');
      continue;
    }

    const token = await db.tokenDeEnvio(campana.id, c.id);
    let waId;
    try {
      waId = await wa.enviarPlantilla(c.celular, {
        plantilla: campana.plantilla,
        idioma: campana.idioma,
        nombre: c.primer_nombre,
        urlToken: token,
      });
    } catch (err) {
      const [que, motivo] = clasificar(err);
      if (que === 'reintentar' && ++reintentosRed <= 5) {
        await q(`UPDATE lote_contactos SET estado = 'pendiente' WHERE lote_id = ? AND contacto_id = ?`, [lote.id, c.id]);
        console.warn(`[lotes] #${lote.id}: ${err.message} — reintento ${reintentosRed}/5 en 5 s`);
        await sleep(5000);
        continue;
      }
      if (que === 'pausar' || que === 'reintentar') {
        await q(`UPDATE lote_contactos SET estado = 'pendiente' WHERE lote_id = ? AND contacto_id = ?`, [lote.id, c.id]);
        await q(`UPDATE lotes SET estado = 'pausado', motivo = ? WHERE id = ?`, [
          (motivo || `Error de conexión con WhatsApp: ${err.message}`).slice(0, 255),
          lote.id,
        ]);
        console.warn(`[lotes] #${lote.id} pausado: ${err.message}`);
        return 2000;
      }
      await marcar(lote.id, c.id, 'fallido', err.message);
      await sumar(lote.id, 'fallidos');
      console.warn(`[lotes] #${lote.id}: ${c.celular} falló — ${err.message}`);
      if (++fallosSeguidos >= 20) {
        await q(`UPDATE lotes SET estado = 'pausado', motivo = ? WHERE id = ?`, [
          `20 fallos seguidos; revise el último error: ${err.message}`.slice(0, 255),
          lote.id,
        ]);
        return 2000;
      }
      await sleep(pausa);
      continue;
    }

    // Meta aceptó el mensaje. Si la base falla justo aquí, el error sube al bucle, el contacto
    // queda "enviando" y recuperarColgados() lo revisa a los 2 minutos.
    await db.registrarEnvio({ campanaId: campana.id, contacto: c, waMessageId: waId, token });
    await marcar(lote.id, c.id, 'enviado');
    await sumar(lote.id, 'enviados');
    usados++;
    fallosSeguidos = 0;
    reintentosRed = 0;
    await sleep(pausa);
  }
}

// ─── Envío de prueba ────────────────────────────────────────

/**
 * Envía la plantilla de la campaña a números de prueba (máx. 5), sin pasar por lotes.
 * Los números nuevos se crean con hoja_origen = 'PRUEBA' (fuera de lotes y KPIs).
 * Ignora EXCLUIR_CELULARES a propósito: es un envío explícito a ese número.
 */
async function prueba({ campana: campanaId, numeros, nombre }) {
  const campana = await campanaOError(campanaId);
  // Separar por coma, punto y coma o renglón; dentro de cada parte se aceptan espacios,
  // guiones y prefijo +57 ("+57 314 251 1033"). extraerCelulares devuelve +573XXXXXXXXX.
  const items = [];
  for (const parte of String(numeros || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)) {
    const cels = extraerCelulares(parte);
    if (cels.length) cels.forEach((c) => items.push({ crudo: parte, celular: c }));
    else items.push({ crudo: parte, celular: null });
  }
  const unicos = items.filter((x, i) => !x.celular || items.findIndex((y) => y.celular === x.celular) === i);
  if (!unicos.length) throw new ErrorUsuario('Escriba al menos un número.');
  if (unicos.length > 5) throw new ErrorUsuario('Máximo 5 números por prueba.');
  const nom = String(nombre || '').trim().slice(0, 60);
  const primer = (nom.split(/\s+/)[0] || '').slice(0, 60) || null;

  const resultados = [];
  for (const { crudo, celular } of unicos) {
    if (!celular) {
      resultados.push({ numero: crudo, ok: false, error: 'No es un celular colombiano válido (10 dígitos, empieza por 3).' });
      continue;
    }
    try {
      let c = await db.getContactoPorCelular(celular);
      if (!c) {
        await q(
          `INSERT INTO contactos (celular, nombre, primer_nombre, hoja_origen, estado) VALUES (?, ?, ?, '${PRUEBA}', 'no_contactado')`,
          [celular, nom || null, primer]
        );
        c = await db.getContactoPorCelular(celular);
      } else if (c.hoja_origen === PRUEBA && primer) {
        await q('UPDATE contactos SET nombre = ?, primer_nombre = ? WHERE id = ?', [nom, primer, c.id]);
        c.primer_nombre = primer;
      }
      if (c.opt_out) {
        resultados.push({ numero: celular, ok: false, error: 'Pidió no recibir mensajes. Para reactivarlo, escriba ALTA desde ese WhatsApp.' });
        continue;
      }
      const token = await db.tokenDeEnvio(campana.id, c.id);
      const waId = await wa.enviarPlantilla(celular, {
        plantilla: campana.plantilla,
        idioma: campana.idioma,
        nombre: c.primer_nombre,
        urlToken: token,
      });
      await db.registrarEnvio({ campanaId: campana.id, contacto: c, waMessageId: waId, token });
      if (c.hoja_origen === PRUEBA) {
        // Cada prueba arranca limpia para poder repetir el flujo.
        await q(
          `UPDATE envios SET respuesta = NULL, respondido_en = NULL, clic_en = NULL WHERE campana_id = ? AND contacto_id = ?`,
          [campana.id, c.id]
        );
      }
      resultados.push({ numero: celular, ok: true, id: waId, saludo: c.primer_nombre || process.env.TEMPLATE_NOMBRE_DEFECTO || 'estimado(a)' });
    } catch (err) {
      resultados.push({ numero: celular, ok: false, error: err.message });
    }
  }
  return { campana: campana.nombre, plantilla: campana.plantilla, resultados };
}

module.exports = {
  ErrorUsuario,
  PRUEBA,
  normalizarFiltros,
  opciones,
  previsualizar,
  crear,
  listar,
  obtener,
  accion,
  prueba,
  iniciarTrabajador,
};
