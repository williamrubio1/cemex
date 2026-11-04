'use strict';

/**
 * Conversación de la campaña CETEX (función pura: no toca BD ni WhatsApp).
 *
 *   Plantilla (marketing) con 3 botones:
 *     ✅ Quiero participar          -> URL (abre el WhatsApp de ventas de CETEX; no llega al webhook)
 *     Más información               -> respuesta rápida -> detalle + botón "Quiero participar"
 *     No deseo recibir mensajes     -> respuesta rápida -> opt-out en todas las campañas
 *
 *   Texto libre -> si pide la baja: opt-out; si escribe ALTA estando de baja: se reactiva;
 *                  en otro caso: agradecimiento + botón "Quiero participar".
 *
 * decidir() devuelve { acciones, respuesta, contacto } que index.js ejecuta.
 */

const MARCA = process.env.CLIENTE_NOMBRE || 'CETEX';

// Prioridad para no "bajar" la respuesta registrada en un envío.
const PRIORIDAD = { texto: 1, mas_info: 2, participar: 3, opt_out: 4 };
const respuestaFinal = (anterior, nueva) =>
  !anterior || (PRIORIDAD[nueva] || 0) >= (PRIORIDAD[anterior] || 0) ? nueva : anterior;

const RE_BAJA =
  /\b(salir|stop|baja|darme de baja|cancelar suscripci[oó]n|no (me )?interesa|no deseo|no quiero|no (me )?(escriban|env[ií]en|contacten)|eliminar(me)?)\b/i;
const RE_ALTA = /^\s*alta\s*$/i;

/** Clasifica el botón de la plantilla por su payload o su texto. */
function botonPlantilla(entrada) {
  const t = `${entrada.payload || ''} ${entrada.titulo || ''}`;
  if (/no deseo|no recibir|no me interesa|opt_?out|baja/i.test(t)) return 'opt_out';
  if (/m[aá]s info|informaci[oó]n|mas_info/i.test(t)) return 'mas_info';
  if (/participar|inscrib/i.test(t)) return 'participar';
  return 'texto';
}

/** Línea con los datos de la campaña. */
function resumenCampana(c) {
  return [
    c.seminario ? `📚 *${c.seminario}*` : `📚 *${c.nombre}*`,
    c.fechas ? `📅 ${c.fechas}` : '',
    c.horario ? `🕔 Horario: ${c.horario}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const BTN_PARTICIPAR = '✅ Quiero participar';

/**
 * @param {object|null} contacto  fila de `contactos` (null si el número no está en la base)
 * @param {object|null} campana   fila de `campanas` (la del envío o la activa)
 * @param {object} entrada        { clase: 'boton_plantilla'|'boton'|'texto'|'otro', titulo?, payload?, id?, texto? }
 * @param {string} urlParticipar  enlace del botón (medido vía /r/<token> si hay dominio público)
 */
function decidir(contacto, campana, entrada, urlParticipar) {
  const acciones = [];
  const cta = (cuerpo) => acciones.push({ tipo: 'cta_url', cuerpo, boton: BTN_PARTICIPAR, url: urlParticipar });
  const texto = (t) => acciones.push({ tipo: 'texto', texto: t });

  // Clasificar la intención.
  let intencion;
  if (entrada.clase === 'boton_plantilla') intencion = botonPlantilla(entrada);
  else if (entrada.clase === 'boton') intencion = botonPlantilla({ payload: entrada.id, titulo: entrada.titulo });
  else if (entrada.clase === 'texto' && RE_ALTA.test(entrada.texto || '')) intencion = 'alta';
  else if (entrada.clase === 'texto' && RE_BAJA.test(entrada.texto || '')) intencion = 'opt_out';
  else intencion = 'texto';

  // Número que no está en la base: se le atiende igual, sin registrar nada.
  if (!contacto) {
    if (campana) cta(`¡Hola! Le saluda ${MARCA}.\n\n${resumenCampana(campana)}\n\nToque el botón para hablar con un asesor e inscribirse.`);
    else texto(`¡Hola! Le saluda ${MARCA}. Un asesor le atenderá pronto.`);
    return { acciones, respuesta: null, contacto: {} };
  }

  // Ya pidió no recibir mensajes.
  if (contacto.opt_out && intencion !== 'alta') {
    if (intencion !== 'opt_out') {
      texto(`Usted está excluido(a) de los envíos de ${MARCA}. Si desea volver a recibir información, escriba *ALTA*.`);
    }
    return { acciones, respuesta: null, contacto: {} };
  }

  switch (intencion) {
    case 'alta':
      texto(`¡Listo! Volverá a recibir información de los seminarios de ${MARCA}. 🙌`);
      return { acciones, respuesta: null, contacto: { opt_out: 0, opt_out_en: null, estado: 'contactado' } };

    case 'opt_out':
      texto(
        `Entendido. No le volveremos a enviar mensajes de ${MARCA} por este medio. ` +
          'Si cambia de opinión, escriba *ALTA*. ¡Que tenga un excelente día!'
      );
      return { acciones, respuesta: 'opt_out', contacto: { opt_out: 1, opt_out_en: new Date(), estado: 'opt_out' } };

    case 'mas_info':
    case 'participar': {
      if (!campana) {
        texto(`Gracias por su interés. Un asesor de ${MARCA} le contactará pronto.`);
      } else {
        const detalle = campana.detalle ? `\n\n${campana.detalle}` : '';
        cta(`${resumenCampana(campana)}${detalle}\n\nToque *Quiero participar* para hablar con un asesor de ${MARCA} e inscribirse.`);
      }
      return { acciones, respuesta: intencion, contacto: { estado: 'interesado' } };
    }

    default: // texto libre u otro tipo de mensaje
      if (campana) {
        cta(`Gracias por escribirnos. Para inscribirse o resolver sus dudas sobre el *${campana.seminario || campana.nombre}*, toque el botón y un asesor de ${MARCA} le atenderá.`);
      } else {
        texto(`Gracias por escribirnos. Un asesor de ${MARCA} le atenderá pronto.`);
      }
      return { acciones, respuesta: 'texto', contacto: {} };
  }
}

module.exports = { decidir, respuestaFinal, botonPlantilla, RE_BAJA };
