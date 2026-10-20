'use strict';
// Módulos de la app. Cada compañía tiene los suyos habilitados y cada usuario de compañía
// ve los de su compañía o solo algunos de ellos. El administrador ve todo.

const MODULOS = [
  { clave: 'dashboard', nombre: 'Dashboard' },
  { clave: 'cargar', nombre: 'Cargar y enviar' },
  { clave: 'emitidos', nombre: 'Emitidos' },
  { clave: 'recibidos', nombre: 'Recibidos' },
  { clave: 'historial', nombre: 'Historial' },
  { clave: 'compania', nombre: 'Mi compañía' },
];
const CLAVES = MODULOS.map((m) => m.clave);

/** Valida una lista de módulos y la deja en el orden del menú. null/undefined = sin restricción. */
function limpiarModulos(lista, fallo) {
  if (lista == null) return null;
  if (!Array.isArray(lista)) throw fallo(400, 'Los módulos deben ser una lista.');
  const desconocido = lista.find((m) => !CLAVES.includes(m));
  if (desconocido) throw fallo(400, `Módulo desconocido: ${desconocido}.`);
  return CLAVES.filter((c) => lista.includes(c));
}

/** Módulos habilitados para la compañía (sin configurar = todos, como antes). */
const deCompania = (config) => (Array.isArray(config && config.modulos) ? CLAVES.filter((c) => config.modulos.includes(c)) : [...CLAVES]);

/** Lo que ve un usuario de compañía: los de su compañía, recortados por los suyos si los tiene. */
function efectivos({ rol, config, modulosUsuario }) {
  if (rol === 'admin') return [...CLAVES];
  const compania = deCompania(config);
  return Array.isArray(modulosUsuario) ? compania.filter((c) => modulosUsuario.includes(c)) : compania;
}

module.exports = { MODULOS, CLAVES, limpiarModulos, deCompania, efectivos };
