'use strict';
// Pruebas de la capa de servicios con repositorios falsos (sin HTTP ni base de datos).
const test = require('node:test');
const assert = require('node:assert');
const { crearServicioCompanias } = require('../src/servicios/companias.servicio');
const { crearServicioHistorial } = require('../src/servicios/historial.servicio');

const ADMIN = { id: 0, rol: 'admin', perfilId: null };
const VITRO = { id: 7, rol: 'empresa', perfilId: 1 };

function perfilesFalsos() {
  const datos = new Map([[1, { id: 1, nombre: 'Vitro', activo: true, config: {} }], [2, { id: 2, nombre: 'Atica', activo: false, config: {} }]]);
  return {
    listar: async () => [...datos.values()],
    obtener: async (id) => datos.get(Number(id)) || null,
    activo: async () => [...datos.values()].find((p) => p.activo) || null,
    crear: async (nombre, config) => ({ id: 3, nombre, config }),
  };
}

test('compañías: el administrador ve todas; una compañía solo la suya y no modifica', async () => {
  const s = crearServicioCompanias({ perfiles: perfilesFalsos(), saphety: {} });
  assert.deepStrictEqual((await s.listar(ADMIN)).map((p) => p.nombre), ['Vitro', 'Atica']);
  assert.deepStrictEqual((await s.listar(VITRO)).map((p) => p.nombre), ['Vitro']);
  assert.strictEqual((await s.deActor(VITRO)).nombre, 'Vitro');
  await assert.rejects(s.crear(VITRO, { nombre: 'X' }), { status: 403 });
  await assert.rejects(s.catalogo(VITRO, 2, 'tipos'), { status: 403 });
  await assert.rejects(s.crear(ADMIN, { nombre: ' ' }), { status: 400 });
  await assert.rejects(s.crear(ADMIN, { nombre: 'Nueva', config: { tiposDocumento: '{mal' } }), /JSON válido/);
  assert.strictEqual((await s.crear(ADMIN, { nombre: ' Nueva ', config: { siguienteConsecutivo: '10' } })).config.siguienteConsecutivo, 10);
  await assert.rejects(s.requerida({ rol: 'empresa', perfilId: 99 }), /no tiene una compañía asignada/);
});

test('historial: una compañía no ve envíos de otra', async () => {
  const envios = new Map([[1, { id: 1, perfilId: 1 }], [2, { id: 2, perfilId: 2 }]]);
  let filtro;
  const s = crearServicioHistorial({
    envios: { listar: async (o) => { filtro = o; return []; }, obtener: async (id) => envios.get(Number(id)) || null },
  });
  await s.listar(VITRO, { limite: 9999 });
  assert.deepStrictEqual(filtro, { buscar: '', limite: 500, perfilId: 1 });
  await s.listar(ADMIN);
  assert.strictEqual(filtro.perfilId, null);
  assert.strictEqual((await s.obtener(VITRO, 1)).id, 1);
  await assert.rejects(s.obtener(VITRO, 2), { status: 404 });
  assert.strictEqual((await s.obtener(ADMIN, 2)).id, 2);
});

test('documentos: las filas con el mismo PREFIJO + FOLIO forman un solo documento', async () => {
  const { crearServicioDocumentos } = require('../src/servicios/documentos.servicio');
  const fila = (folio, valor, extra = {}) => ({
    tipo: 'SEDS', prefijo: 'SEDS', prefijoFolio: folio, fechaDoc: '2026-08-05', identificacion: 890300279, proveedor: 'BANCO',
    valor, descripcion: 'GASTOS', direccion: 'CL 1', municipio: '05001', departamento: '05', pais: 'CO',
    tipoDocumento: 31, precedencia: 10, tipoPersona: 1, ...extra,
  });
  const excel = { leerExcel: async () => ({ hoja: 'h', columnas: {}, faltantes: [], filas: [
    { numeroFila: 2, datos: fila(1, 100) },
    { numeroFila: 3, datos: fila(2, 1000, { excluidoIva: 'SI' }) },
    { numeroFila: 4, datos: fila(2, 200, { tasaIva: 19 }) },
  ] }) };
  const config = { nit: '860031699', serieExternalKeyDS: 'K' };
  const s = crearServicioDocumentos({ companias: { requerida: async () => ({ id: 1, config }) }, envios: { previos: async () => new Map() }, excel });
  const { documentos } = await s.convertir(VITRO, Buffer.from('x'));
  assert.deepStrictEqual(documentos.map((d) => [d.fila, d.numero, d.errores.length]), [[2, 'SEDS1', 0], ['3, 4', 'SEDS2', 0]]);
  assert.strictEqual(documentos[1].json.Lines.length, 2);
  assert.strictEqual(documentos[1].json.Total.PayableAmount, '1238.00');
  assert.ok(Array.isArray(documentos[1].datos), 'al enviar se mandan todas las filas del documento');
});
