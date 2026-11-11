'use strict';

/**
 * Agregados del panel de análisis (/analisis, protegido con sesión).
 * Filtros: ver src/filtros.js.
 */

const db = require('./db');
const { filtro, campanaDe } = require('./filtros');

const q = async (s, p = []) => (await db.pool.query(s, p))[0];
const num = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, Number(v) || 0]));
const TZ = "'+00:00', '-05:00'";

const INTERESADO = "(e.respuesta IN ('mas_info','participar') OR e.clic_en IS NOT NULL)";

async function resumen(f = {}) {
  const campana = await campanaDe(db, f);
  const { join, cond, params } = filtro(f, campana);

  const [k] = await q(
    `SELECT
       COUNT(*)                                         AS universo,
       SUM(e.id IS NOT NULL)                            AS enviados,
       SUM(e.entregado_en IS NOT NULL)                  AS entregados,
       SUM(e.leido_en IS NOT NULL)                      AS leidos,
       SUM(e.estado_envio = 'fallido')                  AS fallidos,
       SUM(e.error_code = 131026 OR k.estado = 'sin_whatsapp') AS sin_whatsapp,
       SUM(e.respondido_en IS NOT NULL OR e.clic_en IS NOT NULL) AS respondieron,
       SUM(${INTERESADO})                               AS interesados,
       SUM(e.respuesta = 'mas_info' AND e.clic_en IS NULL) AS mas_info,  -- excluyente con participar
       SUM(e.respuesta = 'participar' OR e.clic_en IS NOT NULL) AS participar,
       SUM(e.clic_en IS NOT NULL)                       AS clics,
       SUM(e.respuesta = 'opt_out')                     AS opt_out,
       SUM(e.respuesta = 'texto')                       AS texto,
       SUM(e.id IS NULL AND k.opt_out = 0 AND k.estado <> 'sin_whatsapp') AS pendientes_envio
     ${join} ${cond}`,
    params
  );

  // Cuestionario del chat: embudo, clasificación y respuestas.
  const [cu] = await q(
    `SELECT
       SUM(r.id IS NOT NULL)                       AS conversaron,
       SUM(r.interes IS NOT NULL OR r.paso <> 'inicio') AS iniciaron,
       SUM(r.interes IS NOT NULL)                  AS resp_a,
       SUM(r.momento IS NOT NULL)                  AS resp_d,
       SUM(r.completado_en IS NOT NULL)            AS completos,
       SUM(r.clasificacion = 'caliente')           AS caliente,
       SUM(r.clasificacion = 'interesado')         AS interesado,
       SUM(r.clasificacion = 'potencial')          AS potencial,
       SUM(r.corporativo = 1)                      AS corporativo
     ${join} ${cond}`,
    params
  );
  const reparto = async (col) =>
    (
      await q(
        `SELECT r.${col} AS k, COUNT(*) AS n ${join} ${cond} ${cond ? 'AND' : 'WHERE'} r.${col} IS NOT NULL
         GROUP BY r.${col} ORDER BY n DESC`,
        params
      )
    ).map((x) => ({ k: x.k, n: Number(x.n) }));
  const cuestionario = {
    ...num(cu),
    interes: await reparto('interes'),
    modalidad: await reparto('modalidad'),
    situacion: await reparto('situacion'),
    momento: await reparto('momento'),
    ciudades: (await reparto('ciudad')).slice(0, 12),
    cargos: (await reparto('cargo')).slice(0, 12),
  };

  // Por hoja de origen (primera hoja del contacto).
  const porHoja = await q(
    `SELECT SUBSTRING_INDEX(COALESCE(k.hoja_origen, 'Sin hoja'), '; ', 1) AS hoja,
            SUM(e.id IS NOT NULL)            AS enviados,
            SUM(e.entregado_en IS NOT NULL)  AS entregados,
            SUM(${INTERESADO})               AS interesados,
            SUM(e.respuesta = 'opt_out')     AS opt_out
     ${join} ${cond}
     GROUP BY hoja ORDER BY enviados DESC, hoja`,
    params
  );

  // Seminarios previos y empresas de quienes recibieron el mensaje (se agregan en JS).
  const filas = await q(
    `SELECT k.seminarios_previos, k.empresa, ${INTERESADO} AS interesado,
            e.entregado_en IS NOT NULL AS entregado
     ${join} ${cond} ${cond ? 'AND' : 'WHERE'} e.id IS NOT NULL`,
    params
  );
  const sem = new Map();
  const emp = new Map();
  for (const r of filas) {
    for (const s of String(r.seminarios_previos || '').split('; ').filter(Boolean)) {
      const x = sem.get(s) || { k: s, entregados: 0, interesados: 0 };
      x.entregados += Number(r.entregado) || 0;
      x.interesados += Number(r.interesado) || 0;
      sem.set(s, x);
    }
    if (r.empresa && Number(r.interesado)) {
      emp.set(r.empresa, (emp.get(r.empresa) || 0) + 1);
    }
  }
  const seminarios = [...sem.values()]
    .filter((x) => x.entregados >= 5)
    .sort((a, b) => b.interesados - a.interesados || b.entregados - a.entregados)
    .slice(0, 12);
  const empresas = [...emp.entries()]
    .map(([k, n]) => ({ k, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 12);

  // Actividad diaria (envíos y respuestas) dentro del filtro.
  const diario = await q(
    `SELECT dia, SUM(env) AS envios, SUM(resp) AS respuestas FROM (
       SELECT DATE(CONVERT_TZ(e.enviado_en, ${TZ})) AS dia, 1 AS env, 0 AS resp
       ${join} ${cond} ${cond ? 'AND' : 'WHERE'} e.enviado_en IS NOT NULL
       UNION ALL
       SELECT DATE(CONVERT_TZ(COALESCE(e.respondido_en, e.clic_en), ${TZ})), 0, 1
       ${join} ${cond} ${cond ? 'AND' : 'WHERE'} COALESCE(e.respondido_en, e.clic_en) IS NOT NULL
     ) t GROUP BY dia ORDER BY dia`,
    [...params, ...params]
  );

  // Errores de entrega más frecuentes.
  const errores = await q(
    `SELECT e.error_code AS code, MAX(e.error_texto) AS texto, COUNT(*) AS n
     ${join} ${cond} ${cond ? 'AND' : 'WHERE'} e.estado_envio = 'fallido'
     GROUP BY e.error_code ORDER BY n DESC LIMIT 8`,
    params
  );

  return {
    generado: new Date().toISOString(),
    campana: { id: campana.id, nombre: campana.nombre, seminario: campana.seminario, fechas: campana.fechas },
    kpis: num(k),
    cuestionario,
    porHoja: porHoja.map((r) => ({ hoja: r.hoja, ...num({ enviados: r.enviados, entregados: r.entregados, interesados: r.interesados, opt_out: r.opt_out }) })),
    seminarios,
    empresas,
    diario: diario.map((r) => ({
      dia: String(r.dia instanceof Date ? r.dia.toISOString() : r.dia).slice(0, 10),
      envios: Number(r.envios) || 0,
      respuestas: Number(r.respuestas) || 0,
    })),
    errores: errores.map((r) => ({ code: r.code, texto: r.texto, n: Number(r.n) })),
  };
}

module.exports = { resumen };
