'use strict';
// Usuarios. Solo un administrador los gestiona. Rol «empresa»: trabaja solo con su compañía.
// Rol «admin»: administrador con los mismos permisos que APP_USUARIO (todas las compañías y módulos).
// El rol solo lo asigna un administrador; nunca sale del correo.
// El usuario es el correo: entra con él y su contraseña, y ahí recibe el código del segundo paso.
const { fallo } = require('../dominio/errores');
const { esCorreo, normalizarCorreo } = require('../dominio/correo');
const { limpiarModulos } = require('../dominio/modulos');

const ROLES = ['empresa', 'admin'];

function crearServicioUsuarios({ entorno, usuarios, perfiles, seguridad }) {
  const exigirAdmin = (actor) => {
    if (actor.rol !== 'admin') throw fallo(403, 'Solo el administrador puede modificar compañías y usuarios.');
  };
  /** Devuelve la compañía que corresponde al rol: un administrador no queda ligado a ninguna. */
  async function validarRolYCompania(rol, perfilId) {
    if (!ROLES.includes(rol)) throw fallo(400, 'Rol inválido.');
    if (rol === 'admin') return null;
    if (!(await perfiles.obtener(perfilId))) throw fallo(400, 'Elige la compañía del usuario.');
    return perfilId;
  }
  /** Un administrador no puede quitarse a sí mismo el rol, desactivarse ni eliminarse. */
  const exigirOtro = (actor, id, que) => {
    if (actor.id && Number(actor.id) === Number(id)) throw fallo(400, `No puedes ${que} tu propio usuario. Pídeselo a otro administrador.`);
  };
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

    /** modulos: lista de módulos que ve el usuario; null = todos los de su compañía. */
    async crear(actor, { usuario, clave, rol = 'empresa', perfilId, modulos = null }) {
      exigirAdmin(actor);
      const nombre = normalizarCorreo(usuario);
      validarCorreo(nombre);
      validarClave(clave);
      const compania = await validarRolYCompania(rol, Number(perfilId));
      return usuarios.crear({ usuario: nombre, claveHash: seguridad.hashClave(clave), rol, perfilId: compania, modulos: rol === 'admin' ? null : limpiarModulos(modulos, fallo) });
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
      if ('activo' in datos) {
        if (!datos.activo) exigirOtro(actor, actual.id, 'desactivar');
        cambios.activo = !!datos.activo;
      }
      if ('modulos' in datos) cambios.modulos = limpiarModulos(datos.modulos, fallo);
      if ('rol' in datos || 'perfilId' in datos) {
        const rol = datos.rol || actual.rol;
        if (rol !== actual.rol) exigirOtro(actor, actual.id, 'cambiar el rol de');
        // Al pasar de administrador a compañía hay que elegir la compañía.
        const perfilId = await validarRolYCompania(rol, Number(datos.perfilId ?? actual.perfilId));
        Object.assign(cambios, { rol, perfilId });
        if (rol === 'admin') cambios.modulos = null;
      }
      return usuarios.actualizar(actual.id, cambios);
    },

    async eliminar(actor, id) {
      exigirAdmin(actor);
      exigirOtro(actor, id, 'eliminar');
      await existente(id);
      await usuarios.eliminar(id);
    },
  };
}

module.exports = { crearServicioUsuarios };
