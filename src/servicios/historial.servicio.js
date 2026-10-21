'use strict';
// Historial de envíos reales. Cada quien ve solo los de la compañía con la que trabaja
// (el usuario, la de su sesión; el administrador, la activa): QA y producción son ambientes distintos.
const { fallo } = require('../dominio/errores');

function crearServicioHistorial({ envios, companias }) {
  // Cada envío guarda el nombre que tenía la compañía al enviarse; se muestra el nombre actual.
  const conNombre = (e, compania) => ({ ...e, perfilNombre: compania.nombre });

  return {
    async listar(actor, { buscar = '', limite = 100 } = {}) {
      const compania = await companias.deActor(actor);
      if (!compania) return [];
      const tope = Math.min(Math.max(Number(limite) || 100, 1), 500);
      const lista = await envios.listar({ buscar: String(buscar), limite: tope, perfilId: compania.id });
      return lista.map((e) => conNombre(e, compania));
    },

    async obtener(actor, id) {
      const [e, compania] = await Promise.all([envios.obtener(id), companias.deActor(actor)]);
      if (!e || !compania || e.perfilId !== compania.id) throw fallo(404, 'Envío no encontrado.');
      return conNombre(e, compania);
    },
  };
}

module.exports = { crearServicioHistorial };
