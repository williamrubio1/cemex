-- ============================================================
--  Migración 005 — campaña "Recordatorio interesados" (seminarios de diciembre)
--  Ejecutar UNA sola vez en phpMyAdmin (pestaña SQL) sobre la base de CETEX.
--  Solo inserta una campaña (no cambia tablas). Plantilla de Utilidad
--  cetex_recordatorio_interes: encabezado con imagen (public/docs/encabezados/),
--  variable {{nombre}}, botón de URL estática al WhatsApp 314 251 1033.
--  Tipo seguimiento: en /envios usa el segmento "Interesados" de capacitaciones-2026.
-- ============================================================

SET @origen := (SELECT id FROM campanas WHERE codigo = 'capacitaciones-2026');

INSERT INTO campanas (codigo, tipo, origen_campana_id, nombre, plantilla, idioma, variables,
                      seminario, fechas, horario, url_inscripcion, detalle, activa)
VALUES ('recordatorio-interesados-2026', 'seguimiento', @origen,
        'Recordatorio interesados - seminarios diciembre 2026', 'cetex_recordatorio_interes', 'es_CO', 'nombre',
        'Máster Class Régimen Sancionatorio / Taller SAGRILAFT y PTEE', 'Dic 3 / Dic 5 y 12', NULL,
        'https://wa.me/573142511033?text=Hola%2C%20recib%C3%AD%20el%20recordatorio%20de%20los%20seminarios%20de%20diciembre%20de%20CETEX%20y%20tengo%20una%20consulta.',
        NULL, 0)
ON DUPLICATE KEY UPDATE codigo = VALUES(codigo);

-- Comprobación
SELECT id, codigo, tipo, origen_campana_id, plantilla, variables, activa FROM campanas ORDER BY id;
