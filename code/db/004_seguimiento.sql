-- ============================================================
--  Migración 004 — campañas de seguimiento por segmento
--  Ejecutar UNA sola vez en phpMyAdmin (pestaña SQL) sobre la base de CETEX.
--  Es aditiva: agrega columnas a `campanas` e inserta 3 campañas nuevas.
--  No modifica ni borra datos existentes.
-- ============================================================

-- ---------- Tipo de campaña, campaña de origen y variables de la plantilla ----------
--  tipo               invitacion  -> plantilla de invitación + cuestionario del chat
--                     seguimiento -> plantilla de Utilidad a un segmento de la campaña de origen
--  origen_campana_id  campaña cuyos registros (clasificación, respuestas) se siguen
--  variables          variables de la plantilla en orden, ej. "nombre,capacitacion"
--                     (NULL = usa TEMPLATE_PARAM_NAME del entorno; "-" = sin variables)
ALTER TABLE campanas
  ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'invitacion' AFTER codigo,
  ADD COLUMN origen_campana_id INT UNSIGNED NULL AFTER tipo,
  ADD COLUMN variables VARCHAR(255) NULL AFTER idioma;

-- ---------- Campañas de seguimiento de "capacitaciones-2026" ----------
-- activa = 0: no atienden a quien escribe sin haber recibido una plantilla
-- (eso lo sigue haciendo la campaña de invitación activa).
SET @origen := (SELECT id FROM campanas WHERE codigo = 'capacitaciones-2026');

INSERT INTO campanas (codigo, tipo, origen_campana_id, nombre, plantilla, idioma, variables,
                      seminario, fechas, horario, url_inscripcion, detalle, activa)
VALUES ('seguimiento-corporativos-2026', 'seguimiento', @origen,
        'Seguimiento corporativos - capacitaciones 2026', 'cetex_solicitud_corporativa', 'es_CO', 'nombre,capacitacion',
        'Cierre Contable y Fiscal con IA y sin IA / Taller SAGRILAFT y PTEE', 'Nov 23, 25 y 26 / Dic 5 y 12', NULL,
        'https://wa.me/573142511033?text=Hola%2C%20quiero%20una%20cotizaci%C3%B3n%20empresarial%20para%20las%20capacitaciones%20de%20CETEX',
        NULL, 0),
       ('seguimiento-calientes-2026', 'seguimiento', @origen,
        'Seguimiento calientes - capacitaciones 2026', 'cetex_solicitud_inscripcion', 'es_CO', 'nombre,capacitacion',
        'Cierre Contable y Fiscal con IA y sin IA / Taller SAGRILAFT y PTEE', 'Nov 23, 25 y 26 / Dic 5 y 12', NULL,
        'https://wa.me/573142511033?text=Hola%2C%20quiero%20completar%20mi%20inscripci%C3%B3n%20a%20las%20capacitaciones%20de%20CETEX',
        NULL, 0),
       ('seguimiento-interesados-2026', 'seguimiento', @origen,
        'Seguimiento interesados - capacitaciones 2026', 'cetex_informacion_solicitada', 'es_CO', 'nombre,capacitacion',
        'Cierre Contable y Fiscal con IA y sin IA / Taller SAGRILAFT y PTEE', 'Nov 23, 25 y 26 / Dic 5 y 12', NULL,
        'https://wa.me/573142511033?text=Hola%2C%20quiero%20informaci%C3%B3n%20para%20inscribirme%20en%20las%20capacitaciones%20de%20CETEX',
        NULL, 0)
ON DUPLICATE KEY UPDATE codigo = VALUES(codigo);

-- Comprobación
SELECT id, codigo, tipo, origen_campana_id, plantilla, variables, activa FROM campanas ORDER BY id;
