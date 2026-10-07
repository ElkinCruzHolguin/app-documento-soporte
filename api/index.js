'use strict';
// Punto de entrada en Vercel: todas las rutas /api/* llegan aquí (ver vercel.json).
// Las páginas de public/ las sirve Vercel directamente.
const { app } = require('../src/server');

module.exports = app;
