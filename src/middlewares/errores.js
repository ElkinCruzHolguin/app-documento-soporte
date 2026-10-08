'use strict';
// Convierte cualquier error en una respuesta JSON { error }. Los errores sin status son inesperados y se registran.
function manejarErrores(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (!err.status) console.error(err);
  const mensaje = err.status === 413 ? 'El archivo es demasiado grande.' : err.message;
  res.status(err.status || 500).json({ error: mensaje });
}

module.exports = { manejarErrores };
