# Campañas de WhatsApp — CETEX

Plataforma para enviar invitaciones a seminarios de **CETEX** por WhatsApp,
registrar cada respuesta y ver estadísticas en vivo. La opera **Soluctia S.A.S.**
por cuenta de CETEX; los activos de Meta (app *Notifica Cetex*, cuenta de
WhatsApp Business y número) están en el portafolio de CETEX.

## Stack

- **Node.js 18+** + **Express** (servidor y webhook)
- **MySQL** (Hostinger, base propia de CETEX) vía `mysql2`
- **WhatsApp Cloud API** (directo a Meta)
- Paneles con **Apache ECharts** (CDN, render SVG) — `public/graficas.js`

## Estructura

```
src/
  index.js         # Express: webhook, /r/:token, paneles y APIs
  conversacion.js  # qué responder a cada botón / texto (función pura)
  whatsapp.js      # plantilla, texto, botones, botón con enlace (cta_url)
  db.js            # MySQL: contactos, campañas, envíos, log
  telefonos.js     # normalización/extracción de celulares
  filtros.js       # filtros comunes de /respuestas y /analisis
  stats.js         # agregados del panel público
  analisis.js      # agregados del panel interno
  respuestas.js    # listado + Excel
  sender.js        # envío masivo por tandas
  import.js        # importa el Excel de contactos (varias hojas)
  simular.js       # simula la conversación sin BD ni WhatsApp
public/            # index.html (público), respuestas.html y analisis.html (con login)
db/schema.sql      # tablas (aditivo e idempotente) + primera campaña
docs/plantilla_cetex_whatsapp.md
```

## Base de datos

| Tabla | Contenido |
|---|---|
| `contactos` | celular (único), nombre, primer nombre, empresa, correo, hoja de origen, seminarios previos, estado, opt-out |
| `campanas` | una por seminario: plantilla, fechas, horario, enlace de inscripción |
| `envios` | contacto × campaña: enviado / entregado / leído / fallido, respuesta, clic |
| `mensajes` | log de todo lo que entra y sale |
| `eventos_procesados` | idempotencia del webhook |
| `usuarios` | login de las vistas internas |

`db.js` y `migrate.js` se niegan a correr si `DB_NAME` es la base de LegalMedica
(este proyecto nació como copia de ese censo).

## Puesta en marcha

```bash
npm install
cp .env.example .env            # completar con la base NUEVA y las llaves de CETEX
npm run db:init                 # crea tablas + campaña "cierre-2026"
npm run import -- ../datos/Base_Bogota_organizada.xlsx --dry   # resumen, no escribe
npm run import -- ../datos/Base_Bogota_organizada.xlsx --sql   # importaciones/contactos.sql para phpMyAdmin
npm run import -- ../datos/Base_Bogota_organizada.xlsx         # o directo a la base
npm run crear-usuario -- <usuario> <contraseña>
npm run dev
```

Importación: solo celulares (3XX…), un contacto por celular, se unen hojas y
seminarios. Con la base actual quedan **≈ 6.225 contactos**. `EXCLUIR_CELULARES`
saca números que nunca se contactan (la línea de ventas 314 251 1033).

## Conversación

Plantilla de marketing (ver `docs/plantilla_cetex_whatsapp.md`) con 3 botones:

| Botón | Qué pasa |
|---|---|
| ✅ Quiero participar | abre el WhatsApp de ventas de CETEX. Con `PUBLIC_URL` y URL dinámica pasa por `/r/<token>` y se mide el clic |
| Más información | el bot envía el detalle del seminario + botón *Quiero participar* |
| No deseo recibir mensajes | opt-out: excluido de todas las campañas (escribiendo **ALTA** se reactiva) |

Texto libre → agradecimiento + botón; si pide la baja ("no me interesa", "salir"…) → opt-out.
`npm run simular` muestra todos los casos.

## Envío masivo

```bash
npm run send -- --dry                                  # a quién se enviaría
npm run send -- --campana cierre-2026 --limite 250     # una tanda por día
npm run send -- --reintentos --espera-horas 48         # quienes no respondieron
```

Un número nuevo arranca con ~250 destinatarios únicos / 24 h; Meta lo sube
según la calidad. Si Meta limita (códigos 131048/131049) la tanda se detiene sola.

## Paneles

- `GET /` — panel público (sin datos personales): embudo, respuestas, actividad
  diaria, mapa de calor día × hora, respuestas hora a hora con marcas de tandas,
  entrega y resultado por base. Cada gráfica se descarga como PNG.
- `GET /respuestas` — tabla con filtros (campaña, respuesta, entrega, estado,
  base, seminario previo, búsqueda, fechas) y descarga en Excel.
- `GET /analisis` — informe con lectura rápida, filtros cruzados (clic en las
  gráficas), público que mejor responde por seminario previo, empresas
  interesadas y errores de entrega. Botón Imprimir / PDF.

## Webhook en Meta

URL `https://<dominio>/webhook`, token = `VERIFY_TOKEN`, suscribir el campo
**messages**. Con `APP_SECRET` se valida la firma de cada evento.
