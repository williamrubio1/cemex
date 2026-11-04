# cemex

Plataforma de campañas de WhatsApp para **CETEX**, operada por Soluctia S.A.S.
Se despliega en Hostinger como `cetex.soluctiasas.com`.

- Código y documentación: [`code/`](code/README.md)
- Despliegue: Node.js desde GitHub, rama `main`, comando de inicio `npm start`
  (el `package.json` de la raíz arranca `code/src/index.js`).
- Las variables de entorno se configuran en Hostinger (ver `code/.env.example`);
  el `.env` y los datos de contactos nunca se suben al repositorio.
