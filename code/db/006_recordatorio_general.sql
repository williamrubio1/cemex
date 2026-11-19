-- ============================================================
--  Migración 006 — el recordatorio se envía a toda la base que recibió la invitación
--  Ejecutar UNA sola vez en phpMyAdmin (pestaña SQL) sobre la base u154452028_cetex.
--  Solo cambia la campaña recordatorio-interesados-2026 (no cambia tablas):
--   - tipo 'invitacion' y sin campaña de origen -> ya no exige haber conversado con el bot
--   - mismo código (el botón de la plantilla usa /c/recordatorio-interesados-2026)
--  En /envios: "Solo quienes recibieron la campaña" = Capacitaciones CETEX noviembre y diciembre 2026.
--  La plataforma excluye sola a quienes pidieron baja y a los números sin WhatsApp.
-- ============================================================

UPDATE campanas
   SET tipo = 'invitacion', origen_campana_id = NULL,
       nombre = 'Recordatorio seminarios diciembre 2026'
 WHERE codigo = 'recordatorio-interesados-2026';

-- Comprobación
SELECT id, codigo, tipo, origen_campana_id, nombre, plantilla, idioma, variables, activa FROM campanas ORDER BY id;
