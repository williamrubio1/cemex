'use strict';

/**
 * Normalización y validación de los datos que el contacto escribe en el chat
 * (nombre, correo, ciudad, empresa y cargo). Funciones puras, sin BD.
 *
 * Cada función devuelve { ok, valor, motivo?, sugerencia? }:
 *   ok         el texto sirve
 *   valor      el dato limpio (lo que se guarda)
 *   sugerencia correo corregido para confirmar con el contacto (ej. gmial.com -> gmail.com)
 */

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (s) => sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const espacios = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Palabras que van en minúscula dentro de un nombre propio (salvo al inicio).
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'van', 'von', 'el', 'en', 'a', 'con', 'para', 'por']);
// Títulos que la gente antepone al nombre y no hacen parte de él.
const RE_TITULO = /^(dr|dra|doctor|doctora|sr|sra|srta|señor|señora|ing|lic|cp|prof)\.?\s+/i;

/** "mARÍA  de LA rosa" -> "María de la Rosa". Respeta tildes, ñ, guion y apóstrofo. */
function tipoTitulo(s) {
  return espacios(s)
    .toLowerCase()
    .split(' ')
    .map((p, i) =>
      i > 0 && PARTICULAS.has(p)
        ? p
        : p.replace(/(^|[-'’])(\p{L})/gu, (_m, sep, l) => sep + l.toUpperCase())
    )
    .join(' ');
}

// ─── Nombre ────────────────────────────────────────────────

/** Nombre completo: solo letras, espacios, guion y apóstrofo; al menos nombre y apellido. */
function nombre(texto) {
  const limpio = espacios(
    espacios(texto)
      .replace(RE_TITULO, '')
      .replace(/[\p{Extended_Pictographic}‍️]/gu, ' ')
      .replace(/[^\p{L}\s'’-]/gu, ' ')
      .replace(/(^|\s)[-'’]+|[-'’]+(?=\s|$)/g, ' ')
  );
  const valor = tipoTitulo(limpio).slice(0, 160);
  const palabras = valor.split(' ').filter((p) => p.replace(/[-'’]/g, '').length >= 2);
  if (palabras.length < 2) return { ok: false, valor, motivo: 'nombre_incompleto' };
  if (valor.split(' ').length > 8) return { ok: false, valor, motivo: 'nombre_largo' };
  return { ok: true, valor };
}

// ─── Correo ────────────────────────────────────────────────

// Errores de digitación frecuentes en el dominio -> dominio correcto.
const DOMINIOS = {
  'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gimail.com': 'gmail.com', 'gmail.com.co': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com', 'hotamil.com': 'hotmail.com', 'hotmil.com': 'hotmail.com', 'homail.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
  'yaho.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhoo.com': 'yahoo.com',
  'yahoo.es.co': 'yahoo.es',
};
const RE_CORREO = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9_%+-])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/** Correo en minúsculas y sin espacios. Si el dominio parece mal escrito, propone la corrección. */
function correo(texto) {
  let v = String(texto || '')
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, '')
    .replace(/\s+/g, '')
    .replace(/[.,;:]+$/, '')
    .replace(/^[<("']+|[>)"']+$/g, '');
  // "nombre arroba gmail punto com"
  v = v.replace(/\(?arroba\)?/g, '@').replace(/\(?punto\)?(?=[a-z])/g, '.');
  if (!RE_CORREO.test(v) || v.includes('..') || v.length > 254) return { ok: false, valor: v, motivo: 'correo_invalido' };
  const [usuario, dominio] = v.split('@');
  const correcto = DOMINIOS[dominio];
  if (correcto) return { ok: true, valor: v, sugerencia: `${usuario}@${correcto}` };
  return { ok: true, valor: v };
}

// ─── Ciudad ────────────────────────────────────────────────

// Capitales y municipios principales de Colombia (nombre oficial). La búsqueda ignora tildes.
const CIUDADES = [
  'Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena', 'Cúcuta', 'Bucaramanga', 'Pereira', 'Santa Marta',
  'Ibagué', 'Pasto', 'Manizales', 'Neiva', 'Villavicencio', 'Armenia', 'Valledupar', 'Montería', 'Sincelejo',
  'Popayán', 'Tunja', 'Riohacha', 'Quibdó', 'Florencia', 'Yopal', 'Arauca', 'Mocoa', 'San Andrés', 'Leticia',
  'Inírida', 'San José del Guaviare', 'Mitú', 'Puerto Carreño',
  // Área metropolitana / sabana de Bogotá
  'Soacha', 'Chía', 'Zipaquirá', 'Facatativá', 'Funza', 'Mosquera', 'Madrid', 'Cajicá', 'Cota', 'Tocancipá',
  'Sopó', 'La Calera', 'Tenjo', 'Tabio', 'Gachancipá', 'Sibaté', 'Fusagasugá', 'Girardot', 'Ubaté', 'Villeta',
  // Antioquia
  'Bello', 'Itagüí', 'Envigado', 'Sabaneta', 'La Estrella', 'Caldas', 'Copacabana', 'Girardota', 'Barbosa',
  'Rionegro', 'Marinilla', 'La Ceja', 'El Retiro', 'Guarne', 'Apartadó', 'Turbo', 'Caucasia', 'Santa Fe de Antioquia',
  // Valle y suroccidente
  'Palmira', 'Buenaventura', 'Tuluá', 'Cartago', 'Buga', 'Jamundí', 'Yumbo', 'Candelaria', 'Florida', 'Sevilla',
  'Ipiales', 'Tumaco', 'Santander de Quilichao',
  // Caribe
  'Soledad', 'Malambo', 'Puerto Colombia', 'Sabanalarga', 'Magangué', 'Turbaco', 'Ciénaga', 'Maicao', 'Aguachica',
  'Lorica', 'Cereté', 'Sahagún', 'Corozal', 'El Carmen de Bolívar',
  // Santanderes y Boyacá
  'Floridablanca', 'Girón', 'Piedecuesta', 'Barrancabermeja', 'San Gil', 'Socorro', 'Villa del Rosario', 'Los Patios',
  'Ocaña', 'Pamplona', 'Duitama', 'Sogamoso', 'Chiquinquirá', 'Paipa',
  // Eje Cafetero, Tolima, Huila, Llanos
  'Dosquebradas', 'Santa Rosa de Cabal', 'La Dorada', 'Chinchiná', 'Calarcá', 'Espinal', 'Melgar', 'Honda',
  'Pitalito', 'Garzón', 'La Plata', 'Acacías', 'Granada', 'Puerto López', 'Aguazul',
];
const ALIAS_CIUDAD = {
  'bogota dc': 'Bogotá', 'bogota d c': 'Bogotá', 'santafe de bogota': 'Bogotá', 'santa fe de bogota': 'Bogotá',
  bta: 'Bogotá', bog: 'Bogotá', 'distrito capital': 'Bogotá', 'medallo': 'Medellín', 'mde': 'Medellín',
  'cali valle': 'Cali', 'santiago de cali': 'Cali', 'cartagena de indias': 'Cartagena', 'cucuta norte de santander': 'Cúcuta',
  'san jose de cucuta': 'Cúcuta', 'villavo': 'Villavicencio', 'barranca': 'Barrancabermeja', 'b quilla': 'Barranquilla',
  'baq': 'Barranquilla', 'bquilla': 'Barranquilla', 'itagui': 'Itagüí', 'giron': 'Girón', 'san andres isla': 'San Andrés',
};
const MAPA_CIUDAD = new Map([...CIUDADES.map((c) => [clave(c), c]), ...Object.entries(ALIAS_CIUDAD)]);

/** Ciudad: nombre oficial si es conocida ("bogota d.c." -> "Bogotá"); si no, en tipo título. */
function ciudad(texto) {
  const crudo = espacios(String(texto || '').replace(/[^\p{L}\s.,()-]/gu, ' '));
  const k = clave(crudo);
  if (!k || k.length < 3 || k.length > 60) return { ok: false, valor: crudo, motivo: 'ciudad_invalida' };
  if (MAPA_CIUDAD.has(k)) return { ok: true, valor: MAPA_CIUDAD.get(k) };
  // "Chía, Cundinamarca" / "Medellín (Antioquia)" / "Bogotá - Colombia": probar la primera parte.
  const primera = clave(crudo.split(/[,(\-]/)[0]);
  if (MAPA_CIUDAD.has(primera)) return { ok: true, valor: MAPA_CIUDAD.get(primera) };
  // Quitar "colombia" al final.
  const sinPais = k.replace(/\s*colombia$/, '').trim();
  if (MAPA_CIUDAD.has(sinPais)) return { ok: true, valor: MAPA_CIUDAD.get(sinPais) };
  const valor = tipoTitulo(crudo.split(/[,(]/)[0].replace(/[.)]/g, ' ')).slice(0, 80);
  if (valor.replace(/[^\p{L}]/gu, '').length < 3) return { ok: false, valor, motivo: 'ciudad_invalida' };
  return { ok: true, valor };
}

// ─── Empresa ───────────────────────────────────────────────

const SIGLAS = /\b(s\.?\s?a\.?\s?s\.?|s\.?\s?a\.?|ltda\.?|e\.?\s?u\.?|s\.?\s?en\s?c\.?|e\.?\s?s\.?\s?p\.?|ips|eps|ese|nit)(?=\s|$)/gi;

/** Empresa: espacios limpios; si viene toda en mayúsculas o minúsculas, en tipo título con siglas en mayúscula. */
function empresa(texto) {
  const crudo = espacios(String(texto || '').replace(/[\p{Extended_Pictographic}‍️]/gu, ' ').replace(/[<>"]/g, ''));
  if (crudo.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return { ok: false, valor: crudo, motivo: 'empresa_invalida' };
  const uniforme = crudo === crudo.toUpperCase() || crudo === crudo.toLowerCase();
  let valor = uniforme ? tipoTitulo(crudo) : crudo;
  valor = valor.replace(SIGLAS, (m) => m.toUpperCase().replace(/\s+/g, ''));
  return { ok: true, valor: valor.slice(0, 200) };
}

// ─── Cargo ─────────────────────────────────────────────────

// Abreviaturas y palabras sin tilde frecuentes en cargos.
const PALABRAS_CARGO = {
  aux: 'auxiliar', 'aux.': 'auxiliar', asist: 'asistente', 'asist.': 'asistente', gte: 'gerente', 'gte.': 'gerente',
  coord: 'coordinador', 'coord.': 'coordinador', dir: 'director', 'dir.': 'director', adm: 'administrativo',
  admin: 'administrativo', cont: 'contable', ctb: 'contable', rf: 'revisor fiscal', rev: 'revisor',
  publico: 'público', publica: 'pública', tecnico: 'técnico', tecnica: 'técnica', tecnologo: 'tecnólogo',
  tecnologa: 'tecnóloga', analisis: 'análisis', auditoria: 'auditoría', logistica: 'logística', nomina: 'nómina',
  area: 'área', informacion: 'información', gestion: 'gestión', administracion: 'administración',
  economico: 'económico', economica: 'económica', juridico: 'jurídico', juridica: 'jurídica', lider: 'líder',
  estadistica: 'estadística', facturacion: 'facturación', tesoreria: 'tesorería', credito: 'crédito',
  operacion: 'operación',
};
// Frases completas -> cargo estándar.
const CARGOS = [
  [/^(contador|contadora)( publico| publica)?$/, (m) => (m[1] === 'contadora' ? 'Contadora Pública' : 'Contador Público')],
  [/^(cp|c p)$/, () => 'Contador Público'],
  [/^(aux|auxiliar) (de )?(contable|contabilidad|cont)$/, () => 'Auxiliar Contable'],
  [/^(asist|asistente) (de )?(contable|contabilidad)$/, () => 'Asistente Contable'],
  [/^(rf|revisor|revisora)( fiscal)?$/, (m) => (m[1] === 'revisora' ? 'Revisora Fiscal' : 'Revisor Fiscal')],
  [/^(gte|gerente) (general|gral)$/, () => 'Gerente General'],
  [/^(analista) (contable|de contabilidad)$/, () => 'Analista Contable'],
  [/^(jefe) (de )?(contabilidad|contable)$/, () => 'Jefe de Contabilidad'],
  [/^(director|directora) (financiero|financiera)$/, (m) => (m[1] === 'directora' ? 'Directora Financiera' : 'Director Financiero')],
];

/** Cargo en tipo título, con abreviaturas expandidas y tildes corregidas. */
function cargo(texto) {
  const crudo = espacios(String(texto || '').replace(/[^\p{L}\s.()/&-]/gu, ' '));
  const k = clave(crudo);
  if (!k || k.replace(/\s/g, '').length < 2 || k.length > 120) return { ok: false, valor: crudo, motivo: 'cargo_invalido' };
  for (const [re, fn] of CARGOS) {
    const m = k.match(re);
    if (m) return { ok: true, valor: fn(m) };
  }
  const palabras = espacios(crudo.toLowerCase().replace(/[()]/g, ' '))
    .split(' ')
    .map((p) => PALABRAS_CARGO[p] || PALABRAS_CARGO[sinTildes(p)] || p);
  return { ok: true, valor: tipoTitulo(palabras.join(' ')).slice(0, 120) };
}

/** ¿Es una de las ciudades del catálogo? (para confirmar la ciudad que ya trae la base). */
const esCiudadConocida = (s) => CIUDADES.includes(String(s || ''));

module.exports = { nombre, correo, ciudad, empresa, cargo, tipoTitulo, clave, esCiudadConocida };
