'use strict';
// Punto de entrada. En local levanta el servidor HTTP; en Vercel, api/index.js usa el `app` exportado.
const { crearApp } = require('./app');

const { app, contenedor } = crearApp();

if (require.main === module) {
  const { puerto, host, autenticacion } = contenedor.entorno;
  app.listen(puerto, host, () => {
    console.log(`App de documentos soporte en http://${host === '0.0.0.0' ? 'localhost' : host}:${puerto}`);
    console.log(`Datos en: ${contenedor.tipoAlmacen() === 'supabase' ? 'Supabase' : 'archivos locales (data/)'}`);
    if (!autenticacion) console.log('Sin APP_USUARIO/APP_CLAVE: sin inicio de sesión y solo se escucha en 127.0.0.1.');
  });
}

module.exports = { app };
