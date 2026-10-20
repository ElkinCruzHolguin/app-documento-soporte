'use strict';
// Rutas de la API: solo URL -> middleware -> controlador.
const express = require('express');
const { asincrono } = require('../middlewares/asincrono');
const { requiereSesion } = require('../middlewares/autenticacion');
const { requiereModulo } = require('../middlewares/modulos');
const { crearControladorSesion } = require('../controladores/sesion.controlador');
const { crearControladorCompanias } = require('../controladores/companias.controlador');
const { crearControladorUsuarios } = require('../controladores/usuarios.controlador');
const { crearControladorDocumentos } = require('../controladores/documentos.controlador');
const { crearControladorHistorial } = require('../controladores/historial.controlador');
const { crearControladorEmitidos } = require('../controladores/emitidos.controlador');
const { crearControladorRecibidos } = require('../controladores/recibidos.controlador');
const { crearControladorDashboard } = require('../controladores/dashboard.controlador');
const { crearControladorCuenta } = require('../controladores/cuenta.controlador');

function crearRutasApi({ servicios, entorno }) {
  const opciones = { cookieSegura: entorno.enVercel };
  const sesion = crearControladorSesion(servicios, opciones);
  const companias = crearControladorCompanias(servicios);
  const usuarios = crearControladorUsuarios(servicios);
  const documentos = crearControladorDocumentos(servicios);
  const historial = crearControladorHistorial(servicios);
  const emitidos = crearControladorEmitidos(servicios);
  const recibidos = crearControladorRecibidos(servicios);
  const dashboard = crearControladorDashboard(servicios);
  const cuenta = crearControladorCuenta(servicios);
  const r = express.Router();
  const a = asincrono;
  const m = (modulo) => requiereModulo(servicios.modulos, modulo);

  // Públicas
  r.post('/login', a(sesion.iniciar));
  r.post('/login/verificar', a(sesion.verificarCodigo));
  r.post('/login/reenviar', a(sesion.reenviarCodigo));
  r.post('/logout', sesion.cerrar);

  // Todo lo demás exige sesión
  r.use(requiereSesion(servicios.autenticacion, opciones));
  r.get('/estado', a(sesion.estado));
  r.post('/cuenta/clave', a(cuenta.cambiarClave));

  r.get('/modulos', sesion.modulos);

  r.get('/perfiles', m('compania'), a(companias.listar));
  r.post('/perfiles', a(companias.crear));
  r.put('/perfiles/:id', a(companias.actualizar));
  r.delete('/perfiles/:id', a(companias.eliminar));
  r.post('/perfiles/:id/activar', a(companias.activar));
  r.post('/perfiles/:id/probar', a(companias.probar));
  r.get('/perfiles/:id/catalogo/:nombre', m('compania'), a(companias.catalogo));

  r.get('/usuarios', a(usuarios.listar));
  r.post('/usuarios', a(usuarios.crear));
  r.put('/usuarios/:id', a(usuarios.actualizar));
  r.delete('/usuarios/:id', a(usuarios.eliminar));

  r.post('/convertir', m('cargar'), express.raw({ type: () => true, limit: '30mb' }), a(documentos.convertir));
  r.post('/enviar', m('cargar'), a(documentos.enviar));

  r.get('/envios', m('historial'), a(historial.listar));
  r.get('/envios/:id', m('historial'), a(historial.obtener));

  r.get('/emitidos', m('emitidos'), a(emitidos.listar));
  r.get('/emitidos/:id', m('emitidos'), a(emitidos.obtener));
  r.get('/emitidos/:id/:formato', m('emitidos'), a(emitidos.archivo));

  r.get('/dashboard', m('dashboard'), a(dashboard.obtener));

  r.get('/recibidos', m('recibidos'), a(recibidos.listar));
  r.get('/recibidos/:id', m('recibidos'), a(recibidos.obtener));
  r.get('/recibidos/:id/:formato', m('recibidos'), a(recibidos.archivo));
  r.post('/recibidos/:id/eventos', m('recibidos'), a(recibidos.evento));

  return r;
}

module.exports = { crearRutasApi };
