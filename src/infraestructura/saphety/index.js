'use strict';
// Cliente de la API de Saphety, dividido por área para que dos personas trabajen sin pisarse:
//   cliente.js    token, petición autenticada, errores y archivos (base de todo)
//   emision.js    crear documentos (soporte hoy; factura, notas, nómina, POS listos), simular, códigos, correo
//   emitidos.js   consultar documentos emitidos
//   recibidos.js  buzón de recepción y eventos RADIAN
//   series.js     numeración de la compañía
//   catalogos.js  listas públicas (dataelements)
// Todas las funciones reciben (perfilId, cfg, clave, ...) y se exponen planas desde aquí.
const { obtenerToken, olvidarToken, mensajeRespuesta } = require('./cliente');

module.exports = {
  obtenerToken,
  olvidarToken,
  mensajeRespuesta,
  ...require('./emision'),
  ...require('./emitidos'),
  ...require('./recibidos'),
  ...require('./series'),
  ...require('./catalogos'),
};
