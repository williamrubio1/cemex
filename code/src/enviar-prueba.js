'use strict';

/**
 * Prueba de envío por WhatsApp a un número propio (no registra envíos de campaña).
 *
 *   node src/enviar-prueba.js <celular> [modo] [nombre|texto]
 *
 *   modo = plantilla (default) | texto | enlace
 *
 * Ejemplos:
 *   npm run enviar-prueba -- +573001234567 plantilla "William"
 *   npm run enviar-prueba -- +573001234567 texto "Hola, esto es una prueba"
 *   npm run enviar-prueba -- +573001234567 enlace
 *
 * La plantilla sale de la campaña activa (tabla `campanas`) o, si no hay base
 * de datos, de TEMPLATE_NAME / TEMPLATE_LANG del .env.
 */

require('dotenv').config();
const wa = require('./whatsapp');
const db = require('./db');

async function main() {
  const [celular, modo = 'plantilla', extra] = process.argv.slice(2);
  if (!celular) {
    console.error('Falta el celular. Uso: node src/enviar-prueba.js <celular> [plantilla|texto|enlace] [texto]');
    process.exit(1);
  }

  const campana = await db.campanaActiva().catch(() => null);
  let id;
  if (modo === 'plantilla') {
    id = await wa.enviarPlantilla(celular, {
      plantilla: campana?.plantilla || process.env.TEMPLATE_NAME,
      idioma: campana?.idioma || process.env.TEMPLATE_LANG,
      nombre: extra || 'Prueba',
      urlToken: 'prueba',
    });
  } else if (modo === 'texto') {
    id = await wa.enviarTexto(celular, extra || 'Mensaje de prueba de la plataforma CETEX ✅');
  } else if (modo === 'enlace') {
    id = await wa.enviarCtaUrl(
      celular,
      '¿Recibió este mensaje con botón de enlace?',
      '✅ Quiero participar',
      campana?.url_inscripcion || 'https://cetex.com.co'
    );
  } else {
    console.error(`Modo desconocido: ${modo}`);
    process.exit(1);
  }

  console.log(`Enviado (${modo}). wa_message_id = ${id}`);
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
