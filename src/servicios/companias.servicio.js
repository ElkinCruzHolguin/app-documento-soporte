'use strict';
// Compañías (en la base de datos, "perfiles"): conexión con Saphety, parámetros y datos de cada una.
// Solo el administrador las crea y modifica; un usuario de compañía consulta la suya en solo lectura.
const { fallo } = require('../dominio/errores');

const esAdmin = (actor) => actor.rol === 'admin';
const CAMPOS_NUMERICOS = ['siguienteConsecutivo'];
const CAMPOS_BOOLEANOS = ['incluirIvaCero', 'incluirTelefono'];
const CAMPOS_JSON = [['tiposDocumento', 'tipos de documento']];

/** Normaliza lo que llega del formulario de Administración. */
function limpiarConfig(entrada) {
  const c = { ...(entrada || {}) };
  for (const k of CAMPOS_NUMERICOS) if (k in c) c[k] = Number(c[k]) || 0;
  for (const k of CAMPOS_BOOLEANOS) if (k in c) c[k] = c[k] === true || c[k] === 'true';
  for (const [k, v] of Object.entries(c)) if (typeof v === 'string') c[k] = v.trim();
  for (const [k, nombre] of CAMPOS_JSON) {
    if (typeof c[k] !== 'string') continue;
    try { c[k] = JSON.parse(c[k]); } catch { throw fallo(400, `La tabla de ${nombre} no es un JSON válido.`); }
  }
  return c;
}

function crearServicioCompanias({ perfiles, saphety }) {
  const exigirAdmin = (actor) => {
    if (!esAdmin(actor)) throw fallo(403, 'Solo el administrador puede modificar compañías y usuarios.');
  };
  async function existente(id) {
    const p = await perfiles.obtener(id);
    if (!p) throw fallo(404, 'Compañía no encontrada.');
    return p;
  }
  /** Un usuario de compañía solo puede consultar la suya. */
  async function visible(actor, id) {
    if (!esAdmin(actor) && Number(id) !== actor.perfilId) throw fallo(403, 'Solo el administrador puede modificar compañías y usuarios.');
    return existente(id);
  }

  return {
    /** Compañía con la que trabaja el actor (el admin, la activa; un usuario, la suya) o null. */
    deActor: (actor) => (esAdmin(actor) ? perfiles.activo() : perfiles.obtener(actor.perfilId)),

    /** Igual que deActor, pero exige que exista. */
    async requerida(actor) {
      const p = await this.deActor(actor);
      if (!p) {
        throw fallo(400, esAdmin(actor)
          ? 'No hay una compañía activa. Crea o elige una en Administración.'
          : 'Tu usuario no tiene una compañía asignada. Contacta al administrador.');
      }
      return p;
    },

    async listar(actor) {
      if (esAdmin(actor)) return perfiles.listar();
      const propia = await perfiles.obtener(actor.perfilId);
      return propia ? [propia] : [];
    },

    async crear(actor, { nombre, config, clave }) {
      exigirAdmin(actor);
      if (!nombre || !String(nombre).trim()) throw fallo(400, 'La compañía necesita un nombre.');
      return perfiles.crear(String(nombre).trim(), limpiarConfig(config), clave);
    },

    async actualizar(actor, id, { nombre, config, clave }) {
      exigirAdmin(actor);
      const actual = await existente(id);
      saphety.olvidarToken(actual.id);
      return perfiles.actualizar(actual.id, String(nombre || actual.nombre).trim(), { ...actual.config, ...limpiarConfig(config) }, clave);
    },

    async activar(actor, id) {
      exigirAdmin(actor);
      await existente(id);
      await perfiles.activar(id);
    },

    async eliminar(actor, id) {
      exigirAdmin(actor);
      const p = await existente(id);
      if (p.activo) throw fallo(400, 'No se puede eliminar la compañía con la que estás trabajando.');
      await perfiles.eliminar(p.id);
    },

    /** Solo pide el token: comprueba usuario, contraseña y opv de Saphety. */
    async probarConexion(actor, id) {
      exigirAdmin(actor);
      const p = await existente(id);
      await saphety.obtenerToken(p.id, p.config, await perfiles.clave(p.id), { forzar: true });
      return 'Token obtenido correctamente.';
    },

    async catalogo(actor, id, nombre) {
      const p = await visible(actor, id);
      if (!/^[a-z]+$/i.test(nombre)) throw fallo(400, 'Nombre de catálogo inválido.');
      return saphety.catalogo(p.id, p.config, await perfiles.clave(p.id), nombre);
    },
  };
}

module.exports = { crearServicioCompanias, limpiarConfig };
