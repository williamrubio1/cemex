-- ============================================================
--  Migración 003 — cuestionario del chat y datos de inscripción
--  Ejecutar UNA sola vez en phpMyAdmin (pestaña SQL) sobre la base de CETEX.
--  Es aditiva: no modifica ni borra datos existentes.
-- ============================================================

-- ---------- Registros: respuestas del cuestionario por contacto y campaña ----------
-- Los datos que escribe el contacto se guardan aquí, normalizados, sin pisar los de `contactos`.
CREATE TABLE IF NOT EXISTS registros (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contacto_id    BIGINT UNSIGNED NOT NULL,
  campana_id     INT UNSIGNED    NOT NULL,
  -- pregunta pendiente: inicio | interes | modalidad | situacion | momento
  --                     | nombre | correo | ciudad | empresa | cargo | fin
  paso           VARCHAR(20)  NOT NULL DEFAULT 'inicio',
  interes        VARCHAR(20)  NULL,      -- A: cierre | sagrilaft | ambas | info
  modalidad      VARCHAR(20)  NULL,      -- B: individual | empresa | varias
  situacion      VARCHAR(20)  NULL,      -- C: si | no | independiente
  momento        VARCHAR(20)  NULL,      -- D: ahora | info | empresa
  nombre         VARCHAR(160) NULL,
  correo         VARCHAR(255) NULL,
  ciudad         VARCHAR(80)  NULL,
  empresa        VARCHAR(200) NULL,
  cargo          VARCHAR(120) NULL,
  pendiente      JSON         NULL,      -- dato propuesto que espera confirmación (Sí / No)
  -- caliente | interesado | potencial
  clasificacion  VARCHAR(20)  NOT NULL DEFAULT 'potencial',
  corporativo    TINYINT(1)   NOT NULL DEFAULT 0,   -- 1 = inscripción por empresa o de varias personas
  iniciado_en    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completado_en  DATETIME     NULL,
  actualizado_en DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_registros_contacto_campana (contacto_id, campana_id),
  KEY idx_registros_campana_clasif (campana_id, clasificacion),
  KEY idx_registros_paso (paso),
  CONSTRAINT fk_registros_contacto FOREIGN KEY (contacto_id) REFERENCES contactos (id),
  CONSTRAINT fk_registros_campana  FOREIGN KEY (campana_id)  REFERENCES campanas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Campaña nueva: plantilla cetex_capacitaciones_2026 (dos capacitaciones) ----------
-- Queda como la campaña activa más reciente (atiende a quien escriba sin haber recibido plantilla).
INSERT INTO campanas (codigo, nombre, plantilla, idioma, seminario, fechas, horario, url_inscripcion, detalle)
VALUES (
  'capacitaciones-2026',
  'Capacitaciones CETEX noviembre y diciembre 2026',
  'cetex_capacitaciones_2026',
  'es_CO',
  'Cierre Contable y Fiscal con IA y sin IA / Taller SAGRILAFT y PTEE',
  'Nov 23, 25 y 26 / Dic 5 y 12',
  NULL,
  'https://wa.me/573142511033?text=Hola%2C%20quiero%20inscribirme%20en%20las%20capacitaciones%20de%20CETEX',
  NULL
)
ON DUPLICATE KEY UPDATE codigo = codigo;
