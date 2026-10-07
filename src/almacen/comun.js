'use strict';
const { conDefaults } = require('../config');

const fallo = (status, mensaje) => Object.assign(new Error(mensaje), { status });

// Lo que puede ver el navegador de un perfil: nunca la contraseña.
const publico = (p) => p && ({ id: p.id, nombre: p.nombre, activo: !!p.activo, config: conDefaults(p.config), tieneClave: !!p.claveCifrada });

// Fila del historial sin el JSON ni la respuesta completa.
const resumenEnvio = (e) => ({
  id: e.id, creadoEn: e.creadoEn, perfilNombre: e.perfilNombre, modo: e.modo, estado: e.estado, numero: e.numero,
  proveedor: e.proveedor, identificacion: e.identificacion, valor: e.valor, saphetyId: e.saphetyId, cuds: e.cuds, mensaje: e.mensaje,
});

module.exports = { fallo, publico, resumenEnvio };
