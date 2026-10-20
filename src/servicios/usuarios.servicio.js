'use strict';
// Usuarios de las compañías. Solo el administrador los gestiona. Los usuarios creados aquí
// son siempre de compañía: el único administrador es APP_USUARIO.
// El usuario es el correo: entra con él y su contraseña, y ahí recibe el código del segundo paso.
const { fallo } = require('../dominio/errores');
const { esCorreo, normalizarCorreo } = require('../dominio/correo');

const ROLES = ['empresa'];

function crearServicioUsuarios({ entorno, usuarios, perfiles, seguridad }) {
  const exigirAdmin = (actor) => {
    if (actor.rol !== 'admin') throw fallo(403, 'Solo el administrador puede modificar compañías y usuarios.');
  };
  async function validarRolYCompania(rol, perfilId) {
    if (!ROLES.includes(rol)) throw fallo(400, 'Rol inválido.');
    if (!(await perfiles.obtener(perfilId))) throw fallo(400, 'Elige la compañía del usuario.');
  }
  function validarClave(clave) {
    if (String(clave || '').length < 10) throw fallo(400, 'La contraseña debe tener al menos 10 caracteres.');
  }
  function validarCorreo(correo) {
    if (!esCorreo(correo)) throw fallo(400, 'El usuario debe ser un correo válido (p. ej. nombre@empresa.com).');
    if (entorno.usuarioAdmin && correo === entorno.usuarioAdmin.toLowerCase()) throw fallo(400, 'Ese nombre está reservado para el super administrador.');
  }
  async function existente(id) {
    const u = await usuarios.obtener(id);
    if (!u) throw fallo(404, 'Usuario no encontrado.');
    return u;
  }

  return {
    async listar(actor) {
      exigirAdmin(actor);
      return usuarios.listar();
    },

    async crear(actor, { usuario, clave, rol = 'empresa', perfilId }) {
      exigirAdmin(actor);
      const nombre = normalizarCorreo(usuario);
      validarCorreo(nombre);
      validarClave(clave);
      await validarRolYCompania(rol, Number(perfilId));
      return usuarios.crear({ usuario: nombre, claveHash: seguridad.hashClave(clave), rol, perfilId: Number(perfilId) });
    },

    async actualizar(actor, id, datos) {
      exigirAdmin(actor);
      const actual = await existente(id);
      const cambios = {};
      // Cambiar el usuario (p. ej. pasar de «vitro» a su correo) cierra su sesión.
      if (datos.usuario != null && normalizarCorreo(datos.usuario) !== actual.usuario) {
        cambios.usuario = normalizarCorreo(datos.usuario);
        validarCorreo(cambios.usuario);
      }
      if (datos.clave) {
        validarClave(datos.clave);
        cambios.claveHash = seguridad.hashClave(datos.clave);
      }
      if ('activo' in datos) cambios.activo = !!datos.activo;
      if ('rol' in datos || 'perfilId' in datos) {
        const rol = datos.rol || actual.rol;
        const perfilId = Number(datos.perfilId ?? actual.perfilId);
        await validarRolYCompania(rol, perfilId);
        Object.assign(cambios, { rol, perfilId });
      }
      return usuarios.actualizar(actual.id, cambios);
    },

    async eliminar(actor, id) {
      exigirAdmin(actor);
      await existente(id);
      await usuarios.eliminar(id);
    },
  };
}

module.exports = { crearServicioUsuarios };
