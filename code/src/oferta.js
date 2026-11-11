'use strict';

/**
 * Oferta de CETEX: capacitaciones, valores y medios de pago que el bot entrega en el chat.
 * Fuente: brochures en public/docs/ (los mismos PDF que se envían por WhatsApp) e
 * información de pago entregada por CETEX (nov. 2026).
 *
 * Los valores van SIEMPRE "+ IVA" (CETEX no quiere mostrar el total) y no hay descuentos
 * por grupo. Estos textos NO van en las plantillas (Meta podría pasarlas de Utilidad a
 * Marketing): el bot los envía cuando la persona toca un botón, dentro de la ventana de 24 h.
 *
 * Funciones puras (sin BD ni WhatsApp).
 */

const WA_NUMERO = String(process.env.CLIENTE_WHATSAPP || '573142511033').replace(/\D/g, '');
const CORREO = process.env.CLIENTE_CORREO || 'capacitaciones@cetex.com.co';

const PAGO = {
  web: 'https://cetex.com.co/inscripcion/',
  wompi: 'https://checkout.wompi.co/l/VPOS_kvde1L', // datáfono virtual (link de pago)
  banco: 'Bancolombia',
  cuenta: 'Cuenta de ahorros 58999443557',
  titular: 'Cetex Asesores S.A.S.',
  nit: '900.626.419-4',
  correo: CORREO,
};

const CURSOS = {
  cierre: {
    clave: 'cierre',
    titulo: 'Seminario Cierre Contable y Fiscal con IA y sin IA',
    corto: 'Cierre Contable y Fiscal',
    icono: '📚',
    subtitulo: 'Bajo NIIF para Pymes 2026 · Decreto 701',
    fechas: '23, 25 y 26 de noviembre',
    horario: '5:00 a 9:00 p. m.',
    modalidad: 'Virtual (Google Meet)',
    duracion: '12 horas',
    conferencistas: 'Dr. Juan Fernando Mejía y Dr. Luis Henry Moya',
    dirigido: 'contadores públicos, revisores fiscales, auditores internos, jefes de control interno y equipos contables',
    temas:
      'ajustes de cierre, diferencias temporarias y permanentes, depreciación contable y fiscal, ' +
      'tasa efectiva de tributación, Formulario 110 y Formato 2516, cambios NIIF para Pymes 2025 y Decreto 701',
    incluye: 'material de apoyo y certificado digital de asistencia',
    valor: '$190.000 + IVA',
    pdf: 'cetex-cierre-contable-fiscal-2026.pdf',
    archivo: 'CETEX - Seminario Cierre Contable y Fiscal 2026.pdf',
  },
  sagrilaft: {
    clave: 'sagrilaft',
    titulo: 'Taller práctico SAGRILAFT y PTEE',
    corto: 'SAGRILAFT y PTEE',
    icono: '🛠️',
    subtitulo: 'De la planeación a la práctica · Circular Externa 100-000020 de 2026 (Supersociedades)',
    fechas: '5 y 12 de diciembre (sábados)',
    horario: '7:00 a. m. a 1:00 p. m.',
    modalidad: 'Virtual (campus CETEX)',
    duracion: '12 horas',
    conferencistas: 'Dra. Jenith Esmeralda Linares',
    dirigido: 'oficiales de cumplimiento, revisores fiscales, auditores y áreas de compliance, riesgos y control interno',
    temas:
      'diagnóstico de brechas, integración al nuevo sistema LA/FT/FP y C/ST, matriz de riesgos integrada, ' +
      'controles e indicadores y plan de transición',
    incluye: 'plantillas en Excel, PromptBook del Oficial de Cumplimiento y certificado digital',
    valor: '$340.000 + IVA',
    pdf: 'cetex-sagrilaft-ptee-2026.pdf',
    archivo: 'CETEX - Taller SAGRILAFT y PTEE 2026.pdf',
  },
};

/** Capacitaciones según la respuesta A (cierre | sagrilaft | ambas | info | vacío -> ambas). */
const cursosDe = (interes) => (CURSOS[interes] ? [CURSOS[interes]] : [CURSOS.cierre, CURSOS.sagrilaft]);

/** Ficha completa de una capacitación: solo de respaldo, si el PDF no se puede enviar. */
const resumen = (c) =>
  [
    `${c.icono} *${c.titulo}*`,
    c.subtitulo,
    `📅 ${c.fechas} · ${c.horario}`,
    `💻 ${c.modalidad} · ${c.duracion}`,
    `🎤 ${c.conferencistas}`,
    `👥 Para ${c.dirigido}.`,
    `📝 Temas: ${c.temas}.`,
    `🎓 Incluye ${c.incluye}.`,
    `💲 ${c.valor}`,
  ].join('\n');

/** Texto que acompaña el PDF (el PDF ya trae fechas, temario, conferencistas, valor y pago). */
const leyendaPdf = (c) => `📄 *${c.titulo}*\nFechas, temario, conferencistas, valor y formas de pago.`;

/** Formas de pago (va con el botón "Inscribirme en línea" = página de inscripción). */
const inscripcion = (cursos, encabezado) =>
  `${encabezado}\n\n${cursos.map((c) => `${c.icono} *${c.titulo}*\n💲 ${c.valor}`).join('\n\n')}\n\n` +
  '*Formas de pago*\n' +
  '1️⃣ *Página de CETEX:* inscríbete y paga en línea tocando *Inscribirme en línea*.\n' +
  `2️⃣ *Datáfono virtual Wompi* (todas las tarjetas de crédito):\n${PAGO.wompi}\n` +
  `3️⃣ *Transferencia a ${PAGO.banco}*\n${PAGO.cuenta}\nA nombre de ${PAGO.titular}\nNIT ${PAGO.nit}`;

/** Envío del comprobante (va con el botón "Enviar comprobante"). */
const comprobante = () =>
  '📩 *Después de pagar, envía el comprobante:*\n' +
  `✉️ Al correo ${PAGO.correo}\n` +
  '📲 O por WhatsApp, tocando *Enviar comprobante*.\n\n' +
  'Envíalo con anticipación: con el pago confirmado te enviamos tu usuario y contraseña para ingresar a la capacitación.';

/** Cotización para empresas (va con el botón "Hablar con asesor"). */
const cotizacion = (cursos, encabezado) =>
  `${encabezado}\n\nValor por participante:\n${cursos.map((c) => `${c.icono} ${c.corto}: ${c.valor}`).join('\n')}\n\n` +
  'Para preparar la cotización de tu empresa, envíale al asesor:\n👥 Número de participantes\n🏢 Razón social y NIT\n📧 Correo para la factura\n\nEscríbele aquí:';

/** Enlace de respaldo (sin /r/<token>) para enviar el comprobante al WhatsApp de ventas. */
const waComprobante = () => `https://wa.me/${WA_NUMERO}?text=${encodeURIComponent('Hola, CETEX. Te envío el comprobante de pago de mi inscripción.')}`;

module.exports = { CURSOS, PAGO, WA_NUMERO, cursosDe, resumen, leyendaPdf, inscripcion, comprobante, cotizacion, waComprobante };
