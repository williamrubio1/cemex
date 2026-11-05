'use strict';

/**
 * Conversación de la campaña CETEX: bienvenida, cuestionario (A–D), captura de datos
 * y clasificación del contacto. Función pura: no toca BD ni WhatsApp.
 *
 *   Plantilla (marketing) con 3 botones de respuesta rápida:
 *     Quiero participar          -> empieza el cuestionario
 *     Más información            -> detalle de las capacitaciones + [Quiero participar]
 *     No deseo recibir mensajes  -> opt-out en todas las campañas
 *
 *   Cuestionario (tabla `registros`, una fila por contacto y campaña; `paso` = pregunta pendiente):
 *     interes   A ¿Cuál capacitación te interesa?   cierre | sagrilaft | ambas | info
 *     modalidad B ¿Cómo deseas participar?          individual | empresa | varias
 *     situacion C ¿Trabajas en una empresa?          si | no | independiente
 *     momento   D ¿Cuándo inscribirte?               ahora | info | empresa
 *     nombre, correo, ciudad, empresa (si aplica), cargo   -> normalizados (src/normalizar.js)
 *     fin       mensaje final + botón al WhatsApp del asesor
 *
 *   Clasificación: caliente (D = ahora) · interesado (D = más info / opciones para empresa)
 *                  · potencial (no llegó a D). `corporativo` = empresa o varias personas.
 *
 * decidir() devuelve { acciones, respuesta, contacto, registro } que index.js ejecuta.
 */

const N = require('./normalizar');

const MARCA = process.env.CLIENTE_NOMBRE || 'CETEX';
const WEB = process.env.CLIENTE_WEB_TEXTO || 'www.cetex.com.co';
const TELEFONO = process.env.CLIENTE_TELEFONO || '314 251 1033';
const CORREO = process.env.CLIENTE_CORREO || 'capacitaciones@cetex.com.co';
const WA_ASESOR = 'https://wa.me/' + String(process.env.CLIENTE_WHATSAPP || '573142511033').replace(/\D/g, '');

// ─── Contenido de la campaña ────────────────────────────────

const OFERTA = [
  '📚 *Seminario: Cierre Contable y Fiscal con IA y sin IA*',
  '📅 23, 25 y 26 de noviembre',
  '🕔 5:00 p. m. a 9:00 p. m.',
  '',
  '🛠️ *Taller práctico: SAGRILAFT y PTEE*',
  '📅 5 y 12 de diciembre',
  '🕖 7:00 a. m. a 1:00 p. m.',
].join('\n');

const bienvenida = (primer) =>
  `¡Hola${primer ? ', ' + primer : ''}! 👋 Bienvenido(a) a ${MARCA}.\n` +
  'Nos alegra que estés interesado(a) en fortalecer tus conocimientos y actualizarte profesionalmente.\n\n' +
  `Tenemos dos excelentes opciones de formación:\n\n${OFERTA}`;

/** "Más información": el texto de la campaña (campanas.detalle) o uno genérico. */
const masInfo = (campana) =>
  campana?.detalle ||
  `${OFERTA}\n\nAl completar tu registro, un asesor de ${MARCA} te compartirá contenidos, certificación, valores y medios de pago.`;

const mensajeFinal = (primer) =>
  `¡Gracias por tu interés en ${MARCA}${primer ? ', ' + primer : ''}! 🙌\n` +
  'Hemos recibido tus datos y la información de la capacitación que te interesa.\n' +
  'Nuestro equipo comercial se pondrá en contacto contigo para brindarte información sobre valores, ' +
  'proceso de inscripción y medios de pago.\n' +
  `¡En ${MARCA} seguimos impulsando tu crecimiento profesional!\n\n` +
  `🌐 ${WEB}\n📞 ${TELEFONO}\n✉️ ${CORREO}`;

// ─── Botones globales ───────────────────────────────────────

const BTN = {
  participar: { id: 'participar', title: 'Quiero participar' },
  mas_info: { id: 'mas_info', title: 'Más información' },
  opt_out: { id: 'opt_out', title: 'No deseo mensajes' },
  asesor: 'Hablar con asesor',
};

// ─── Preguntas de opción (A–D) ──────────────────────────────

const k = (s) => N.clave(s);

