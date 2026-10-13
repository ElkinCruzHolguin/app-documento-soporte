'use strict';
// Tablero: periodos, indicadores y servicio con un Saphety falso.
const test = require('node:test');
const assert = require('node:assert');
const reglas = require('../src/dominio/dashboard');
const { crearServicioDashboard } = require('../src/servicios/dashboard.servicio');

const AHORA = new Date('2026-10-03T15:00:00Z'); // 10:00 en Colombia
const emitido = (id, creado, estado, valor, destino = 'CO_NIT_860031699') => ({
  Id: id, DocumentType: 'SupportDocument', DocumentNumber: `SEDS${id}`, OriginName: 'PROVEEDOR', OriginCode: 'CO_NIT_900123456',
  DestinationCode: destino, CreationDate: creado, DocumentStatus: estado, Currency: 'COP', TotalAmount: valor,
});
const recibido = (id, creado, estado, companyId = 'c-vitro') => ({ Id: id, CompanyId: companyId, CreationDate: creado, DocumentStatus: estado, Currency: 'COP', TotalAmount: 50 });

test('periodo: mes en curso, mes anterior y 7 días que cruzan al mes anterior', () => {
  const p = reglas.periodo(AHORA);
  assert.strictEqual(p.hoy, '2026-10-03');
  assert.deepStrictEqual(p.mes, { desde: '2026-10-01', hasta: '2026-10-03' });
  assert.deepStrictEqual(p.mesAnterior, { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.deepStrictEqual(p.consulta, { desde: '2026-09-27', hasta: '2026-10-03' });
  assert.deepStrictEqual([p.dias[0], p.dias[6]], ['2026-09-27', '2026-10-03']);
  // A las 11 p. m. de Colombia sigue siendo el mismo día aunque en UTC ya sea el siguiente
  assert.strictEqual(reglas.diaBogota('2026-10-04T04:00:00Z'), '2026-10-03');
});

test('servicio: indicadores reales, solo de la compañía, y secciones que fallan por separado', async () => {
  const docsEmitidos = [
    emitido('1', '2026-10-03T14:00:00Z', 'Certified', 1000),
    emitido('2', '2026-10-02T14:00:00Z', 'Rejected', 500),
    emitido('3', '2026-10-01T14:00:00Z', 'InProcess', 200),
    emitido('4', '2026-09-28T14:00:00Z', 'Certified', 9999), // mes anterior: cuenta en la gráfica, no en el mes
    emitido('5', '2026-10-03T14:00:00Z', 'Certified', 7777, 'CO_NIT_111'), // de otra compañía
  ];
  const docsRecibidos = [
    recibido('a', '2026-10-03T13:00:00Z', 'Registered'),
    recibido('b', '2026-09-29T13:00:00Z', 'Accepted'),
    recibido('z', '2026-10-03T13:00:00Z', 'Registered', 'c-otra'),
  ];
  const llamadas = [];
  const saphety = {
    buscarEmitidos: async (id, cfg, clave, f) => { llamadas.push(['buscarEmitidos', f]); return f.Offset === 0 ? docsEmitidos : []; },
    contarEmitidos: async (id, cfg, clave, f) => (f.CreationDateStart.startsWith('2026-09-01') ? 12 : 4),
    buscarRecibidos: async (id, cfg, clave, f) => { llamadas.push(['buscarRecibidos', f]); return { Items: f.Offset === 0 ? docsRecibidos : [], Total: 3 }; },
    contarRecibidos: async (id, cfg, clave, f) => (f.DocumentStatus ? 7 : 2),
  };
  const compania = { id: 6, nombre: 'Vitro QA', config: { nit: '860031699', companyId: 'c-vitro', modoEnvio: 'real' } };
  const envios = { listar: async ({ perfilId, limite }) => [{ id: 1, perfilId, limite, estado: 'aceptado', numero: 'SEDS1' }] };
  const crear = (cfg) => crearServicioDashboard({ companias: { requerida: async () => ({ ...compania, config: cfg }) }, perfiles: { clave: async () => 'x' }, envios, saphety, log: { warn() {} } });

  const d = await crear(compania.config).obtener({ rol: 'admin' }, AHORA);
  assert.strictEqual(d.emitidos.disponible, true);
  assert.deepStrictEqual(d.emitidos.porEstado, { aceptado: 1, en_proceso: 1, rechazado: 1 });
  assert.strictEqual(d.emitidos.valorMes, 1700);
  assert.strictEqual(d.emitidos.hoy, 1);
  assert.deepStrictEqual([d.emitidos.totalMes, d.emitidos.totalMesAnterior], [4, 12]);
  assert.deepStrictEqual(d.emitidos.recientes.map((x) => x.numero), ['SEDS1', 'SEDS2', 'SEDS3', 'SEDS4']);
  assert.strictEqual(d.recibidos.hoy, 1);
  assert.strictEqual(d.recibidos.porGestionar, 7);
  assert.strictEqual(d.recibidos.totalMes, 2);
  assert.deepStrictEqual(d.serie.map((p) => [p.dia.slice(5), p.emitidos, p.recibidos]), [
    ['09-27', 0, 0], ['09-28', 1, 0], ['09-29', 0, 1], ['09-30', 0, 0], ['10-01', 1, 0], ['10-02', 1, 0], ['10-03', 1, 1],
  ]);
  assert.strictEqual(d.envios[0].perfilId, 6);
  // Recibidos se consultan solo con el companyId de la compañía
  assert.deepStrictEqual(llamadas.find((l) => l[0] === 'buscarRecibidos')[1].CompanyIds, ['c-vitro']);

  // Sin companyId: los emitidos se muestran y recibidos explica qué falta
  const sinCompania = await crear({ nit: '860031699' }).obtener({ rol: 'empresa', perfilId: 6 }, AHORA);
  assert.strictEqual(sinCompania.emitidos.disponible, true);
  assert.strictEqual(sinCompania.recibidos.disponible, false);
  assert.match(sinCompania.recibidos.error, /companyId/);
  assert.ok(sinCompania.serie.every((p) => p.recibidos === null));
});

test('servicio: pagina hasta el tope y marca el cálculo como parcial', async () => {
  let n = 0;
  const pagina = () => Array.from({ length: 50 }, () => emitido(String(n += 1), '2026-10-02T14:00:00Z', 'Certified', 1));
  const saphety = { buscarEmitidos: async () => pagina(), contarEmitidos: async () => 900, buscarRecibidos: async () => [], contarRecibidos: async () => 0 };
  const servicio = crearServicioDashboard({
    companias: { requerida: async () => ({ id: 1, nombre: 'X', config: { nit: '860031699', companyId: 'c' } }) },
    perfiles: { clave: async () => 'x' }, envios: { listar: async () => [] }, saphety, log: { warn() {} },
  });
  const d = await servicio.obtener({ rol: 'admin' }, AHORA);
  assert.strictEqual(d.emitidos.listadosMes, 500);
  assert.strictEqual(d.emitidos.completo, false);
  assert.strictEqual(d.emitidos.totalMes, 900);
});
