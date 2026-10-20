'use strict';
// Cuenta del usuario conectado: cada usuario de la tabla (de compañía o administrador) cambia su propia contraseña.
// La del super administrador es APP_CLAVE y se cambia en las variables de entorno.
const { fallo } = require('../dominio/errores');

function crearServicioCuenta({ usuarios, seguridad }) {
  return {
    /** Exige la contraseña actual. 5 intentos fallidos bloquean el cambio 15 minutos. */
    async cambiarClave(actor, { actual, nueva }) {
      if (!actor.id) {
        throw fallo(400, 'La contraseña del administrador se cambia en Vercel (variable APP_CLAVE).');
      }
      const llave = `cuenta|${actor.id}`;
      if (seguridad.bloqueado(llave)) throw fallo(429, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');

      const u = await usuarios.porNombre(actor.usuario);
      if (!u || u.id !== actor.id) throw fallo(404, 'Usuario no encontrado.');
      if (!seguridad.verificarClave(String(actual || ''), u.claveHash)) {
        seguridad.registrarFallo(llave);
        throw fallo(400, 'La contraseña actual no es correcta.');
      }
      seguridad.limpiarFallos(llave);

      const clave = String(nueva || '');
      if (clave.length < 10) throw fallo(400, 'La contraseña debe tener al menos 10 caracteres.');
      if (clave === String(actual)) throw fallo(400, 'La nueva contraseña debe ser distinta de la actual.');
      await usuarios.actualizar(u.id, { claveHash: seguridad.hashClave(clave) });
    },
  };
}

module.exports = { crearServicioCuenta };
