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
