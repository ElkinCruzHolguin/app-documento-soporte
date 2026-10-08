'use strict';
// Rutas de la API: solo URL -> middleware -> controlador.
const express = require('express');
const { asincrono } = require('../middlewares/asincrono');
const { requiereSesion } = require('../middlewares/autenticacion');
const { crearControladorSesion } = require('../controladores/sesion.controlador');
const { crearControladorCompanias } = require('../controladores/companias.controlador');
const { crearControladorUsuarios } = require('../controladores/usuarios.controlador');
const { crearControladorDocumentos } = require('../controladores/documentos.controlador');
const { crearControladorHistorial } = require('../controladores/historial.controlador');

function crearRutasApi({ servicios, entorno }) {
  const opciones = { cookieSegura: entorno.enVercel };
  const sesion = crearControladorSesion(servicios, opciones);
  const companias = crearControladorCompanias(servicios);
  const usuarios = crearControladorUsuarios(servicios);
  const documentos = crearControladorDocumentos(servicios);
  const historial = crearControladorHistorial(servicios);
  const r = express.Router();
  const a = asincrono;

  // Públicas
  r.post('/login', a(sesion.iniciar));
  r.post('/logout', sesion.cerrar);

  // Todo lo demás exige sesión
  r.use(requiereSesion(servicios.autenticacion, opciones));
  r.get('/estado', a(sesion.estado));

  r.get('/perfiles', a(companias.listar));
  r.post('/perfiles', a(companias.crear));
  r.put('/perfiles/:id', a(companias.actualizar));
  r.delete('/perfiles/:id', a(companias.eliminar));
  r.post('/perfiles/:id/activar', a(companias.activar));
  r.post('/perfiles/:id/probar', a(companias.probar));
  r.get('/perfiles/:id/catalogo/:nombre', a(companias.catalogo));

  r.get('/usuarios', a(usuarios.listar));
  r.post('/usuarios', a(usuarios.crear));
  r.put('/usuarios/:id', a(usuarios.actualizar));
  r.delete('/usuarios/:id', a(usuarios.eliminar));

  r.post('/convertir', express.raw({ type: () => true, limit: '30mb' }), a(documentos.convertir));
  r.post('/enviar', a(documentos.enviar));

  r.get('/envios', a(historial.listar));
  r.get('/envios/:id', a(historial.obtener));

  return r;
}

module.exports = { crearRutasApi };
