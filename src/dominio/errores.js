'use strict';
// Error de negocio con el código HTTP que corresponde. Los servicios lo lanzan;
// el middleware de errores lo convierte en respuesta.
class ErrorNegocio extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

const fallo = (status, mensaje) => new ErrorNegocio(status, mensaje);

module.exports = { ErrorNegocio, fallo };
