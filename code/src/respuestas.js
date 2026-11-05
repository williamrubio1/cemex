'use strict';

/**
 * Listado de contactos con su envío de una campaña, para la vista interna /respuestas.
 * Devuelve datos personales -> solo por endpoints protegidos con sesión.
 * Filtros: ver src/filtros.js.
 */

const ExcelJS = require('exceljs');
const db = require('./db');
const { filtro, campanaDe } = require('./filtros');

const CAMPOS = `k.id, k.celular, k.nombre, k.empresa, k.ciudad, k.correo, k.hoja_origen, k.seminarios_previos,
  k.estado, k.opt_out, k.ultima_interaccion,
  e.estado_envio, e.intentos, e.enviado_en, e.entregado_en, e.leido_en, e.error_code, e.error_texto,
  e.respuesta, e.respondido_en, e.clic_en,
  r.paso AS r_paso, r.interes AS r_interes, r.modalidad AS r_modalidad, r.situacion AS r_situacion,
  r.momento AS r_momento, r.nombre AS r_nombre, r.correo AS r_correo, r.ciudad AS r_ciudad,
  r.empresa AS r_empresa, r.cargo AS r_cargo, r.clasificacion AS r_clasificacion,
  r.corporativo AS r_corporativo, r.completado_en AS r_completado_en, r.actualizado_en AS r_actualizado_en`;

const ORDEN = 'ORDER BY COALESCE(r.actualizado_en, e.respondido_en, e.clic_en, e.enviado_en) DESC, k.id';

// Textos de las respuestas del cuestionario (también los usa la vista /respuestas).
const ETIQ_REGISTRO = {
  interes: { cierre: 'Cierre Contable y Fiscal', sagrilaft: 'SAGRILAFT y PTEE', ambas: 'Ambas', info: 'Más información' },
  modalidad: { individual: 'Individual', empresa: 'Para una empresa', varias: 'Varias personas' },
  situacion: { si: 'Sí', no: 'No', independiente: 'Independiente' },
  momento: { ahora: 'Inscribirse ahora', info: 'Necesita más información', empresa: 'Opciones para empresa' },
  clasificacion: { caliente: 'Caliente', interesado: 'Interesado', potencial: 'Potencial' },
  paso: {
    inicio: 'Sin empezar', interes: 'A · capacitación', modalidad: 'B · modalidad', situacion: 'C · trabaja',
    momento: 'D · cuándo', nombre: 'Dato: nombre', correo: 'Dato: correo', ciudad: 'Dato: ciudad',
    empresa: 'Dato: empresa', cargo: 'Dato: cargo', fin: 'Completo',
  },
};
const et = (grupo, v) => (v == null ? '' : ETIQ_REGISTRO[grupo][v] || v);

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
    { header: 'Clasificación', key: 'clasificacion', width: 14 },
    { header: 'Corporativo', key: 'corporativo', width: 12 },
    { header: 'Registro', key: 'paso', width: 18 },
    { header: 'Capacitación', key: 'interes', width: 24 },
    { header: 'Modalidad', key: 'modalidad', width: 18 },
    { header: 'Trabaja en empresa', key: 'situacion', width: 16 },
    { header: 'Cuándo inscribirse', key: 'momento', width: 24 },
    { header: 'Nombre (registro)', key: 'r_nombre', width: 30 },
    { header: 'Correo (registro)', key: 'r_correo', width: 30 },
    { header: 'Ciudad (registro)', key: 'r_ciudad', width: 18 },
    { header: 'Empresa (registro)', key: 'r_empresa', width: 30 },
    { header: 'Cargo', key: 'r_cargo', width: 24 },
    { header: 'Registro completado', key: 'r_completado_en', width: 20 },
    { header: 'Nombre (base)', key: 'nombre', width: 30 },
    { header: 'Celular', key: 'celular', width: 16 },
    { header: 'Empresa (base)', key: 'empresa', width: 32 },
    { header: 'Ciudad (base)', key: 'ciudad', width: 20 },
    { header: 'Correo (base)', key: 'correo', width: 30 },
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
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  for (const f of filas) {
    ws.addRow({
      clasificacion: et('clasificacion', f.r_clasificacion),
      corporativo: f.r_corporativo ? 'Sí' : '',
      paso: et('paso', f.r_paso),
      interes: et('interes', f.r_interes),
      modalidad: et('modalidad', f.r_modalidad),
      situacion: et('situacion', f.r_situacion),
      momento: et('momento', f.r_momento),
      r_nombre: f.r_nombre || '',
      r_correo: f.r_correo || '',
      r_ciudad: f.r_ciudad || '',
      r_empresa: f.r_empresa || '',
      r_cargo: f.r_cargo || '',
      r_completado_en: fecha(f.r_completado_en),
      nombre: f.nombre || '',
      celular: f.celular,
      empresa: f.empresa || '',
      ciudad: f.ciudad || 'Sin ciudad',
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
  for (const k of ['r_completado_en', 'clic_en', 'respondido_en', 'enviado_en', 'leido_en']) ws.getColumn(k).numFmt = fmt;
  ws.getColumn('celular').numFmt = '@';

  return wb.xlsx.writeBuffer();
}

module.exports = { listar, todas, aExcel, ETIQ_REGISTRO };
