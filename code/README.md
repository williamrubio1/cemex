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
  conversacion.js  # bienvenida, cuestionario A–D, captura de datos y clasificación (función pura)
  normalizar.js    # limpia y valida nombre, correo, ciudad, empresa y cargo
  oferta.js        # capacitaciones (fechas, temario, valor + IVA), medios de pago y sus textos
  variables.js     # valores de las variables de cada plantilla y enlaces personalizados al asesor
  whatsapp.js      # plantilla, texto, botones, botón con enlace (cta_url), documento (PDF)
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
public/docs/       # brochures en PDF que el bot envía por WhatsApp (servidos en /docs)
db/schema.sql      # tablas (aditivo e idempotente) + campañas
db/00X_*.sql       # migraciones para una base ya creada (correr una vez en phpMyAdmin)
docs/plantilla_cetex_whatsapp.md
```

## Base de datos

| Tabla | Contenido |
|---|---|
| `contactos` | celular (único), nombre, primer nombre, empresa, correo, hoja de origen, seminarios previos, estado, opt-out |
| `campanas` | una por seminario: plantilla, fechas, horario, enlace de inscripción |
| `envios` | contacto × campaña: enviado / entregado / leído / fallido, respuesta, clic |
| `registros` | contacto × campaña: respuestas del cuestionario, datos normalizados, clasificación |
| `campanas.tipo` | `invitacion` (plantilla + cuestionario) o `seguimiento` (plantilla de Utilidad a un segmento de `origen_campana_id`) |
| `lotes`, `lote_contactos` | envíos masivos lanzados desde `/envios` |
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

Plantilla `cetex_capacitaciones_2026` (ver `docs/plantilla_cetex_whatsapp.md`) con 3
respuestas rápidas: *Quiero participar* · *Más información* · *No deseo recibir mensajes*.

```
Quiero participar  → valor + IVA y formas de pago [Inscribirme en línea] + comprobante [Enviar comprobante]
Más información    → PDF de cada capacitación → [Quiero participar] (lo mismo de arriba) [Hablar con asesor]
No deseo recibir…  → baja
```

La plantilla va a personas interesadas: desde nov. 2026 *Quiero participar* lleva directo
al pago y **el cuestionario ya no se inicia**. Se conserva para los registros que lo
empezaron antes (pueden terminarlo; si tocan *Quiero participar* salen al pago y se guarda
lo que respondieron) y como base de la segmentación de los seguimientos:

```
A ¿Cuál capacitación te interesa?  (lista)    Cierre Contable · SAGRILAFT y PTEE · Ambas · Más información
B ¿Cómo deseas participar?          (botones)  Individual · Para una empresa · Varias personas
C ¿Trabajas en una empresa?         (botones)  Sí · No · Soy independiente
D ¿Cuándo inscribirte?              (lista)    Inscribirme ahora · Necesito más info · Opciones para empresa
Datos: nombre · correo · ciudad · empresa (si trabaja en una o se inscribe por empresa) · cargo
→ individual:  formas de pago + comprobante (si en D pidió más información, antes el PDF)
→ corporativo: valor por participante + datos para la cotización [Hablar con asesor]
```

- Cada respuesta se guarda al momento en `registros` (`paso` = pregunta pendiente):
  si la persona deja de responder, queda lo que alcanzó a contestar.
- Si la base ya trae el dato (nombre, correo, empresa, ciudad conocida), solo se
  pide confirmarlo con [Sí, es correcto] [No, cambiarlo].
- Normalización (`normalizar.js`): nombre en tipo título sin símbolos (mín. nombre
  y apellido); correo en minúsculas y validado, con sugerencia para dominios mal
  escritos (gmial.com → gmail.com); ciudad contra catálogo de municipios
  ("bogota dc" → Bogotá); cargo con abreviaturas y tildes ("aux contable" →
  Auxiliar Contable).
- Respuestas escritas también sirven ("las dos", "individual", "1"…); si no se
  entiende, se repite la pregunta.
- **Clasificación**: 🔥 caliente (D = inscribirme ahora) · 🟡 interesado (D = más
  info u opciones para empresa) · 🔵 potencial (no llegó a D). **Corporativo** si
  se inscribe por una empresa o para varias personas.
- Baja en cualquier momento ("salir", "no deseo recibir mensajes"); **ALTA** reactiva.
- Quien escribe sin estar en la base se crea como contacto `ENTRANTE` (con su
  nombre de perfil de WhatsApp) y recibe la bienvenida con los 3 botones.
- *Más información* envía solo el PDF de cada capacitación (ya trae fechas, temario,
  conferencistas, valor y pago) y después [Quiero participar] [Hablar con asesor].
- Los PDF (`public/docs/`) se suben a Meta una vez y se reutiliza su id (Meta lo guarda
  30 días; se vuelve a subir a los 20). El bot espera el acuse de entrega de cada PDF
  antes del mensaje siguiente (máx. `ESPERA_DOCUMENTO_MS`, 20 s), para que no lleguen
  en desorden. Si la subida falla, se envía por enlace (`/docs`, con `PUBLIC_URL`) y,
  si también falla, la ficha en texto.

`npm run simular` recorre los casos y verifica el resultado.

### Valores y medios de pago (`src/oferta.js`)

| Capacitación | Fechas | Valor |
|---|---|---|
| Seminario Cierre Contable y Fiscal con IA y sin IA | 23, 25 y 26 nov · 5–9 p. m. · virtual · 12 h | $190.000 + IVA |
| Taller práctico SAGRILAFT y PTEE | 5 y 12 dic (sábados) · 7 a. m.–1 p. m. · virtual · 12 h | $340.000 + IVA |

- El valor se muestra siempre "+ IVA" (CETEX no muestra el total). Sin descuentos por grupo.
- Formas de pago: 1) página de CETEX cetex.com.co/inscripcion (botón *Inscribirme en
  línea*), 2) datáfono virtual Wompi checkout.wompi.co/l/VPOS_kvde1L, 3) transferencia a
  Bancolombia, cuenta de ahorros 58999443557, Cetex Asesores S.A.S., NIT 900.626.419-4.
- Comprobante: a capacitaciones@cetex.com.co o por WhatsApp al 314 251 1033. Con el
  pago confirmado, CETEX envía usuario y contraseña.
- Para una nueva edición: actualizar `src/oferta.js` y los PDF de `public/docs/`.
  `campanas.detalle` ya no se usa.
- Enlaces medidos (registran el clic en el envío): `/r/<token>` → asesor,
  `/r/<token>?a=web` → página de inscripción, `/r/<token>?a=comprobante` → WhatsApp de
  ventas con "Soy …, te envío el comprobante de pago de …".

## Seguimiento por segmento

Campañas `tipo = 'seguimiento'` (migración `db/004_seguimiento.sql`): cada una envía una
plantilla de **Utilidad** a quienes ya conversaron con el bot en la campaña de origen.

| Campaña | Plantilla | Segmento sugerido en `/envios` |
|---|---|---|
| `seguimiento-corporativos-2026` | `cetex_solicitud_corporativa` | Corporativos: solo corporativos |
| `seguimiento-calientes-2026` | `cetex_solicitud_inscripcion` | 🔥 Calientes, sin corporativos |
| `seguimiento-interesados-2026` | `cetex_informacion_solicitada` | 🟡 Interesados, sin corporativos |

- En `/envios`, al elegir una campaña de seguimiento aparecen los filtros de
  **clasificación**, **corporativos** y **avance** (A, D, completo, sin terminar).
- Variables por campaña (`campanas.variables`, ej. `nombre,capacitacion`):
  `{{capacitacion}}` se llena con lo que eligió cada persona en la pregunta A.
- Las respuestas usan la capacitación que la persona eligió en la campaña de origen:
  - *Inscribirme* → valor + medios de pago [Inscribirme en línea] y [Enviar comprobante].
  - *Recibir cotización* → valor por participante + datos para la cotización [Hablar con asesor].
  - *Ver información* → PDF de su capacitación + [Inscribirme] [Tengo una duda].
  - *Hablar con asesor* / *Tengo una duda* → [Hablar con asesor].
- El enlace al asesor (`/r/<token>`) mide el clic y abre el WhatsApp de ventas con un
  mensaje que ya dice el nombre, la empresa y la capacitación de la persona.
- Los envíos y respuestas de cada seguimiento se ven aparte en Respuestas y Análisis
  (con la clasificación de origen); el registro del cuestionario no se modifica.

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
- `GET /respuestas` — tabla con filtros (campaña, clasificación del cuestionario,
  respuesta, entrega, estado, base, seminario previo, búsqueda, fechas) y descarga
  en Excel con las respuestas A–D y los datos del registro.
- `GET /analisis` — informe con lectura rápida, filtros cruzados (clic en las
  gráficas), avance del cuestionario, clasificación, capacitación de interés,
  cargos, público que mejor responde por seminario previo, empresas interesadas
  y errores de entrega. Botón Imprimir / PDF.
- `GET /envios` — pruebas y envío por lotes.

## Webhook en Meta

URL `https://<dominio>/webhook`, token = `VERIFY_TOKEN`, suscribir el campo
**messages**. Con `APP_SECRET` se valida la firma de cada evento.
