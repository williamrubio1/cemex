'use strict';

/**
 * Crea (o actualiza) un usuario para la vista interna /respuestas.
 *
 *   node src/crear-usuario.js <usuario> <contraseña> [--sql]
 *   npm run crear-usuario -- ana "Contrase.Larga.2026"
 *
 * --sql : no conecta a la base; imprime el INSERT para pegar en phpMyAdmin.
 */

const db = require('./db');
const { hashPassword } = require('./auth');

const CREA_TABLA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario VARCHAR(60) NOT NULL,
  hash VARCHAR(255) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_usuarios_usuario (usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function main() {
  const args = process.argv.slice(2);
  const sql = args.includes('--sql');
  const [usuario, password] = args.filter((a) => !a.startsWith('--'));

  if (!usuario || !password) {
    console.error('Uso: node src/crear-usuario.js <usuario> <contraseña> [--sql]');
    process.exit(1);
  }
  if (String(password).length < 8) {
    console.error('La contraseña debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const hash = hashPassword(password);

  if (sql) {
    console.log(CREA_TABLA + ';');
    console.log(
      `INSERT INTO usuarios (usuario, hash) VALUES ('${usuario.replace(/'/g, "''")}', '${hash}')\n` +
        `ON DUPLICATE KEY UPDATE hash = VALUES(hash);`
    );
    return;
  }

  await db.exigirConexion();
  await db.pool.query(CREA_TABLA);
  await db.pool.execute(
    'INSERT INTO usuarios (usuario, hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE hash = VALUES(hash)',
    [usuario, hash]
  );
  console.log(`Usuario "${usuario}" listo.`);
}

main()
  .catch((err) => {
    console.error('Error:', err.message || err);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
