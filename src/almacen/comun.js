'use strict';
const { conDefaults } = require('../config');

const fallo = (status, mensaje) => Object.assign(new Error(mensaje), { status });

// Lo que puede ver el navegador de un perfil: nunca la contraseña.
const publico = (p) => p && ({ id: p.id, nombre: p.nombre, activo: !!p.activo, config: conDefaults(p.config), tieneClave: !!p.claveCifrada });

// Fila del historial sin el JSON ni la respuesta completa.
const resumenEnvio = (e) => ({
  id: e.id, creadoEn: e.creadoEn, perfilNombre: e.perfilNombre, modo: e.modo, estado: e.estado, numero: e.numero, numeroExcel: e.numeroExcel,
  proveedor: e.proveedor, identificacion: e.identificacion, valor: e.valor, saphetyId: e.saphetyId, cuds: e.cuds, mensaje: e.mensaje,
});

/**
 * Resume los envíos reales previos por número del Excel (PREFIJO + FOLIO).
 * Devuelve Map numeroExcel -> { aceptadoComo: número con que Saphety lo aceptó | null, errorEnvio: el último intento falló por conexión }.
 * Los envíos guardados antes de existir numeroExcel se identifican por el número enviado.
 */
function resumirPrevios(filas, buscados) {
  const previos = new Map();
  for (const f of [...filas].sort((a, b) => a.id - b.id)) {
    const clave = f.numeroExcel || f.numero;
    if (!buscados.has(clave)) continue;
    const p = previos.get(clave) || { aceptadoComo: null, errorEnvio: false };
    if (f.estado === 'aceptado') p.aceptadoComo = f.numero;
    p.errorEnvio = f.estado === 'error_envio';
    previos.set(clave, p);
  }
  return previos;
}

module.exports = { fallo, publico, resumenEnvio, resumirPrevios };
