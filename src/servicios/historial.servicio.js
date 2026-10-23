'use strict';
// Historial de envíos reales. Cada quien ve solo los de la compañía con la que trabaja
// (el usuario, la de su sesión; el administrador, la activa): QA y producción son ambientes distintos.
const { fallo } = require('../dominio/errores');

// Columnas del Excel de documentos aceptados.
const COLUMNAS_EXCEL = [
  { titulo: 'Fecha de envío', clave: 'fecha', ancho: 20, formato: 'yyyy-mm-dd hh:mm' },
  { titulo: 'Compañía', clave: 'compania', ancho: 22 },
  { titulo: 'Número', clave: 'numero', ancho: 16 },
  { titulo: 'Número en el Excel', clave: 'numeroExcel', ancho: 18 },
  { titulo: 'Proveedor', clave: 'proveedor', ancho: 40 },
  { titulo: 'Identificación', clave: 'identificacion', ancho: 16 },
  { titulo: 'Valor', clave: 'valor', ancho: 16, formato: '#,##0.00' },
  { titulo: 'Estado', clave: 'estado', ancho: 12 },
  { titulo: 'CUDS', clave: 'cuds', ancho: 100 },
  { titulo: 'Id Saphety', clave: 'saphetyId', ancho: 38 },
];
const TOPE_EXCEL = 10000;

// La fecha va como fecha local de Bogotá (UTC-5, sin horario de verano) para que Excel la muestre igual que la pantalla.
const fechaBogota = (iso) => (iso ? new Date(new Date(iso).getTime() - 5 * 3600 * 1000) : null);

function crearServicioHistorial({ envios, companias, excel }) {
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

    /** Excel con los documentos aceptados de la compañía con la que trabaja, con la misma búsqueda de la pantalla. */
    async exportarAceptados(actor, { buscar = '' } = {}) {
      const compania = await companias.deActor(actor);
      if (!compania) throw fallo(404, 'No hay una compañía con la cual trabajar.');
      const lista = await envios.listar({ buscar: String(buscar), limite: TOPE_EXCEL, perfilId: compania.id, estado: 'aceptado' });
      const filas = lista.filter((e) => e.estado === 'aceptado').map((e) => ({
        fecha: fechaBogota(e.creadoEn), compania: compania.nombre, numero: e.numero, numeroExcel: e.numeroExcel || e.numero,
        proveedor: e.proveedor, identificacion: e.identificacion, valor: e.valor, estado: e.estado, cuds: e.cuds, saphetyId: e.saphetyId,
      }));
      const contenido = await excel.escribirExcel({ hoja: 'Aceptados', columnas: COLUMNAS_EXCEL, filas });
      const hoy = (fechaBogota(new Date().toISOString())).toISOString().slice(0, 10);
      const nombre = `aceptados-${compania.nombre.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}-${hoy}.xlsx`;
      return { nombre, contenido, total: filas.length };
    },
  };
}

module.exports = { crearServicioHistorial };
