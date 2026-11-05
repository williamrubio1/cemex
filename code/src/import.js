'use strict';

/**
 * Importa la base de contactos de CETEX (Excel con varias hojas) a `contactos`.
 *
 * Uso:
 *   node src/import.js <archivo.xlsx> [--dry] [--sql [salida.sql]] [--hojas "BOGOTA,BASE MEDELLIN"]
 *   npm run import -- ../datos/Base_Bogota_organizada.xlsx --dry
 *   node src/import.js <archivo.xlsx> --sql-ciudades   (solo UPDATE de la ciudad -> importaciones/ciudades.sql)
 *
 * --dry   : no escribe nada; muestra el resumen por hoja.
 * --sql   : no conecta a la base; genera un .sql para pegar en phpMyAdmin
 *           (por defecto importaciones/contactos.sql).
 * --hojas : solo esas hojas (por defecto todas las que tengan teléfono).
 *
 * Reglas:
 *  - Se toman SOLO celulares colombianos (3XX XXX XXXX) de TELEFONO y CELULAR;
 *    los fijos/PBX no reciben WhatsApp. Si una fila trae varios, se usa el primero.
 *  - Un contacto por celular. Si el mismo celular aparece en varias filas/hojas,
 *    se unen hojas de origen y seminarios; nombre, empresa y correo: el primero no vacío.
 *  - Se omiten los números de EXCLUIR_CELULARES (.env), p. ej. la línea de ventas de CETEX.
 *  - No toca estado ni opt-out de contactos que ya existan.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { extraerCelulares, celularesExcluidos } = require('./telefonos');
const { ciudadPorFijo, ciudadPorHoja } = require('./ciudades');

const ALIAS = {
  nombre: ['nombre', 'participante', 'nombrecompleto', 'contacto'],
  empresa: ['empresa', 'razonsocial'],
  correo: ['correo', 'email', 'correoelectronico'],
  celular: ['celular', 'movil', 'whatsapp'],
  telefono: ['telefono', 'telefonos'],
  seminario: ['seminario', 'curso', 'evento'],
};

const sqlLit = (v) =>
  v == null || v === ''
    ? 'NULL'
    : "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ') + "'";

const limpiarEncabezado = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** "MARIA EUGENIA  LOPEZ" -> "Maria Eugenia Lopez". */
const tituloCase = (s) =>
  String(s)
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase('es'));

const RE_EMPRESA = /\b(s\.?a\.?s?|ltda|cia|s\.?en\.?c|e\.?u|ltd|inc|corp|grupo|sociedad|asociaci[oó]n|fundaci[oó]n)\b/i;

/** Primer nombre para el saludo; null si el "nombre" parece empresa o basura. */
function primerNombre(nombre) {
  if (!nombre || RE_EMPRESA.test(nombre)) return null;
  const p = nombre.split(' ')[0];
  return /^\p{L}{2,}$/u.test(p) ? p : null;
}

function valorCelda(row, col) {
  if (!col) return null;
  const v = row.getCell(col).value;
  if (v == null) return null;
  if (typeof v === 'object' && 'text' in v) return v.text; // hipervínculos
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && 'result' in v) return v.result; // fórmulas
  return v;
}

const texto = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

