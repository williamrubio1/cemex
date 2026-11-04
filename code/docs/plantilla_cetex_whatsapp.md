# Plantilla de WhatsApp — Invitación a seminario CETEX

Borrador para crear en **WhatsApp Manager → Plantillas de mensajes → Crear plantilla**.

| Campo | Valor |
|---|---|
| Categoría | **Marketing** (promociona un seminario pago) |
| Nombre | `cetex_seminario_cierre_2026` (minúsculas, sin espacios) |
| Idioma | Español (Colombia) — `es_CO` |
| Variables | `{{1}}` = primer nombre del contacto |

## Encabezado (texto, opcional)

```
Taller: Cierre contable y fiscal 2026
```

## Cuerpo

```
Hola {{1}}, le saluda CETEX.

Queremos invitarle a nuestro seminario:

*TALLER CIERRE CONTABLE Y FISCAL CON IA Y SIN IA*
*Bajo NIIF para Pymes 2026 – Decreto 701*

📅 Noviembre 23, 25 y 26
🕔 Horario: 5:00 p. m. a 9:00 p. m.

Estamos interesados en su participación. Toque el botón para inscribirse o recibir más información.
```

Ejemplo de `{{1}}` para la revisión de Meta: `William`.

## Pie

```
CETEX · cetex.com.co
```

## Botones

| Tipo | Texto | Acción |
|                 ---                |---|---|
| Visitar sitio web (URL estática)   | `✅ Quiero participar` | `https://wa.me/573142511033?text=Quiero%20participar%20en%20el%20Taller%20de%20Cierre%20Contable%20y%20Fiscal%202026` |
| Respuesta rápida | `Más información` | la recibe el webhook |
| Respuesta rápida | `No deseo recibir mensajes` | la recibe el webhook → marca opt-out |

## Notas

- Se usa el enlace **directo** `wa.me/573142511033` en vez de `https://wa.link/6vwrnd`:
  ese acortador redirige al mismo número de CETEX, pero Meta suele rechazar
  plantillas con acortadores porque ocultan el destino.
- El botón de URL **no** avisa al webhook cuando se toca. Para medir los clics,
  cuando el dominio esté desplegado, crear la plantilla con URL **dinámica**
  `https://<dominio>/r/{{1}}` (ejemplo para Meta: `https://<dominio>/r/abc123`)
  y poner en el `.env` `PUBLIC_URL=https://<dominio>` y
  `TEMPLATE_URL_BOTON_INDEX=` el índice de ese botón (0 si es el primero).
  La plataforma registra el clic y redirige al `url_inscripcion` de la campaña.
- El botón **No deseo recibir mensajes** es obligatorio en la práctica para
  marketing: reduce bloqueos/reportes, que bajan la calidad del número.
- Meta no permite que el cuerpo empiece ni termine con una variable.
