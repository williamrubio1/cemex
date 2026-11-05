-- ============================================================
--  Migración 002 — ciudad del contacto + envíos masivos por lotes
--  Ejecutar UNA sola vez en phpMyAdmin (pestaña SQL) sobre la base de CETEX.
--  Después, importar importaciones/ciudades.sql para llenar la ciudad.
-- ============================================================

-- ---------- Ciudad del contacto (deducida de la hoja y del indicativo del fijo) ----------
ALTER TABLE contactos
  ADD COLUMN ciudad VARCHAR(60) NULL AFTER empresa,
  ADD KEY idx_contactos_ciudad (ciudad);

-- ---------- Lotes: cada envío masivo lanzado desde /envios ----------
CREATE TABLE IF NOT EXISTS lotes (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  campana_id     INT UNSIGNED NOT NULL,
  nombre         VARCHAR(200) NULL,
  filtros        JSON         NULL,                  -- filtros con los que se armó el lote
  total          INT          NOT NULL DEFAULT 0,    -- contactos seleccionados
  enviados       INT          NOT NULL DEFAULT 0,    -- aceptados por Meta
  fallidos       INT          NOT NULL DEFAULT 0,    -- rechazados por Meta al enviar
  omitidos       INT          NOT NULL DEFAULT 0,    -- se dieron de baja / ya recibieron antes de su turno
  -- en_curso | esperando_cupo | pausado | completado | cancelado
  estado         VARCHAR(20)  NOT NULL DEFAULT 'en_curso',
  motivo         VARCHAR(255) NULL,                  -- por qué está pausado / esperando
  tope_diario    INT          NULL,                  -- máx. destinatarios únicos por 24 h (límite de Meta)
  mps            DECIMAL(4,1) NOT NULL DEFAULT 5.0,  -- mensajes por segundo
  creado_por     VARCHAR(60)  NULL,
  creado_en      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalizado_en  DATETIME     NULL,
  worker         VARCHAR(80)  NULL,                  -- proceso que lo está enviando (evita envíos dobles)
  lease_hasta    DATETIME     NULL,                  -- el proceso debe renovar antes de esta hora
  PRIMARY KEY (id),
  KEY idx_lotes_estado (estado),
  CONSTRAINT fk_lotes_campana FOREIGN KEY (campana_id) REFERENCES campanas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Contactos de cada lote (lista fija; permite continuar tras un reinicio) ----------
CREATE TABLE IF NOT EXISTS lote_contactos (
  lote_id       INT UNSIGNED    NOT NULL,
  contacto_id   BIGINT UNSIGNED NOT NULL,
  orden         INT             NOT NULL,
  -- pendiente | enviando | enviado | fallido | omitido
  estado        VARCHAR(12)     NOT NULL DEFAULT 'pendiente',
  error_texto   VARCHAR(255)    NULL,
  procesado_en  DATETIME        NULL,
  PRIMARY KEY (lote_id, contacto_id),
  KEY idx_lc_pendientes (lote_id, estado, orden),
  KEY idx_lc_contacto (contacto_id),
  CONSTRAINT fk_lc_lote     FOREIGN KEY (lote_id)     REFERENCES lotes (id),
  CONSTRAINT fk_lc_contacto FOREIGN KEY (contacto_id) REFERENCES contactos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
