'use strict';
// Historial de envíos reales. Un usuario de compañía solo ve los de la suya.
const { fallo } = require('../dominio/errores');

function crearServicioHistorial({ envios }) {
  const companiaFiltro = (actor) => (actor.rol === 'admin' ? null : actor.perfilId);

  return {
    listar(actor, { buscar = '', limite = 100 } = {}) {
      const tope = Math.min(Math.max(Number(limite) || 100, 1), 500);
      return envios.listar({ buscar: String(buscar), limite: tope, perfilId: companiaFiltro(actor) });
    },

    async obtener(actor, id) {
      const e = await envios.obtener(id);
      const filtro = companiaFiltro(actor);
      if (!e || (filtro != null && e.perfilId !== filtro)) throw fallo(404, 'Envío no encontrado.');
      return e;
    },
  };
}

module.exports = { crearServicioHistorial };
