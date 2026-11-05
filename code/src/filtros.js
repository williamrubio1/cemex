'use strict';

/**
 * Filtros comunes de /respuestas y /analisis.
 * Las consultas usan:  contactos k  LEFT JOIN  envios e (de UNA campaña).
 *
 *   campana     id de la campaña (obligatorio; el servidor pone la activa si falta)
 *   estado      estado del contacto, uno o varios separados por coma
 *   respuesta   interesados | mas_info | participar | opt_out | texto | sin_respuesta
 *   entrega     no_enviado | enviado | entregado | leido | fallido | sin_whatsapp
 *   hoja        hoja de origen del Excel ("PRUEBA" muestra los números de prueba, ocultos por defecto)
 *   ciudad      ciudad / región deducida ("Sin ciudad" = sin dato)
 *   empresa     empresa exacta
 *   seminario   texto contenido en los seminarios previos
 *   q           busca en nombre, celular, empresa y correo
 *   desde/hasta YYYY-MM-DD sobre campoFecha: envio (def.) | respuesta
 */

const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

const JOIN = 'FROM contactos k LEFT JOIN envios e ON e.contacto_id = k.id AND e.campana_id = ?';

function filtro(f = {}, campanaId) {
  const where = [];
  const params = [campanaId]; // para el JOIN

  if (f.estado) {
    const lista = String(f.estado).split(',').map((s) => s.trim()).filter(Boolean);
    if (lista.length) {
      where.push(`k.estado IN (${lista.map(() => '?').join(', ')})`);
      params.push(...lista);
    }
  }

  switch (f.respuesta) {
    case 'interesados':
      where.push("(e.respuesta IN ('mas_info','participar') OR e.clic_en IS NOT NULL)");
      break;
    case 'participar':
      where.push("(e.respuesta = 'participar' OR e.clic_en IS NOT NULL)");
      break;
    case 'mas_info':
    case 'opt_out':
    case 'texto':
      where.push('e.respuesta = ?');
      params.push(f.respuesta);
      break;
    case 'sin_respuesta':
      where.push('e.id IS NOT NULL AND e.respondido_en IS NULL AND e.clic_en IS NULL');
      break;
    default:
  }

  switch (f.entrega) {
    case 'no_enviado':
      where.push('e.id IS NULL');
      break;
    case 'enviado':
      where.push('e.id IS NOT NULL');
      break;
    case 'entregado':
      where.push('e.entregado_en IS NOT NULL');
      break;
    case 'leido':
      where.push('e.leido_en IS NOT NULL');
      break;
    case 'fallido':
      where.push("e.estado_envio = 'fallido'");
      break;
    case 'sin_whatsapp':
      where.push("(k.estado = 'sin_whatsapp' OR e.error_code = 131026)");
      break;
    default:
  }

  if (f.hoja) {
    where.push('FIND_IN_SET(?, REPLACE(COALESCE(k.hoja_origen, \'\'), \'; \', \',\')) > 0');
    params.push(String(f.hoja));
  }
  // Los números de prueba solo aparecen si se pide explícitamente la base PRUEBA.
  if (f.hoja !== 'PRUEBA') where.push("COALESCE(k.hoja_origen, '') <> 'PRUEBA'");
  if (f.ciudad) {
    if (f.ciudad === 'Sin ciudad') where.push('k.ciudad IS NULL');
    else {
      where.push('k.ciudad = ?');
      params.push(String(f.ciudad));
    }
  }
  if (f.empresa) {
    where.push('k.empresa = ?');
    params.push(String(f.empresa));
  }
  if (f.seminario) {
    where.push('k.seminarios_previos LIKE ?');
    params.push(`%${f.seminario}%`);
  }
  if (f.q) {
    where.push('(k.nombre LIKE ? OR k.celular LIKE ? OR k.empresa LIKE ? OR k.correo LIKE ?)');
    params.push(...Array(4).fill(`%${String(f.q).trim()}%`));
  }

  const col = f.campoFecha === 'respuesta' ? 'COALESCE(e.respondido_en, e.clic_en)' : 'e.enviado_en';
  if (esFecha(f.desde)) {
    where.push(`${col} >= ?`);
    params.push(f.desde + ' 05:00:00'); // 00:00 Colombia = 05:00 UTC
  }
  if (esFecha(f.hasta)) {
    where.push(`${col} < DATE_ADD(?, INTERVAL 1 DAY)`);
    params.push(f.hasta + ' 05:00:00');
  }

  return { join: JOIN, cond: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

/** Id de la campaña pedida o, si no viene, la activa más reciente. */
async function campanaDe(db, f) {
  const c = f.campana ? await db.getCampana(f.campana) : await db.campanaActiva();
  if (!c) throw new Error('No hay campañas creadas (ver db/schema.sql)');
  return c;
}

module.exports = { filtro, campanaDe };
