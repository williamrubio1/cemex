'use strict';

/**
 * Simula la conversación de la campaña sin BD ni WhatsApp.
 * Sirve para revisar los textos antes de probar en el teléfono real.
 *
 *   npm run simular
 */

const { decidir, respuestaFinal } = require('./conversacion');

const CAMPANA = {
  id: 1,
  nombre: 'Taller Cierre contable y fiscal 2026',
  seminario: 'Taller Cierre contable y fiscal con IA y sin IA bajo NIIF para Pymes 2026 – Decreto 701',
  fechas: 'Noviembre 23, 25 y 26',
  horario: '5:00 p. m. a 9:00 p. m.',
  url_inscripcion: 'https://wa.me/573142511033?text=Quiero%20participar',
  detalle: null,
};
const URL = 'https://<dominio>/r/abc123';
const BASE = { id: 1, nombre: 'William Rubio', primer_nombre: 'William', estado: 'contactado', opt_out: 0 };

const txt = (t) => ({ clase: 'texto', texto: t });
const btnPlantilla = (titulo) => ({ clase: 'boton_plantilla', titulo, payload: titulo });

function correr(nombre, pasos, contactoInicial = BASE) {
  console.log(`\n═══════════ ${nombre} ═══════════`);
  let c = contactoInicial && { ...contactoInicial };
  let respuesta = null;
  for (const entrada of pasos) {
    const plan = decidir(c, CAMPANA, entrada, URL);
    console.log(`\n▶ ${JSON.stringify(entrada)}`);
    for (const a of plan.acciones) {
      if (a.tipo === 'texto') console.log(`  BOT: ${a.texto}`);
      else if (a.tipo === 'cta_url') console.log(`  BOT: ${a.cuerpo}\n       [ ${a.boton} → ${a.url} ]`);
    }
    if (!plan.acciones.length) console.log('  BOT: (no responde)');
    if (c) c = { ...c, ...plan.contacto };
    if (plan.respuesta) respuesta = respuestaFinal(respuesta, plan.respuesta);
    console.log(`  » respuesta=${respuesta || '—'} · estado=${c ? c.estado : '(no está en la base)'}${c && c.opt_out ? ' · OPT-OUT' : ''}`);
  }
}

correr('Más información', [btnPlantilla('Más información')]);
correr('No desea recibir mensajes', [btnPlantilla('No deseo recibir mensajes')]);
correr('Escribe una pregunta y luego pide la baja', [txt('¿Cuál es el valor del taller?'), txt('no me interesa, gracias')]);
correr('De baja escribe algo, luego ALTA', [txt('hola'), txt('ALTA')], { ...BASE, opt_out: 1, estado: 'opt_out' });
correr('Número que no está en la base', [txt('Buenas, quiero información')], null);
