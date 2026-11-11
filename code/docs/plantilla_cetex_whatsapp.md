# Plantillas de WhatsApp — CETEX

Se crean en **WhatsApp Manager → Plantillas de mensajes → Crear plantilla**.
Cada campaña (tabla `campanas`) indica qué plantilla envía.

## Vigente: `cetex_capacitaciones_2026` (campaña `capacitaciones-2026`)

| Campo | Valor |
|---|---|
| Categoría | **Marketing** |
| Nombre | `cetex_capacitaciones_2026` |
| Idioma | Español (Colombia) — `es_CO` |
| Variable | `{{nombre}}` = primer nombre del contacto (ejemplo para Meta: `William`) |

En el `.env` (o variables de Hostinger): `TEMPLATE_PARAM_NAME=nombre`.

### Cuerpo

```
Hola, {{nombre}}. Bienvenido a CETEX.
Nos alegra que quieras fortalecer tus conocimientos y actualizarte profesionalmente. Tenemos dos opciones de formación:

📚 *Seminario: Cierre Contable y Fiscal con IA y sin IA*
📅 23, 25 y 26 de noviembre
🕔 5:00 p. m. a 9:00 p. m.

🛠️ *Taller práctico: SAGRILAFT y PTEE*
📅 5 y 12 de diciembre
🕖 7:00 a. m. a 1:00 p. m.
```

### Pie

```
www.cetex.com.co
```

### Botones (los 3 de tipo *respuesta rápida*)

| Texto | Qué hace el bot |
|---|---|
| `Quiero participar` | valor + IVA y formas de pago (página, Wompi, transferencia) + botón *Enviar comprobante* |
| `Más información` | envía el PDF de cada capacitación + [Quiero participar] (formas de pago) [Hablar con asesor] |
| `No deseo recibir mensajes` | opt-out en todas las campañas |

Los tres llegan al webhook (a diferencia de un botón de URL), así el bot puede
seguir la conversación. El enlace al WhatsApp del asesor (314 251 1033) va en el
mensaje final, medido vía `/r/<token>` cuando hay `PUBLIC_URL`.

### Notas de Meta

- Esta cuenta solo acepta variables **con nombre** (`{{nombre}}`), no `{{1}}`.
- Una plantilla aprobada no permite cambiar el tipo de botón: para cambiarlo se
  crea una plantilla nueva. No borrar la anterior (el nombre queda bloqueado 30 días).
- La variable no puede ir al inicio ni al final del cuerpo.

## Anterior: `cetex_seminario_cierre_2026` (campaña `cierre-2026`)

Un solo seminario, botón de URL "Quiero participar" hacia `wa.me/573142511033`
y dos respuestas rápidas. Se aprobó sin variables (se escribió `{{1}}` y Meta
lo rechazó como variable), por eso para ella va `TEMPLATE_PARAM_NAME=-`.

## Seguimiento por segmento (categoría **Utilidad**)

Se envían desde `/envios` eligiendo la campaña de seguimiento correspondiente.
Variables con nombre: `{{nombre}}` (ejemplo `William`) y `{{capacitacion}}`
(ejemplo `el Seminario de Cierre Contable y Fiscal`). Sin precios ni lenguaje
promocional: los valores, los medios de pago y el PDF van en la respuesta del bot
(`src/oferta.js`), que es gratis dentro de la ventana de 24 h. No hace falta editar
estas plantillas cuando cambian valores o fechas.

### `cetex_solicitud_corporativa` (campaña `seguimiento-corporativos-2026`)

Encabezado: `Solicitud de inscripción empresarial`

```
Hola, {{nombre}}. Te escribimos de CETEX sobre la solicitud de inscripción empresarial que registraste en nuestro chat para {{capacitacion}}.

Para preparar la cotización de tu empresa necesitamos confirmar el número de participantes y los datos de facturación. Elige una opción para continuar.
```
Botones: `Recibir cotización` · `Hablar con asesor` · `No deseo recibir mensajes`

### `cetex_solicitud_inscripcion` (campaña `seguimiento-calientes-2026`)

Encabezado: `Tu solicitud de inscripción`

```
Hola, {{nombre}}. Te escribimos de CETEX sobre la solicitud de inscripción que registraste en nuestro chat para {{capacitacion}}.

Ya tenemos los valores, los medios de pago y los pasos para completar tu inscripción. Toca *Inscribirme* para recibirlos aquí mismo.
```
Botones: `Inscribirme` · `Tengo una duda` · `No deseo recibir mensajes`

### `cetex_informacion_solicitada` (campaña `seguimiento-interesados-2026`)

Encabezado: `Información que solicitaste`

```
Hola, {{nombre}}. Como lo solicitaste en nuestro chat, te compartimos la información sobre {{capacitacion}}: contenidos, certificación, valores y proceso de inscripción.

Toca *Ver información* para recibirla aquí mismo.
```
Botones: `Ver información` · `Inscribirme` · `No deseo recibir mensajes`