const PREGUNTAS = {
  interes: {
    tipo: 'lista',
    texto: '*A.* ¿Cuál de nuestras capacitaciones te interesa?',
    boton: 'Ver opciones',
    seccion: 'Capacitaciones',
    opciones: [
      { id: 'a_cierre', valor: 'cierre', title: 'Cierre Contable y Fiscal', description: 'Con IA y sin IA · 23, 25 y 26 de noviembre' },
      { id: 'a_sagrilaft', valor: 'sagrilaft', title: 'SAGRILAFT y PTEE', description: 'Taller práctico · 5 y 12 de diciembre' },
      { id: 'a_ambas', valor: 'ambas', title: 'Me interesan ambas' },
      { id: 'a_info', valor: 'info', title: 'Más información', description: 'Deseo conocer más información' },
    ],
    escrito(t) {
      const cierre = /cierre|contab|fiscal/.test(t);
      const sagri = /sagrilaft|ptee|lavado/.test(t);
      if (/ambas|ambos|las dos|los dos|todas|todos/.test(t) || (cierre && sagri)) return 'ambas';
      if (cierre) return 'cierre';
      if (sagri) return 'sagrilaft';
      if (/info|detalle|conocer/.test(t)) return 'info';
      return null;
    },
  },
  modalidad: {
    tipo: 'botones',
    texto: '*B.* ¿Cómo deseas participar?\n\n• Inscripción individual\n• Inscripción para una empresa\n• Inscripción para varias personas',
    opciones: [
      { id: 'b_individual', valor: 'individual', title: 'Individual' },
      { id: 'b_empresa', valor: 'empresa', title: 'Para una empresa' },
      { id: 'b_varias', valor: 'varias', title: 'Varias personas' },
    ],
    escrito(t) {
      if (/varias|varios|grupo|personas|equipo|colaboradores|empleados/.test(t)) return 'varias';
      if (/individual|personal|yo solo|solo yo|para mi\b/.test(t)) return 'individual';
      if (/empresa|compania|corporativ/.test(t)) return 'empresa';
      return null;
    },
  },
  situacion: {
    tipo: 'botones',
    texto: '*C.* ¿Actualmente trabajas en una empresa?',
    opciones: [
      { id: 'c_si', valor: 'si', title: 'Sí' },
      { id: 'c_no', valor: 'no', title: 'No' },
      { id: 'c_indep', valor: 'independiente', title: 'Soy independiente' },
    ],
    escrito(t) {
      if (/independiente|freelance|por mi cuenta|negocio propio|empresa propia/.test(t)) return 'independiente';
      if (/^(si|claro|correcto|afirmativo|asi es|s)\b/.test(t)) return 'si';
      if (/^no\b|desemplead|no trabajo/.test(t)) return 'no';
      return null;
    },
  },
  momento: {
    tipo: 'lista',
    texto: '*D.* ¿Cuándo te gustaría realizar la inscripción?',
    boton: 'Ver opciones',
    seccion: 'Inscripción',
    opciones: [
      { id: 'd_ahora', valor: 'ahora', title: 'Inscribirme ahora', description: 'Deseo inscribirme ahora' },
      { id: 'd_info', valor: 'info', title: 'Necesito más info', description: 'Estoy interesado(a), pero necesito más información' },
      { id: 'd_empresa', valor: 'empresa', title: 'Opciones para empresa', description: 'Estoy consultando opciones para mi empresa' },
    ],
    escrito(t) {
      if (/empresa|compania/.test(t)) return 'empresa';
      if (/ahora|ya mismo|inscribirme|inscribir|de una|hoy/.test(t)) return 'ahora';
      if (/info|duda|pregunta|mas datos|pensar/.test(t)) return 'info';
      return null;
    },
  },
};

// ─── Datos de inscripción ───────────────────────────────────

const DATOS = {
  nombre: {
    pregunta: '¿Cuál es tu *nombre completo*?',
    confirmar: (v) => `¿Tu nombre completo es *${v}*?`,
  },
  correo: {
    pregunta: '¿Cuál es tu *correo electrónico*?',
    confirmar: (v) => `¿Tu correo electrónico es *${v}*?`,
  },
  ciudad: {
    pregunta: '¿En qué *ciudad* resides?',
    confirmar: (v) => `¿Resides en *${v}*?`,
  },
  empresa: {
    pregunta: '¿A qué *empresa* perteneces?\nSi no aplica, toca el botón.',
    confirmar: (v) => `¿Perteneces a la empresa *${v}*?`,
  },
  cargo: {
    pregunta: '¿Qué *cargo* desempeñas?',
    confirmar: (v) => `¿Tu cargo es *${v}*?`,
  },
};

