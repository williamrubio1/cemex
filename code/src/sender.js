'use strict';

/**
 * Envío masivo de la plantilla de una campaña, por tandas.
 *
 *   npm run send -- --campana cierre-2026 --limite 250 --rps 5
 *
 * Opciones:
 *   --campana COD    código o id de la campaña              (def. la activa más reciente)
 *   --limite N       máximo de destinatarios en esta corrida (def. 250)
 *   --rps N          mensajes por segundo                     (def. 5)
 *   --reintentos     reenviar a quienes recibieron y no respondieron
 *   --espera-horas N horas mínimas desde el último envío (reintentos) (def. 48)
 *   --max-intentos N tope de envíos por contacto y campaña   (def. 2)
 *   --dry            no envía; solo muestra a quién enviaría
 *
 * Nunca envía a: opt-out, números sin WhatsApp, EXCLUIR_CELULARES del .env.
 * Límite de Meta: un número nuevo arranca con ~250 destinatarios únicos / 24 h
 * (sube a 1.000 y más con buena calidad y portafolio verificado). Una tanda por día.
 */

const db = require('./db');
const wa = require('./whatsapp');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function opciones(argv) {
  const a = argv.slice(2);
  const val = (nombre, def) => {
    const i = a.indexOf(nombre);
    return i !== -1 && a[i + 1] ? a[i + 1] : def;
  };
  return {
    campana: val('--campana', null),
    limite: Math.max(1, parseInt(val('--limite', '250'), 10) || 250),
    rps: Math.max(0.2, parseFloat(val('--rps', '5')) || 5),
    reintentos: a.includes('--reintentos'),
    esperaHoras: Math.max(1, parseInt(val('--espera-horas', '48'), 10) || 48),
    maxIntentos: Math.max(1, parseInt(val('--max-intentos', '2'), 10) || 2),
    dry: a.includes('--dry'),
  };
}

async function main() {
  await db.exigirConexion();
  const o = opciones(process.argv);
  const pausa = Math.round(1000 / o.rps);

  const campana = o.campana ? await db.getCampana(o.campana) : await db.campanaActiva();
  if (!campana) throw new Error(`No existe la campaña ${o.campana || '(activa)'}`);

  const excluidos = db.celularesExcluidos();
  const candidatos = o.reintentos
    ? await db.contactosParaReintento(campana.id, o.esperaHoras, o.maxIntentos, o.limite)
    : await db.contactosParaEnvio(campana.id, o.limite);
  const contactos = candidatos.filter((c) => !excluidos.has(c.celular));

  console.log(
    `${o.reintentos ? 'REINTENTO' : 'PRIMER ENVÍO'} · campaña "${campana.nombre}" (plantilla ${campana.plantilla}) · ` +
      `${contactos.length} destinatarios · ${o.rps} msg/s${o.dry ? ' · DRY (no envía)' : ''}` +
      (candidatos.length !== contactos.length ? ` · ${candidatos.length - contactos.length} excluidos` : '')
  );
  if (contactos.length === 0) return;

  const r = { ok: 0, error: 0 };
  const errores = [];

  for (let i = 0; i < contactos.length; i++) {
    const c = contactos[i];
    const etq = `${i + 1}/${contactos.length} ${c.celular} ${c.primer_nombre || c.nombre || ''}`;

    if (o.dry) {
      console.log(`  [dry] ${etq}`);
      continue;
    }

    try {
      const token = await db.tokenDeEnvio(campana.id, c.id);
      const id = await wa.enviarPlantilla(c.celular, {
        plantilla: campana.plantilla,
        idioma: campana.idioma,
        nombre: c.primer_nombre,
        urlToken: token,
      });
      await db.registrarEnvio({ campanaId: campana.id, contacto: c, waMessageId: id, token });
      r.ok++;
      console.log(`  ✓ ${etq} → ${id}`);
    } catch (err) {
      r.error++;
      errores.push(`${c.celular}: ${err.message}`);
      console.warn(`  ✗ ${etq} → ${err.message}`);
      // 131049/131048: Meta frena marketing por calidad/límite -> detener la tanda.
      // (131049 es por destinatario: no detiene la tanda.)
      if ([131048, 4, 80007].includes(err.code)) {
        console.warn('  Meta está limitando los envíos. Se detiene la tanda; reintente mañana.');
        break;
      }
    }

    if (i < contactos.length - 1) await sleep(pausa);
  }

  console.log(`\n── Resumen ──\nEnviados: ${r.ok}\nFallidos: ${r.error}`);
  if (errores.length) {
    console.log('\nErrores:');
    errores.slice(0, 40).forEach((e) => console.log('  -', e));
    if (errores.length > 40) console.log(`  ... y ${errores.length - 40} más`);
  }
}

main()
  .catch((err) => {
    console.error('Error:', err.message || err.code || err);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
