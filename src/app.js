'use strict';
// Composición de la aplicación Express: middlewares globales, páginas estáticas y API.
const path = require('node:path');
const express = require('express');
const { leerEntorno } = require('./config/entorno');
const { crearContenedor } = require('./contenedor');
const { crearRutasApi } = require('./rutas');
const { manejarErrores } = require('./middlewares/errores');

function crearApp(entorno = leerEntorno()) {
  const contenedor = crearContenedor(entorno);
  const app = express();

  if (!entorno.autenticacion && entorno.enVercel) {
    // Publicada en internet sin super administrador: no se atiende nada.
    app.use((req, res) => res.status(503).send('Configura APP_USUARIO y APP_CLAVE en las variables de entorno de Vercel.'));
  }
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', crearRutasApi(contenedor));
  app.use(manejarErrores);

  return { app, contenedor };
}

module.exports = { crearApp };