const ERRORES = {
  nombre_incompleto: 'Por favor escribe tu nombre y apellido. Ejemplo: *María Fernanda Gómez*',
  nombre_largo: 'Escribe solo tu nombre y apellidos, por favor.',
  correo_invalido: 'Ese correo no parece válido 🤔. Escríbelo de nuevo, por ejemplo: *nombre@empresa.com*',
  ciudad_invalida: 'No reconocí la ciudad. Escríbela de nuevo, por ejemplo: *Bogotá*',
  empresa_invalida: 'Escribe el nombre de la empresa o toca *No aplica*.',
  cargo_invalido: 'Escribe tu cargo, por ejemplo: *Contador Público*',
};

const BTN_SI = { id: 'conf_si', title: 'Sí, es correcto' };
const BTN_NO = { id: 'conf_no', title: 'No, cambiarlo' };
const BTN_NA = { id: 'emp_na', title: 'No aplica' };

const PASOS_OPCION = ['interes', 'modalidad', 'situacion', 'momento'];

/** ¿Se le pregunta la empresa? Solo si trabaja en una o se inscribe por/para una empresa. */
const pideEmpresa = (r) => r.situacion === 'si' || r.modalidad === 'empresa' || r.modalidad === 'varias' || r.momento === 'empresa';

const pasosDatos = (r) => ['nombre', 'correo', 'ciudad', ...(pideEmpresa(r) ? ['empresa'] : []), 'cargo'];

function siguiente(paso, r) {
  const orden = [...PASOS_OPCION, ...pasosDatos(r), 'fin'];
  const i = orden.indexOf(paso);
  return i < 0 ? 'interes' : orden[i + 1];
}

/** Clasificación comercial a partir de las respuestas. */
function clasificar(r) {
  if (r.momento === 'ahora') return 'caliente';
  if (r.momento === 'info' || r.momento === 'empresa') return 'interesado';
  return 'potencial';
}
const esCorporativo = (r) => (r.modalidad === 'empresa' || r.modalidad === 'varias' || r.momento === 'empresa' ? 1 : 0);

/** Dato que ya tenemos del contacto (base de CETEX) para pedir solo confirmación. */
function datoConocido(campo, contacto) {
  if (!contacto) return null;
  if (campo === 'nombre') {
    const r = N.nombre(contacto.nombre);
    return r.ok ? r.valor : null;
  }
  if (campo === 'correo') {
    for (const parte of String(contacto.correo || '').split(/[;,\s/]+/)) {
      const r = N.correo(parte);
      if (r.ok) return r.sugerencia || r.valor;
    }
    return null;
  }
  if (campo === 'ciudad') {
    // contactos.ciudad es una región deducida ("Medellín / Antioquia"); solo sirve si es una ciudad conocida.
    return contacto.ciudad && N.esCiudadConocida(contacto.ciudad) ? contacto.ciudad : null;
  }
  if (campo === 'empresa') {
    const r = N.empresa(contacto.empresa);
    return contacto.empresa && r.ok ? r.valor : null;
  }
  return null;
}

// ─── Intenciones ────────────────────────────────────────────

const RE_BAJA =
  /\b(salir|stop|baja|darme de baja|cancelar suscripci[oó]n|no (me )?interesa|no deseo|no quiero|no (me )?(escriban|env[ií]en|contacten)|eliminar(me)?)\b/i;
// En medio del cuestionario solo cuenta un pedido de baja explícito (para no confundir "No" con la baja).
const RE_BAJA_EXPLICITA =
  /^\s*(salir|stop|parar|baja|darme de baja|cancelar|no me interesa|no (deseo|quiero) recibir( m[aá]s)? mensajes|no me escriban( m[aá]s)?)\s*[.!]*\s*$/i;
