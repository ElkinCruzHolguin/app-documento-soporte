'use strict';
// Compañías a las que tiene acceso un usuario de compañía: la principal (perfilId) más las ligadas
// (p. ej. Vitro QA y Vitro PRD). El usuario trabaja con una a la vez y puede cambiar entre ellas.
// Un administrador no tiene lista: ve todas.

/** Ids de las compañías del usuario, la principal primero. */
function companiasDe(u) {
  if (!u || u.rol === 'admin') return [];
  const ligadas = Array.isArray(u.companias) ? u.companias : [];
  return [...new Set([u.perfilId, ...ligadas].filter((x) => x != null).map(Number))];
}

/** Normaliza la lista de compañías ligadas que llega del formulario. */
function limpiarCompanias(lista, fallo) {
  if (lista == null) return [];
  if (!Array.isArray(lista)) throw fallo(400, 'Las compañías ligadas deben ser una lista.');
  const ids = lista.map(Number);
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw fallo(400, 'Compañía ligada inválida.');
  return [...new Set(ids)].sort((a, b) => a - b);
}

module.exports = { companiasDe, limpiarCompanias };
