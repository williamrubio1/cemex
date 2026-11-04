'use strict';

/**
 * Listado de contactos con su envío de una campaña, para la vista interna /respuestas.
 * Devuelve datos personales -> solo por endpoints protegidos con sesión.
 * Filtros: ver src/filtros.js.
 */

const ExcelJS = require('exceljs');
const db = require('./db');
const { filtro, campanaDe } = require('./filtros');

const CAMPOS = `k.id, k.celular, k.nombre, k.empresa, k.correo, k.hoja_origen, k.seminarios_previos,
  k.estado, k.opt_out, k.ultima_interaccion,
  e.estado_envio, e.intentos, e.enviado_en, e.entregado_en, e.leido_en, e.error_code, e.error_texto,
  e.respuesta, e.respondido_en, e.clic_en`;

const ORDEN = 'ORDER BY COALESCE(e.respondido_en, e.clic_en, e.enviado_en) DESC, k.id';

const ESTADO_ETIQ = {
  no_contactado: 'Sin contactar',
  contactado: 'Contactado',
  interesado: 'Interesado',
  opt_out: 'No desea mensajes',
  sin_whatsapp: 'Sin WhatsApp',
};
const RESPUESTA_ETIQ = {
  participar: 'Quiere participar',
  mas_info: 'Pidió más información',
  opt_out: 'No desea mensajes',
  texto: 'Escribió un mensaje',
};
const ENVIO_ETIQ = { enviado: 'Enviado', entregado: 'Entregado', leido: 'Leído', fallido: 'Fallido' };

const entero = (v, def, max) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return max ? Math.min(n, max) : n;
};

async function listar(opts = {}) {
  const campana = await campanaDe(db, opts);
  const { join, cond, params } = filtro(opts, campana.id);
  const pagina = entero(opts.pagina, 1);
  const porPagina = entero(opts.porPagina, 50, 200);
  const offset = (pagina - 1) * porPagina;

  const [[{ n }]] = await db.pool.query(`SELECT COUNT(*) AS n ${join} ${cond}`, params);
  const [filas] = await db.pool.query(
    `SELECT ${CAMPOS} ${join} ${cond} ${ORDEN} LIMIT ${porPagina} OFFSET ${offset}`,
    params
  );
  return { campana: { id: campana.id, nombre: campana.nombre }, total: Number(n), pagina, porPagina, filas };
}

/** Todas las filas que cumplen el filtro (tope 10.000), para el Excel. */
async function todas(opts = {}) {
  const campana = await campanaDe(db, opts);
  const { join, cond, params } = filtro(opts, campana.id);
  const [filas] = await db.pool.query(`SELECT ${CAMPOS} ${join} ${cond} ${ORDEN} LIMIT 10000`, params);
  return filas;
}

// ExcelJS escribe la fecha tal cual (UTC); se corre a hora de Colombia (UTC-5).
const fecha = (v) => (v ? new Date(new Date(v).getTime() - 5 * 3600e3) : null);

/** Genera un archivo Excel (.xlsx) con las filas dadas. Devuelve un Buffer. */
async function aExcel(filas) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Soluctia S.A.S. — Campañas CETEX';
  wb.created = new Date();
  const ws = wb.addWorksheet('Respuestas', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Nombre', key: 'nombre', width: 30 },
    { header: 'Celular', key: 'celular', width: 16 },
    { header: 'Empresa', key: 'empresa', width: 32 },
    { header: 'Correo', key: 'correo', width: 30 },
    { header: 'Respuesta', key: 'respuesta', width: 22 },
    { header: 'Clic en "Quiero participar"', key: 'clic_en', width: 22 },
    { header: 'Fecha de respuesta', key: 'respondido_en', width: 20 },
    { header: 'Envío', key: 'estado_envio', width: 12 },
    { header: 'Enviado', key: 'enviado_en', width: 20 },
    { header: 'Leído', key: 'leido_en', width: 20 },
    { header: 'Error de entrega', key: 'error', width: 30 },
    { header: 'Estado del contacto', key: 'estado', width: 20 },
    { header: 'Hoja de origen', key: 'hoja_origen', width: 24 },
    { header: 'Seminarios previos', key: 'seminarios_previos', width: 60 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: 'A1', to: 'N1' };

  for (const f of filas) {
    ws.addRow({
      nombre: f.nombre || '',
      celular: f.celular,
      empresa: f.empresa || '',
      correo: f.correo || '',
      respuesta: RESPUESTA_ETIQ[f.respuesta] || (f.estado_envio ? 'Sin respuesta' : 'No enviado'),
      clic_en: fecha(f.clic_en),
      respondido_en: fecha(f.respondido_en),
      estado_envio: ENVIO_ETIQ[f.estado_envio] || '',
      enviado_en: fecha(f.enviado_en),
      leido_en: fecha(f.leido_en),
      error: f.error_code ? `${f.error_code} · ${f.error_texto || ''}` : '',
      estado: ESTADO_ETIQ[f.estado] || f.estado,
      hoja_origen: f.hoja_origen || '',
      seminarios_previos: f.seminarios_previos || '',
    });
  }
  const fmt = 'yyyy-mm-dd hh:mm';
  for (const k of ['clic_en', 'respondido_en', 'enviado_en', 'leido_en']) ws.getColumn(k).numFmt = fmt;
  ws.getColumn('celular').numFmt = '@';

  return wb.xlsx.writeBuffer();
}

module.exports = { listar, todas, aExcel };