const RE_ALTA = /^\s*alta\s*$/i;
const RE_SI = /^(si|sí|correcto|es correcto|ok|okay|dale|listo|claro|exacto|asi es)$/;
const RE_NO = /^(no|no es|incorrecto|cambiar|cambiarlo|otro)$/;
const RE_NO_APLICA = /^(no aplica|n a|na|ninguna|ninguno|no tengo|no trabajo|independiente|no)$/;

/** Clasifica el botón de la plantilla por su payload o su texto. */
function botonPlantilla(entrada) {
  const t = `${entrada.payload || ''} ${entrada.titulo || ''}`;
  if (/no deseo|no recibir|no me interesa|opt_?out|baja/i.test(t)) return 'opt_out';
  if (/m[aá]s info|informaci[oó]n|mas_info/i.test(t)) return 'mas_info';
  if (/participar|inscrib/i.test(t)) return 'participar';
  return 'texto';
}

// Prioridad para no "bajar" la respuesta registrada en un envío.
const PRIORIDAD = { texto: 1, mas_info: 2, participar: 3, opt_out: 4 };
const respuestaFinal = (anterior, nueva) =>
  !anterior || (PRIORIDAD[nueva] || 0) >= (PRIORIDAD[anterior] || 0) ? nueva : anterior;

const leerPendiente = (p) => {
  if (!p) return null;
  if (typeof p === 'object') return p;
  try {
    return JSON.parse(p);
  } catch {
    return null;
  }
};

// ─── Decisión ───────────────────────────────────────────────

/**
 * @param {object} o
 * @param {object|null} o.contacto  fila de `contactos`
 * @param {object|null} o.campana   fila de `campanas`
 * @param {object|null} o.registro  fila de `registros` (null si aún no hay)
 * @param {object} o.entrada        { clase: 'boton_plantilla'|'boton'|'lista'|'texto'|'otro', titulo?, payload?, id?, texto? }
 * @param {string} o.url            enlace del botón "Hablar con asesor" (medido vía /r/<token> si hay dominio)
 */
