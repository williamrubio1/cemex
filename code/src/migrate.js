'use strict';

/**
 * Ejecuta db/schema.sql contra la base configurada en .env.
 * Uso: npm run db:init
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  if (/legalmedica/i.test(process.env.DB_NAME || '')) {
    throw new Error(`DB_NAME=${process.env.DB_NAME} es la base de LegalMedica. Configura la base nueva de CETEX.`);
  }
  const archivo = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(archivo, 'utf8');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  console.log(`Ejecutando ${archivo} ...`);
  await conn.query(sql);

  const [tablas] = await conn.query('SHOW TABLES');
  console.log('Tablas en la base:');
  for (const fila of tablas) console.log('  -', Object.values(fila)[0]);

  await conn.end();
  console.log('Listo.');
}

main().catch((err) => {
  console.error('Error en la migración:', err.message);
  process.exit(1);
});
