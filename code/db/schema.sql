-- ============================================================
--  Campañas de WhatsApp CETEX — Esquema de base de datos
--  MySQL 8 / MariaDB 10.5+  ·  InnoDB  ·  utf8mb4
--  Base nueva en Hostinger (no comparte datos con otros proyectos).
--  Los DATETIME se guardan en UTC (la aplicación convierte).
--  Ejecutar en hPanel -> phpMyAdmin (pestaña SQL) o con `npm run db:init`.
--
--  Es ADITIVO e idempotente: usa CREATE TABLE IF NOT EXISTS, no borra nada.
-- ============================================================

-- ---------- Contactos (importados del Excel de CETEX) ----------
CREATE TABLE IF NOT EXISTS contactos (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  celular             VARCHAR(20)  NOT NULL,                 -- E.164: +573XXXXXXXXX
  nombre              VARCHAR(160) NULL,                     -- nombre completo tal como viene
  primer_nombre       VARCHAR(60)  NULL,                     -- para el saludo de la plantilla
  empresa             VARCHAR(200) NULL,
  correo              VARCHAR(255) NULL,
  hoja_origen         VARCHAR(255) NULL,                     -- hoja(s) del Excel, separadas por "; "
  seminarios_previos  TEXT         NULL,                     -- seminarios a los que asistió, "; "
  -- no_contactado | contactado | interesado | opt_out | sin_whatsapp
  estado              VARCHAR(30)  NOT NULL DEFAULT 'no_contactado',
  opt_out             TINYINT(1)   NOT NULL DEFAULT 0,       -- 1 = no desea recibir mensajes (todas las campañas)
  opt_out_en          DATETIME     NULL,
  ultima_interaccion  DATETIME     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contactos_celular (celular),
  KEY idx_contactos_estado (estado),
  KEY idx_contactos_optout (opt_out)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Campañas (una por seminario / plantilla) ----------
CREATE TABLE IF NOT EXISTS campanas (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo           VARCHAR(60)  NOT NULL,                    -- ej. cierre-2026
  nombre           VARCHAR(200) NOT NULL,
  plantilla        VARCHAR(120) NOT NULL,                    -- nombre de la plantilla aprobada en Meta
  idioma           VARCHAR(10)  NOT NULL DEFAULT 'es_CO',
  seminario        VARCHAR(255) NULL,
  fechas           VARCHAR(120) NULL,
  horario          VARCHAR(60)  NULL,
  url_inscripcion  VARCHAR(500) NOT NULL,                    -- a dónde lleva "Quiero participar"
  detalle          TEXT         NULL,                        -- texto de "Más información"
  activa           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campanas_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Envíos: un registro por contacto y campaña ----------
CREATE TABLE IF NOT EXISTS envios (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campana_id     INT UNSIGNED    NOT NULL,
  contacto_id    BIGINT UNSIGNED NOT NULL,
  celular        VARCHAR(20)     NOT NULL,
  token          VARCHAR(16)     NOT NULL,                   -- para el enlace /r/<token> (medir clics)
  wa_message_id  VARCHAR(128)    NULL,                       -- id de la plantilla enviada
  -- enviado | entregado | leido | fallido
  estado_envio   VARCHAR(20)     NOT NULL DEFAULT 'enviado',
  intentos       INT             NOT NULL DEFAULT 1,
  enviado_en     DATETIME        NULL,
  entregado_en   DATETIME        NULL,
  leido_en       DATETIME        NULL,
  fallido_en     DATETIME        NULL,
  error_code     INT             NULL,
  error_texto    VARCHAR(255)    NULL,
  -- participar | mas_info | opt_out | texto   (último botón tocado / tipo de respuesta)
  respuesta      VARCHAR(20)     NULL,
  respondido_en  DATETIME        NULL,                       -- primera respuesta
  clic_en        DATETIME        NULL,                       -- primer clic en "Quiero participar" (vía /r/)
  PRIMARY KEY (id),
  UNIQUE KEY uq_envios_campana_contacto (campana_id, contacto_id),
  UNIQUE KEY uq_envios_token (token),
  KEY idx_envios_waid (wa_message_id),
  KEY idx_envios_celular (celular),
  KEY idx_envios_respuesta (respuesta),
  CONSTRAINT fk_envios_campana  FOREIGN KEY (campana_id)  REFERENCES campanas (id),
  CONSTRAINT fk_envios_contacto FOREIGN KEY (contacto_id) REFERENCES contactos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Mensajes (log / auditoría de todo lo que entra y sale) ----------
CREATE TABLE IF NOT EXISTS mensajes (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  celular        VARCHAR(20)  NULL,
  direccion      ENUM('in','out') NOT NULL,
  tipo           VARCHAR(20)  NOT NULL,        -- template | text | interactive | button | status
  contenido      JSON         NULL,
  wa_message_id  VARCHAR(128) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mensajes_celular (celular),
  KEY idx_mensajes_waid    (wa_message_id),
  KEY idx_mensajes_dir_fecha (direccion, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Idempotencia: no procesar dos veces el mismo evento entrante ----------
CREATE TABLE IF NOT EXISTS eventos_procesados (
  wa_message_id  VARCHAR(128) NOT NULL,
  procesado_en   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (wa_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Usuarios de la vista interna (login) ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario    VARCHAR(60)  NOT NULL,
  hash       VARCHAR(255) NOT NULL,
  creado_en  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_usuario (usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Primera campaña ----------
INSERT INTO campanas (codigo, nombre, plantilla, idioma, seminario, fechas, horario, url_inscripcion, detalle)
VALUES (
  'cierre-2026',
  'Taller Cierre contable y fiscal 2026',
  'cetex_seminario_cierre_2026',
  'es_CO',
  'Taller Cierre contable y fiscal con IA y sin IA bajo NIIF para Pymes 2026 – Decreto 701',
  'Noviembre 23, 25 y 26',
  '5:00 p. m. a 9:00 p. m.',
  'https://wa.me/573142511033?text=Quiero%20participar%20en%20el%20Taller%20de%20Cierre%20Contable%20y%20Fiscal%202026',
  NULL
)
ON DUPLICATE KEY UPDATE codigo = codigo;