function mapearColumnas(headerRow) {
  const mapa = {};
  headerRow.eachCell((cell, col) => {
    const h = limpiarEncabezado(cell.value);
    for (const [campo, alias] of Object.entries(ALIAS)) {
      if (alias.includes(h) && !mapa[campo]) mapa[campo] = col;
    }
  });
  return mapa;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const hojasIdx = args.indexOf('--hojas');
  const hojasFiltro = hojasIdx !== -1 ? args[hojasIdx + 1].split(',').map((s) => s.trim()) : null;
  const sqlIdx = args.indexOf('--sql');
  const modoSql = sqlIdx !== -1;
  const sqlSalida =
    modoSql && args[sqlIdx + 1] && !args[sqlIdx + 1].startsWith('--')
      ? args[sqlIdx + 1]
      : path.join('importaciones', 'contactos.sql');
  const ciuIdx = args.indexOf('--sql-ciudades');
  const modoCiudades = ciuIdx !== -1;
  const ciudadesSalida =
    modoCiudades && args[ciuIdx + 1] && !args[ciuIdx + 1].startsWith('--')
      ? args[ciuIdx + 1]
      : path.join('importaciones', 'ciudades.sql');
  const consumidos = new Set(
    [hojasIdx !== -1 ? args[hojasIdx + 1] : null, modoSql ? sqlSalida : null, modoCiudades ? ciudadesSalida : null].filter(Boolean)
  );
  const archivo = args.find((a) => !a.startsWith('--') && !consumidos.has(a));

  if (!archivo) {
    console.error('Falta el archivo. Uso: node src/import.js <archivo.xlsx> [--dry] [--sql [salida.sql]] [--hojas "A,B"]');
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.resolve(archivo));

  const excluidos = celularesExcluidos();
  const contactos = new Map(); // celular -> { ...datos, hojas:Set, seminarios:Set }
  const porHoja = [];
  let omitidosExcluidos = 0;

  for (const ws of wb.worksheets) {
    if (hojasFiltro && !hojasFiltro.includes(ws.name)) continue;
    const mapa = mapearColumnas(ws.getRow(1));
    if (!mapa.celular && !mapa.telefono) continue; // hoja sin teléfonos (p. ej. RESUMEN)

    const r = { hoja: ws.name, filas: 0, conCelular: 0, nuevos: 0 };
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      if (!row.hasValues) continue;
      r.filas++;

      const cels = [
        ...extraerCelulares(valorCelda(row, mapa.celular)),
        ...extraerCelulares(valorCelda(row, mapa.telefono)),
      ].filter((c) => {
        if (excluidos.has(c)) { omitidosExcluidos++; return false; }
        return true;
      });
      if (!cels.length) continue;
      r.conCelular++;

      const celular = cels[0];
      const nombre = texto(valorCelda(row, mapa.nombre));
      const empresa = texto(valorCelda(row, mapa.empresa));
      const correo = (texto(valorCelda(row, mapa.correo)).match(/[^\s;,]+@[^\s;,]+\.[a-z]{2,}/i) || [''])[0].toLowerCase();
      const seminario = texto(valorCelda(row, mapa.seminario));
      const ciudadFijo = ciudadPorFijo(valorCelda(row, mapa.telefono), valorCelda(row, mapa.celular));

      let c = contactos.get(celular);
      if (!c) {
        c = { celular, nombre: '', empresa: '', correo: '', ciudadFijo: null, ciudadHoja: null, hojas: new Set(), seminarios: new Set() };
        contactos.set(celular, c);
        r.nuevos++;
      }
      if (!c.nombre && nombre) c.nombre = tituloCase(nombre);
      if (!c.empresa && empresa) c.empresa = empresa;
      if (!c.correo && correo) c.correo = correo;
      // El indicativo del fijo (en cualquier fila) pesa más que la hoja.
      if (!c.ciudadFijo && ciudadFijo) c.ciudadFijo = ciudadFijo;
      if (!c.ciudadHoja) c.ciudadHoja = ciudadPorHoja(ws.name);
      c.hojas.add(ws.name);
      if (seminario) c.seminarios.add(seminario);
    }
    porHoja.push(r);
  }

  const filas = [...contactos.values()].map((c) => ({
    celular: c.celular,
    nombre: c.nombre.slice(0, 160) || null,
    primer_nombre: primerNombre(c.nombre),
    empresa: c.empresa.slice(0, 200) || null,
    ciudad: c.ciudadFijo || c.ciudadHoja || null,
    correo: c.correo.slice(0, 255) || null,
    hoja_origen: [...c.hojas].join('; ').slice(0, 255),
    seminarios_previos: [...c.seminarios].join('; ') || null,
  }));

  let insertados = 0;
  let actualizados = 0;
  const errores = [];

  if (modoCiudades) {
    // Solo actualiza la ciudad de contactos que ya existen (no inserta ni toca otros campos).
    const conCiudad = filas.filter((f) => f.ciudad);
    fs.mkdirSync(path.dirname(ciudadesSalida), { recursive: true });
    const out = fs.createWriteStream(ciudadesSalida, { encoding: 'utf8' });
    out.write('-- Generado por src/import.js --sql-ciudades  ·  importar en phpMyAdmin (requiere db/002_lotes_ciudad.sql)\n');
    out.write('SET NAMES utf8mb4;\n\n');
    for (let i = 0; i < conCiudad.length; i += 500) {
      const lote = conCiudad.slice(i, i + 500);
      out.write('UPDATE contactos SET ciudad = CASE celular\n');
      out.write(lote.map((f) => `  WHEN ${sqlLit(f.celular)} THEN ${sqlLit(f.ciudad)}`).join('\n'));
      out.write(`\n  ELSE ciudad END\nWHERE celular IN (${lote.map((f) => sqlLit(f.celular)).join(', ')});\n\n`);
    }
    await new Promise((r) => out.end(r));
  } else if (modoSql) {
    fs.mkdirSync(path.dirname(sqlSalida), { recursive: true });
    const out = fs.createWriteStream(sqlSalida, { encoding: 'utf8' });
    out.write('-- Generado por src/import.js  ·  pegar en phpMyAdmin (SQL) o importar el archivo\n');
    out.write('SET NAMES utf8mb4;\n\n');
    const cols = ['celular', 'nombre', 'primer_nombre', 'empresa', 'ciudad', 'correo', 'hoja_origen', 'seminarios_previos'];
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500);
      out.write(`INSERT INTO contactos (${cols.join(', ')}) VALUES\n`);
      out.write(lote.map((f) => `  (${cols.map((k) => sqlLit(f[k])).join(', ')})`).join(',\n'));
      out.write(
        '\nON DUPLICATE KEY UPDATE nombre = VALUES(nombre), primer_nombre = VALUES(primer_nombre), ' +
          'empresa = VALUES(empresa), ciudad = VALUES(ciudad), correo = VALUES(correo), hoja_origen = VALUES(hoja_origen), ' +
          'seminarios_previos = VALUES(seminarios_previos);\n\n'
      );
    }
    await new Promise((r) => out.end(r));
  } else if (!dry) {
    const db = require('./db'); // solo aquí: --dry y --sql no necesitan base de datos
    await db.exigirConexion();
    try {
      for (const f of filas) {
        try {
          (await db.upsertContacto(f)) === 'insertado' ? insertados++ : actualizados++;
        } catch (e) {
          errores.push(`${f.celular}: ${e.message}`);
        }
      }
    } finally {
      await db.pool.end();
    }
  }

  console.log('\n── Por hoja ──');
  for (const r of porHoja) {
    console.log(`${r.hoja.padEnd(22)} filas ${String(r.filas).padStart(6)} · con celular ${String(r.conCelular).padStart(5)} · nuevos ${String(r.nuevos).padStart(5)}`);
  }
  console.log('\n── Resumen ──');
  console.log(`Contactos únicos      : ${filas.length}`);
  console.log(`  · con primer nombre : ${filas.filter((f) => f.primer_nombre).length}`);
  console.log(`  · con empresa       : ${filas.filter((f) => f.empresa).length}`);
  console.log(`  · con seminarios    : ${filas.filter((f) => f.seminarios_previos).length}`);
  const porCiudad = new Map();
  for (const f of filas) porCiudad.set(f.ciudad || 'Sin ciudad', (porCiudad.get(f.ciudad || 'Sin ciudad') || 0) + 1);
  console.log('  · por ciudad        : ' + [...porCiudad].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log(`Omitidos (EXCLUIR_CELULARES): ${omitidosExcluidos}`);
  if (!dry && !modoSql && !modoCiudades) console.log(`Insertados: ${insertados} · actualizados: ${actualizados} · errores: ${errores.length}`);
  errores.slice(0, 20).forEach((e) => console.log('  -', e));
  if (dry) console.log('\n(--dry: no se escribió nada)');
  if (modoCiudades) console.log(`\nSQL de ciudades escrito en: ${ciudadesSalida}  (${filas.filter((f) => f.ciudad).length} contactos con ciudad)`);
  else if (modoSql) console.log(`\nSQL escrito en: ${sqlSalida}  (${filas.length} filas)`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
