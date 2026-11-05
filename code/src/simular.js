'use strict';

/**
 * Simula la conversación de la campaña sin BD ni WhatsApp.
 * Sirve para revisar los textos y el cuestionario antes de probar en el teléfono real.
 *
 *   npm run simular
 */

const { decidir, respuestaFinal } = require('./conversacion');

const CAMPANA = {
  id: 2,
  nombre: 'Capacitaciones CETEX noviembre y diciembre 2026',
  url_inscripcion: 'https://wa.me/573142511033',
  detalle: null,
};
const URL = 'https://<dominio>/r/abc123';
const BASE = {
  id: 1, nombre: 'WILLIAM RUBIO', primer_nombre: 'WILLIAM', correo: 'wrubio@gmial.com', empresa: 'soluctia sas',
  ciudad: 'Bogotá', estado: 'contactado', opt_out: 0,
};

const txt = (t) => ({ clase: 'texto', texto: t });
const plantilla = (titulo) => ({ clase: 'boton_plantilla', titulo, payload: titulo });
const boton = (id, titulo = id) => ({ clase: 'boton', id, titulo });
const lista = (id, titulo = id) => ({ clase: 'lista', id, titulo });

function mostrar(a) {
  if (a.tipo === 'texto') return `  BOT: ${a.texto}`;
  if (a.tipo === 'cta_url') return `  BOT: ${a.cuerpo}\n       [ ${a.boton} → ${a.url} ]`;
  if (a.tipo === 'botones') return `  BOT: ${a.cuerpo}\n       ${a.botones.map((b) => `[ ${b.title} ]`).join(' ')}`;
  if (a.tipo === 'lista') return `  BOT: ${a.cuerpo}\n       ≡ ${a.boton}: ${a.filas.map((f) => f.title).join(' | ')}`;
  return `  BOT: (${a.tipo})`;
}

/** Corre una conversación y devuelve el registro final (para las comprobaciones). */
function correr(nombre, pasos, contactoInicial = BASE, { silencioso = false } = {}) {
  const log = (s) => !silencioso && console.log(s);
  log(`\n═══════════ ${nombre} ═══════════`);
  let c = contactoInicial && { ...contactoInicial };
  let registro = null;
  let respuesta = null;
  for (const entrada of pasos) {
    const plan = decidir({ contacto: c, campana: CAMPANA, registro, entrada, url: URL });
    log(`\n▶ ${JSON.stringify(entrada)}`);
    for (const a of plan.acciones) log(mostrar(a));
    if (!plan.acciones.length) log('  BOT: (no responde)');
    if (c) c = { ...c, ...plan.contacto };
    if (plan.registro) registro = { ...(registro || {}), ...plan.registro };
    if (plan.respuesta) respuesta = respuestaFinal(respuesta, plan.respuesta);
    log(`  » respuesta=${respuesta || '—'} · paso=${registro?.paso || '—'} · ${registro?.clasificacion || ''}${c?.opt_out ? ' · OPT-OUT' : ''}`);
  }
  return { registro, contacto: c, respuesta };
}

const silencioso = process.argv.includes('--silencioso');
const res = {};

res.completo = correr('Flujo completo (datos de la base: confirma nombre, corrige correo)', [
  plantilla('Quiero participar'),
  lista('a_cierre', 'Cierre Contable y Fiscal'),
  boton('b_empresa', 'Para una empresa'),
  boton('c_si', 'Sí'),
  lista('d_ahora', 'Inscribirme ahora'),
  boton('conf_si'), // nombre de la base
  boton('conf_si'), // correo de la base (ya corregido gmial -> gmail)
  boton('conf_si'), // ciudad Bogotá
  boton('conf_no'), // empresa: cambiarla
  txt('SOLUCTIA S.A.S.'),
  txt('contador publico'),
], BASE, { silencioso });

res.escrito = correr('Contacto nuevo que responde escribiendo', [
  txt('Hola, quiero información'),
  boton('participar'),
  txt('las dos'),
  txt('individual'),
  txt('soy independiente'),
  txt('necesito mas info'),
  txt('juan'), // incompleto
  txt('JUAN  david  DE LA  torre 😀'),
  txt('juan@hotmial.com'),
  boton('conf_no'), // "No, está bien así": deja hotmial
  txt('medellin, antioquia'),
  txt('aux. contable'),
], { id: 9, nombre: null, primer_nombre: null, estado: 'contactado', opt_out: 0 }, { silencioso });

res.info = correr('Más información y luego baja a mitad del cuestionario', [
  plantilla('Más información'),
  boton('participar'),
  txt('no'), // en la pregunta A: no es una baja
  lista('a_info'),
  txt('salir'),
], BASE, { silencioso });

res.alta = correr('De baja escribe algo, luego ALTA', [txt('hola'), txt('ALTA')], { ...BASE, opt_out: 1, estado: 'opt_out' }, { silencioso });

res.retoma = correr('Retoma: toca la plantilla a mitad del cuestionario; registro completo y vuelve a escribir', [
  plantilla('Quiero participar'),
  lista('a_sagrilaft'),
  plantilla('Quiero participar'),
  boton('b_individual'),
  boton('c_no'),
  lista('d_empresa'),
  txt('si'),
  txt('si'),
  txt('si'),
  txt('no aplica'), // empresa: d_empresa obliga a preguntarla; "no aplica" la deja vacía
  txt('Gerente'),
  txt('gracias!'),
], BASE, { silencioso });

// ── Comprobaciones ──
const ok = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗ FALLA'} ${msg}`);
  if (!cond) process.exitCode = 1;
};
console.log('\n═══════════ Comprobaciones ═══════════');
const a = res.completo.registro;
ok(a.paso === 'fin' && a.completado_en, 'flujo completo termina en "fin"');
ok(a.clasificacion === 'caliente' && a.corporativo === 1, 'inscribirse ahora + empresa = caliente y corporativo');
ok(a.nombre === 'William Rubio' && a.correo === 'wrubio@gmail.com' && a.ciudad === 'Bogotá', 'datos confirmados de la base normalizados');
ok(a.empresa === 'Soluctia S.A.S.' && a.cargo === 'Contador Público', `empresa y cargo normalizados (${a.empresa} · ${a.cargo})`);
const b = res.escrito.registro;
ok(b.paso === 'fin' && b.interes === 'ambas' && b.modalidad === 'individual' && b.situacion === 'independiente', 'respuestas escritas reconocidas');
ok(b.clasificacion === 'interesado' && b.corporativo === 0, 'necesita más info = interesado');
ok(b.nombre === 'Juan David de la Torre', `nombre limpio (${b.nombre})`);
ok(b.correo === 'juan@hotmial.com' && b.ciudad === 'Medellín' && b.empresa == null, `correo sin corregir por elección, ciudad normalizada, sin empresa (${b.correo} · ${b.ciudad})`);
ok(b.cargo === 'Auxiliar Contable', `cargo normalizado (${b.cargo})`);
const c = res.info;
ok(c.contacto.opt_out === 1 && c.respuesta === 'opt_out', '"salir" a mitad del cuestionario = baja');
ok(c.registro.interes === 'info' && c.registro.paso === 'modalidad', '"no" en la pregunta A no fue baja; "Más información" sigue a B');
ok(res.alta.contacto.opt_out === 0, 'ALTA reactiva');
const d = res.retoma.registro;
ok(d.paso === 'fin' && d.empresa == null && d.cargo === 'Gerente' && d.clasificacion === 'interesado' && d.corporativo === 1, 'retoma y "no aplica" en empresa');
