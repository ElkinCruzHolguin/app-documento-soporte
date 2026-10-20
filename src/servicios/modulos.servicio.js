'use strict';
// Qué módulos puede usar el actor: los habilitados en su compañía y, si los tiene, solo los suyos.
const { fallo } = require('../dominio/errores');
const { efectivos, MODULOS } = require('../dominio/modulos');

function crearServicioModulos({ companias, usuarios }) {
  return {
    catalogo: () => MODULOS,

    async deActor(actor) {
      if (actor.rol === 'admin') return efectivos({ rol: 'admin' });
      const [p, u] = await Promise.all([companias.deActor(actor), actor.id ? usuarios.obtener(actor.id) : null]);
      return efectivos({ rol: actor.rol, config: p && p.config, modulosUsuario: u && u.modulos });
    },

    /** Lanza 403 si el actor no tiene ese módulo. */
    async exigir(actor, modulo) {
      if (actor.rol === 'admin') return;
      if (!(await this.deActor(actor)).includes(modulo)) throw fallo(403, 'Tu usuario no tiene acceso a este módulo. Pídeselo al administrador.');
    },
  };
}

module.exports = { crearServicioModulos };