function decidir({ contacto, campana, registro, entrada, url }) {
  const acciones = [];
  const texto = (t) => acciones.push({ tipo: 'texto', texto: t });
  const botones = (cuerpo, lista) => acciones.push({ tipo: 'botones', cuerpo, botones: lista });
  const lista = (cuerpo, boton, seccion, filas) => acciones.push({ tipo: 'lista', cuerpo, boton, seccion, filas });
  const cta = (cuerpo) => acciones.push({ tipo: 'cta_url', cuerpo, boton: BTN.asesor, url: url || WA_ASESOR });

  const r = registro ? { ...registro, pendiente: leerPendiente(registro.pendiente) } : null;
  const cambios = {};
  const actual = () => ({ ...(r || {}), ...cambios });
  const primer = () => {
    const n = actual().nombre || contacto?.primer_nombre || '';
    return n ? N.tipoTitulo(String(n).split(' ')[0]) : '';
  };

  let respuesta = null;
  const contactoCambios = {};
  const fin = () => {
    const reg = Object.keys(cambios).length ? { ...cambios } : null;
    if (reg) {
      const a = actual();
      reg.clasificacion = clasificar(a);
      reg.corporativo = esCorporativo(a);
      if (!r && !reg.paso) reg.paso = 'inicio';
    }
    return { acciones, respuesta, contacto: contactoCambios, registro: campana && contacto && reg ? reg : null };
  };

  // ── Preguntas ──
  function preguntar(paso, { proponer = true } = {}) {
    const a = actual();
    if (PREGUNTAS[paso]) {
      const p = PREGUNTAS[paso];
      if (p.tipo === 'lista') lista(p.texto, p.boton, p.seccion, p.opciones);
      else botones(p.texto, p.opciones);
      return;
    }
    const pasos = pasosDatos(a);
    const prefijo = `*Dato ${pasos.indexOf(paso) + 1} de ${pasos.length}* · `;
    const conocido = proponer ? datoConocido(paso, contacto) : null;
    if (conocido) {
      cambios.pendiente = { campo: paso, tipo: 'base', valor: conocido };
      botones(prefijo + DATOS[paso].confirmar(conocido), [BTN_SI, BTN_NO]);
    } else if (paso === 'empresa') {
      cambios.pendiente = null;
      botones(prefijo + DATOS.empresa.pregunta, [BTN_NA]);
    } else {
      cambios.pendiente = null;
      texto(prefijo + DATOS[paso].pregunta);
    }
  }

  function avanzar(desde) {
    const sig = siguiente(desde, actual());
    cambios.paso = sig;
    if (sig === 'fin') {
      cambios.pendiente = null;
      cambios.completado_en = new Date();
      contactoCambios.estado = 'interesado';
      cta(mensajeFinal(primer()));
      return;
    }
    if (sig === 'nombre') texto('¡Perfecto! Para continuar con tu proceso de inscripción, compártenos algunos datos. Solo toma un minuto. 👇');
    preguntar(sig);
  }

  // ── Intención global ──
  const enFlujo = r && r.paso !== 'inicio' && r.paso !== 'fin';
  const t = entrada.clase === 'texto' ? String(entrada.texto || '') : '';
  let intencion = null;
  if (entrada.clase === 'boton_plantilla') intencion = botonPlantilla(entrada);
  else if ((entrada.clase === 'boton' || entrada.clase === 'lista') && BTN[entrada.id]) intencion = entrada.id;
  else if (t && RE_ALTA.test(t) && contacto?.opt_out) intencion = 'alta';
  else if (t && (enFlujo ? RE_BAJA_EXPLICITA : RE_BAJA).test(t)) intencion = 'opt_out';

  // Número que no está en la base (y no se pudo registrar): se le atiende sin guardar nada.
  if (!contacto) {
    if (intencion === 'opt_out') return fin();
    if (intencion === 'mas_info') botones(masInfo(campana), [BTN.participar]);
    else cta(`${bienvenida('')}\n\nToca el botón para hablar con un asesor e inscribirte.`);
    return fin();
  }

  // Ya pidió no recibir mensajes.
  if (contacto.opt_out && intencion !== 'alta') {
    if (intencion !== 'opt_out') {
      texto(`Estás excluido(a) de los envíos de ${MARCA}. Si deseas volver a recibir información, escribe *ALTA*.`);
    }
    return fin();
  }

  if (intencion === 'alta') {
    texto(`¡Listo! Volverás a recibir información de las capacitaciones de ${MARCA}. 🙌`);
    Object.assign(contactoCambios, { opt_out: 0, opt_out_en: null, estado: 'contactado' });
    return fin();
  }

  if (intencion === 'opt_out') {
    texto(
      `Entendido. No te volveremos a enviar mensajes de ${MARCA} por este medio. ` +
        'Si cambias de opinión, escribe *ALTA*. ¡Que tengas un excelente día!'
    );
    respuesta = 'opt_out';
    Object.assign(contactoCambios, { opt_out: 1, opt_out_en: new Date(), estado: 'opt_out' });
    if (r?.pendiente) cambios.pendiente = null;
    return fin();
  }

  if (!campana) {
    texto(`Gracias por escribirnos. Un asesor de ${MARCA} te atenderá pronto.`);
    respuesta = intencion === 'participar' || intencion === 'mas_info' ? intencion : 'texto';
    return fin();
  }

  // ── Registro completo ──
  if (r && r.paso === 'fin') {
    if (intencion === 'mas_info') texto(masInfo(campana));
    cta(`Ya tenemos tus datos${primer() ? ', ' + primer() : ''} ✅. Un asesor de ${MARCA} te contactará pronto.\nSi quieres adelantar tu inscripción, escríbele directamente:`);
    return fin();
  }

  // ── Antes del cuestionario ──
  if (!r || r.paso === 'inicio') {
    if (intencion === 'participar') {
      respuesta = 'participar';
      contactoCambios.estado = 'interesado';
      cambios.paso = 'interes';
      texto('¡Excelente! 🙌 Te haré 4 preguntas rápidas y luego te pediré unos datos para tu inscripción.');
      preguntar('interes');
    } else if (intencion === 'mas_info') {
      respuesta = 'mas_info';
      contactoCambios.estado = 'interesado';
      cambios.paso = 'inicio';
      botones(masInfo(campana), [BTN.participar]);
    } else if (!r) {
      respuesta = 'texto';
      cambios.paso = 'inicio';
      botones(bienvenida(primer()), [BTN.participar, BTN.mas_info, BTN.opt_out]);
    } else {
      respuesta = 'texto';
      botones(
        `Gracias por escribirnos. Para inscribirte o resolver tus dudas sobre valores, contenidos y certificación, ` +
          `toca *Quiero participar*: te haré unas preguntas rápidas y un asesor de ${MARCA} te contactará.`,
        [BTN.participar, BTN.mas_info]
      );
    }
    return fin();
  }

  // ── En medio del cuestionario ──
  const paso = r.paso;
  if (intencion === 'participar') {
    texto('¡Sigamos con tu inscripción! 👇');
    preguntar(paso);
    return fin();
  }
  if (intencion === 'mas_info') {
    texto(masInfo(campana));
    preguntar(paso);
    return fin();
  }

  const noLegible = entrada.clase !== 'texto' && entrada.clase !== 'boton' && entrada.clase !== 'lista';
  const tk = k(t);

  // Preguntas de opción (A–D).
  if (PREGUNTAS[paso]) {
    const p = PREGUNTAS[paso];
    const porId = p.opciones.find((o) => o.id === entrada.id);
    const porNumero = /^[1-9]$/.test(tk) ? p.opciones[Number(tk) - 1] : null;
    const valor = porId?.valor || porNumero?.valor || (tk ? p.escrito(tk) : null);
    if (!valor) {
      texto(noLegible ? 'Por ahora solo puedo leer texto y botones 🙂. Elige una opción, por favor 👇' : 'Por favor elige una de las opciones 👇');
      preguntar(paso);
      return fin();
    }
    cambios[paso] = valor;
    if (paso === 'interes' && valor === 'info') texto(masInfo(campana));
    avanzar(paso);
    return fin();
  }

  // Datos de inscripción.
  if (DATOS[paso]) {
    const pend = r.pendiente && r.pendiente.campo === paso ? r.pendiente : null;
    const si = entrada.id === 'conf_si' || (t && RE_SI.test(tk));
    const no = entrada.id === 'conf_no' || (t && RE_NO.test(tk));
    const aceptar = (v) => {
      cambios[paso] = v;
      cambios.pendiente = null;
      avanzar(paso);
      return fin();
    };

    if (pend && pend.tipo === 'base') {
      if (si) return aceptar(pend.valor);
      if (no) {
        cambios.pendiente = null;
        if (paso === 'empresa') botones('Escribe el nombre de tu *empresa*:', [BTN_NA]);
        else texto(`Escribe tu ${{ nombre: '*nombre completo*', correo: '*correo electrónico*', ciudad: '*ciudad* de residencia', cargo: '*cargo*' }[paso]}:`);
        return fin();
      }
    }
    if (pend && pend.tipo === 'sugerencia') {
      if (si) return aceptar(pend.valor);
      if (no) return aceptar(pend.original);
    }
    if (paso === 'empresa' && (entrada.id === 'emp_na' || (t && RE_NO_APLICA.test(tk)))) return aceptar(null);

    if (!t.trim()) {
      texto(noLegible ? 'Por ahora solo puedo leer texto 🙂. Escribe tu respuesta, por favor.' : 'Escribe tu respuesta, por favor.');
      preguntar(paso, { proponer: !!pend });
      return fin();
    }

    const res = N[paso](t);
    if (!res.ok) {
      cambios.pendiente = null;
      if (paso === 'empresa') botones(ERRORES[res.motivo], [BTN_NA]);
      else texto(ERRORES[res.motivo] || 'No entendí tu respuesta. Escríbela de nuevo, por favor.');
      return fin();
    }
    if (res.sugerencia) {
      cambios.pendiente = { campo: paso, tipo: 'sugerencia', valor: res.sugerencia, original: res.valor };
      botones(`¿Quisiste decir *${res.sugerencia}*?`, [
        { id: 'conf_si', title: 'Sí, corregir' },
        { id: 'conf_no', title: 'No, está bien así' },
      ]);
      return fin();
    }
    return aceptar(res.valor);
  }

  // Paso desconocido (no debería pasar): reiniciar el cuestionario.
  cambios.paso = 'interes';
  preguntar('interes');
  return fin();
}

module.exports = {
  decidir,
  respuestaFinal,
  botonPlantilla,
  clasificar,
  pasosDatos,
  RE_BAJA,
  PREGUNTAS,
};
