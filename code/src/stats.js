'use strict';

/**
 * Agregados del panel público (GET /stats). Sin datos personales.
 * `campanaId` = null -> todas las campañas.
 */

const db = require('./db');

// Consultas con parámetros posicionales.
const q = async (sql, params = []) => (await db.pool.query(sql, params))[0];
const TZ = "'+00:00', '-05:00'"; // UTC -> hora de Colombia

async function resumen(campanaId) {
  const c = Number.isInteger(campanaId) ? campanaId : null;
  const ew = c ? 'WHERE e.campana_id = ?' : '';
  const ewAnd = c ? 'AND e.campana_id = ?' : '';
  const p = c ? [c] : [];
  // Mensajes entrantes de la campaña: de sus destinatarios, desde su primer envío.
  const mw = c
    ? `AND celular IN (SELECT celular FROM envios WHERE campana_id = ?)
       AND created_at >= (SELECT MIN(enviado_en) FROM envios WHERE campana_id = ?)`
    : `AND created_at >= (SELECT COALESCE(MIN(enviado_en), '1970-01-01') FROM envios)`;
  const mp = c ? [c, c] : [];

  const [base] = await q(
    `SELECT COUNT(*) AS total, SUM(opt_out = 1) AS opt_out_total,
            SUM(estado = 'sin_whatsapp') AS sin_whatsapp_total FROM contactos`
  );

  const [kpis] = await q(
    `SELECT
       COUNT(*)                                                   AS enviados,
       SUM(entregado_en IS NOT NULL)                              AS entregados,
       SUM(leido_en IS NOT NULL)                                  AS leidos,
       SUM(estado_envio = 'fallido')                              AS fallidos,
       SUM(estado_envio = 'fallido' AND error_code = 131026)      AS sin_whatsapp,
       SUM(estado_envio = 'enviado')                              AS sin_confirmar,
       SUM(respondido_en IS NOT NULL OR clic_en IS NOT NULL)      AS respondieron,
       SUM(respuesta IN ('mas_info','participar') OR clic_en IS NOT NULL) AS interesados,
       SUM(respuesta = 'mas_info' AND clic_en IS NULL)            AS mas_info,  -- excluyente con participar
       SUM(respuesta = 'participar' OR clic_en IS NOT NULL)       AS participar,
       SUM(clic_en IS NOT NULL)                                   AS clics,
       SUM(respuesta = 'opt_out')                                 AS opt_out,
       SUM(respuesta = 'texto')                                   AS texto
     FROM envios e ${ew}`,
    p
  );

  const enviosDiario = await q(
    `SELECT DATE(CONVERT_TZ(enviado_en, ${TZ})) AS dia, COUNT(*) AS c
     FROM envios e WHERE enviado_en IS NOT NULL ${ewAnd}
     GROUP BY dia ORDER BY dia LIMIT 120`,
    p
  );
  const respuestasDiario = await q(
    `SELECT DATE(CONVERT_TZ(COALESCE(respondido_en, clic_en), ${TZ})) AS dia, COUNT(*) AS c
     FROM envios e WHERE COALESCE(respondido_en, clic_en) IS NOT NULL ${ewAnd}
     GROUP BY dia ORDER BY dia LIMIT 120`,
    p
  );

  // Mensajes entrantes por hora (línea de tiempo) y por día de semana × hora (mapa de calor).
  const respuestasPorHora = await q(
    `SELECT DATE_FORMAT(CONVERT_TZ(created_at, ${TZ}), '%Y-%m-%d %H:00') AS t, COUNT(*) AS c
     FROM mensajes WHERE direccion = 'in' ${mw}
     GROUP BY t ORDER BY t`,
    mp
  );
  const mapaCalor = await q(
    `SELECT WEEKDAY(CONVERT_TZ(created_at, ${TZ})) AS dow, HOUR(CONVERT_TZ(created_at, ${TZ})) AS hora, COUNT(*) AS c
     FROM mensajes WHERE direccion = 'in' ${mw}
     GROUP BY dow, hora`,
    mp
  );

  // Inicio y volumen de cada tanda (un envío masivo por día).
  const tandas = await q(
    `SELECT DATE_FORMAT(CONVERT_TZ(MIN(enviado_en), ${TZ}), '%d/%m')          AS dia,
            DATE_FORMAT(CONVERT_TZ(MIN(enviado_en), ${TZ}), '%H:%i')          AS horaTxt,
            DATE_FORMAT(CONVERT_TZ(MIN(enviado_en), ${TZ}), '%Y-%m-%d %H:00') AS bucket,
            COUNT(*) AS n
     FROM envios e WHERE enviado_en IS NOT NULL ${ewAnd}
     GROUP BY DATE(CONVERT_TZ(enviado_en, ${TZ}))
     ORDER BY MIN(enviado_en)`,
    p
  );

  // Resultado por hoja de origen (primera hoja del contacto).
  const porHoja = await q(
    `SELECT SUBSTRING_INDEX(COALESCE(k.hoja_origen, 'Sin hoja'), '; ', 1) AS hoja,
            COUNT(*)                                                    AS enviados,
            SUM(e.entregado_en IS NOT NULL)                             AS entregados,
            SUM(e.respuesta IN ('mas_info','participar') OR e.clic_en IS NOT NULL) AS interesados,
            SUM(e.respuesta = 'opt_out')                                AS opt_out
     FROM envios e JOIN contactos k ON k.id = e.contacto_id ${ew}
     GROUP BY hoja ORDER BY enviados DESC`,
    p
  );

  const num = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, Number(v) || 0]));
  const serie = (rows) => rows.map((d) => ({ dia: String(d.dia instanceof Date ? d.dia.toISOString() : d.dia).slice(0, 10), c: Number(d.c) }));

  return {
    generado: new Date().toISOString(),
    campana: c,
    base: num(base),
    kpis: num(kpis),
    enviosDiario: serie(enviosDiario),
    respuestasDiario: serie(respuestasDiario),
    respuestasPorHora: respuestasPorHora.map((r) => ({ t: String(r.t), c: Number(r.c) })),
    mapaCalor: mapaCalor.map((r) => ({ dow: Number(r.dow), hora: Number(r.hora), c: Number(r.c) })),
    tandas: tandas.map((r) => ({ dia: r.dia, horaTxt: r.horaTxt, bucket: String(r.bucket), n: Number(r.n) })),
    porHoja: porHoja.map((r) => ({ hoja: r.hoja, ...num({ enviados: r.enviados, entregados: r.entregados, interesados: r.interesados, opt_out: r.opt_out }) })),
  };
}

module.exports = { resumen };
