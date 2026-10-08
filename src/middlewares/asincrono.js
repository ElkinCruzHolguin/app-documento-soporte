'use strict';
// Pasa los errores de un manejador async al middleware de errores.
const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asincrono };
