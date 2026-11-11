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
const ENLACES = { web: `${URL}?a=web`, comprobante: `${URL}?a=comprobante` };
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
  if (a.tipo === 'documento') return `  BOT: 📎 ${a.archivo} (public/docs/${a.pdf})
       ${a.leyenda}`;
  return `  BOT: (${a.tipo})`;
}

/** Corre una conversación y devuelve el registro final (para las comprobaciones). */
const TODAS = []; // todas las acciones de todas las conversaciones (para revisar límites de WhatsApp)
function correr(nombre, pasos, contactoInicial = BASE, { silencioso = false, campana = CAMPANA, origen = null } = {}) {
  const log = (s) => !silencioso && console.log(s);
  log(`\n═══════════ ${nombre} ═══════════`);
  let c = contactoInicial && { ...contactoInicial };
  let registro = null;
  let respuesta = null;
  let ultimas = [];
  for (const entrada of pasos) {
    const plan = decidir({ contacto: c, campana, registro, origen, entrada, url: URL, enlaces: ENLACES });
    ultimas = plan.acciones;
    TODAS.push(...plan.acciones);
    log(`\n▶ ${JSON.stringify(entrada)}`);
    for (const a of plan.acciones) log(mostrar(a));
    if (!plan.acciones.length) log('  BOT: (no responde)');
    if (c) c = { ...c, ...plan.contacto };
    if (plan.registro) registro = { ...(registro || {}), ...plan.registro };
    if (plan.respuesta) respuesta = respuestaFinal(respuesta, plan.respuesta);
    log(`  » respuesta=${respuesta || '—'} · paso=${registro?.paso || '—'} · ${registro?.clasificacion || ''}${c?.opt_out ? ' · OPT-OUT' : ''}`);
  }
  return { registro, contacto: c, respuesta, ultimas };
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

res.pagar = correr('Más información y luego Quiero participar (formas de pago, sin cuestionario)', [
  plantilla('Más información'),
  boton('pagar', 'Quiero participar'),
  boton('hablar', 'Hablar con asesor'),
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

// ── Seguimiento (plantillas de Utilidad por segmento) ──
const SEGUIMIENTO = { id: 4, tipo: 'seguimiento', origen_campana_id: 2, nombre: 'Seguimiento calientes', url_inscripcion: 'https://wa.me/573142511033', detalle: null };
const ORIGEN = { paso: 'fin', interes: 'sagrilaft', nombre: 'William Rubio', clasificacion: 'caliente', corporativo: 0 };
const seg = (nombre, pasos, origen = ORIGEN) => correr(nombre, pasos, BASE, { silencioso, campana: SEGUIMIENTO, origen });
res.segInscribirme = seg('Seguimiento: Inscribirme', [plantilla('Inscribirme')]);
res.segCotizacion = seg('Seguimiento: Recibir cotización', [plantilla('Recibir cotización')], { ...ORIGEN, interes: 'ambas' });
res.segVerInfo = seg('Seguimiento: Ver información', [plantilla('Ver información')]);
res.segInfo = seg('Seguimiento: Ver información y luego Inscribirme', [plantilla('Ver información'), boton('seg_inscribirme', 'Inscribirme')]);
res.segTexto = seg('Seguimiento: escribe una frase con "no quiero" (no es baja)', [txt('no quiero pagar en efectivo, ¿aceptan transferencia?')]);
res.segBaja = seg('Seguimiento: No deseo recibir mensajes', [plantilla('No deseo recibir mensajes')]);

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
ok(res.segInscribirme.respuesta === 'participar' && !res.segInscribirme.registro, 'seguimiento: Inscribirme = participar, sin cuestionario');
ok(res.segCotizacion.respuesta === 'participar', 'seguimiento: Recibir cotización = participar');
ok(res.segInfo.respuesta === 'participar', 'seguimiento: Ver información y luego Inscribirme');
ok(res.segTexto.respuesta === 'texto' && res.segTexto.contacto.opt_out === 0, 'seguimiento: "no quiero pagar…" no es baja');
ok(res.segBaja.contacto.opt_out === 1, 'seguimiento: No deseo recibir mensajes = baja');

// ── Información y pago (src/oferta.js) ──
const cuerpo = (x) => x.cuerpo || x.texto || x.leyenda || '';
const ctas = (acc) => acc.filter((x) => x.tipo === 'cta_url');
const fc = ctas(res.completo.ultimas);
ok(fc.length === 1 && fc[0].boton === 'Hablar con asesor' && /Valor por participante/.test(fc[0].cuerpo) && /\$190\.000 \+ IVA/.test(fc[0].cuerpo) && !/340\.000/.test(fc[0].cuerpo),
  'final corporativo: cotización con el valor de su capacitación y botón al asesor');
const fe = ctas(res.escrito.ultimas);
ok(fe.length === 2 && fe[0].boton === 'Inscribirme en línea' && fe[0].url === ENLACES.web && fe[1].boton === 'Enviar comprobante' && fe[1].url === ENLACES.comprobante,
  'final individual: [Inscribirme en línea] + [Enviar comprobante] medidos');
ok(/58999443557/.test(fe[0].cuerpo) && /900\.626\.419-4/.test(fe[0].cuerpo) && /Cetex Asesores S\.A\.S\./.test(fe[0].cuerpo) && /\$190\.000 \+ IVA/.test(fe[0].cuerpo) && /\$340\.000 \+ IVA/.test(fe[0].cuerpo),
  'final individual (ambas): cuenta, titular, NIT y los dos valores + IVA');
ok(res.escrito.ultimas.filter((x) => x.tipo === 'documento').length === 2, 'final con "necesito más info": antes van los 2 PDF');
ok(/capacitaciones@cetex\.com\.co/.test(fe[1].cuerpo), 'comprobante: correo de CETEX');
const si = ctas(res.segInscribirme.ultimas);
ok(si.length === 2 && /SAGRILAFT/.test(si[0].cuerpo) && /\$340\.000 \+ IVA/.test(si[0].cuerpo) && !/190\.000/.test(si[0].cuerpo) && /William/.test(si[0].cuerpo),
  'seguimiento Inscribirme: valor de la capacitación de origen (SAGRILAFT) y nombre');
ok(/\$190\.000/.test(ctas(res.segCotizacion.ultimas)[0].cuerpo) && /\$340\.000/.test(ctas(res.segCotizacion.ultimas)[0].cuerpo), 'seguimiento cotización "ambas": los dos valores por participante');
const vi = res.segVerInfo.ultimas;
ok(vi.length === 2 && vi[0].tipo === 'documento' && /sagrilaft/.test(vi[0].pdf) && vi[1].tipo === 'botones' && !/Jenith/.test(vi[1].cuerpo),
  'seguimiento Ver información: solo el PDF de su capacitación y luego los botones');
ok(!TODAS.some((x) => x.tipo !== 'documento' && /🎤/.test(cuerpo(x))), 'la ficha en texto no se envía junto al PDF (solo es respaldo)');
ok(TODAS.filter((x) => x.tipo === 'documento').every((x) => x.respaldo && /🎤/.test(x.respaldo)), 'cada PDF lleva la ficha de respaldo por si falla');
// "Más información" -> PDFs -> [Quiero participar] [Hablar con asesor] -> formas de pago, sin cuestionario
const P = res.pagar;
ok(P.registro && P.registro.paso === 'inicio' && !P.registro.interes && P.respuesta === 'participar', 'Quiero participar tras la información: no inicia el cuestionario');
ok(TODAS.some((x) => x.tipo === 'botones' && x.botones.map((b) => b.id).join() === 'pagar,hablar'), 'tras los PDF: botones [Quiero participar] [Hablar con asesor]');

ok(!TODAS.some((x) => /226\.100|404\.600/.test(cuerpo(x))), 'nunca se muestra el total con IVA');
const largo = TODAS.filter((x) => cuerpo(x).length > 1024);
ok(!largo.length, `ningún mensaje supera 1024 caracteres (máx. ${Math.max(...TODAS.map((x) => cuerpo(x).length))})`);
const pg = ctas(TODAS).filter((x) => x.boton === 'Inscribirme en línea');
ok(pg.length && pg.every((x) => /checkout\.wompi\.co\/l\/VPOS_kvde1L/.test(x.cuerpo) && /58999443557/.test(x.cuerpo) && /Inscribirme en línea/.test(x.cuerpo)),
  'formas de pago: página de CETEX, datáfono Wompi y transferencia');
const titulos = TODAS.flatMap((x) => (x.tipo === 'cta_url' ? [x.boton] : x.tipo === 'botones' ? x.botones.map((b) => b.title) : []));
ok(titulos.every((t) => t.length <= 20), `botones de máx. 20 caracteres (${[...new Set(titulos)].join(' · ')})`);
