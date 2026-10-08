'use strict';
// Inicio de sesión y validación de la sesión.
// El super administrador es APP_USUARIO/APP_CLAVE; los usuarios de compañía están en el repositorio.
const crypto = require('node:crypto');
const { fallo } = require('../dominio/errores');

function crearServicioAutenticacion({ entorno, usuarios, seguridad }) {
  const firmador = seguridad.crearFirmador(entorno.secreto);
  const HASH_FALSO = seguridad.hashClave(crypto.randomBytes(16).toString('hex')); // iguala el tiempo si el usuario no existe
  const USUARIO_LOCAL = { id: 0, usuario: 'local', rol: 'admin', perfilId: null };

  return {
    /** false solo en local sin APP_USUARIO/APP_CLAVE: no se pide inicio de sesión. */
    activa: entorno.autenticacion,

    /** Devuelve { token, rol }. 5 intentos fallidos por IP y usuario bloquean 15 minutos. */
    async iniciarSesion({ usuario, clave, ip }) {
      const nombre = String(usuario || '').trim().toLowerCase();
      const contrasena = String(clave || '');
      if (!entorno.autenticacion) return { token: '', rol: 'admin' };
      const llave = `${ip}|${nombre}`;
      if (seguridad.bloqueado(llave)) throw fallo(429, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');

      let datos = null;
      if (seguridad.igualSeguro(nombre, entorno.usuarioAdmin.toLowerCase()) && seguridad.igualSeguro(contrasena, entorno.claveAdmin)) {
        datos = { id: 0, usuario: nombre, rol: 'admin', perfilId: null };
      } else {
        const u = await usuarios.porNombre(nombre);
        const ok = seguridad.verificarClave(contrasena, u ? u.claveHash : HASH_FALSO);
        if (u && ok && u.activo) {
          datos = { id: u.id, usuario: u.usuario, rol: u.rol, perfilId: u.perfilId };
          await usuarios.actualizar(u.id, { ultimoIngreso: new Date().toISOString() });
        }
      }
      if (!datos) {
        seguridad.registrarFallo(llave);
        throw fallo(401, 'Usuario o contraseña incorrectos.');
      }
      seguridad.limpiarFallos(llave);
      return { token: firmador.emitir(datos), rol: datos.rol };
    },

    /**
     * Devuelve el usuario de la sesión o lanza 401. Los usuarios de compañía se revalidan
     * en cada petición para que desactivarlos o cambiarles la compañía tenga efecto inmediato.
     */
    async validarSesion(token) {
      if (!entorno.autenticacion) return USUARIO_LOCAL;
      const d = firmador.leer(token);
      let valido = !!d;
      if (d && d.id) {
        const u = await usuarios.obtener(d.id);
        valido = !!u && u.activo && u.rol === d.rol && (u.perfilId ?? null) === (d.perfilId ?? null);
      }
      if (!valido) throw fallo(401, 'Tu sesión terminó. Inicia sesión de nuevo.');
      return d;
    },
  };
}

module.exports = { crearServicioAutenticacion };
