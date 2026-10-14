'use strict';
// Consulta de documentos emitidos contra una API de Saphety falsa (local).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-emitidos-'));
const { app } = require('../src/server');
const reglas = require('../src/dominio/emitidos');

const ID_PROPIO = '40120177-845e-4612-bbe1-9acb34207927';
const ID_AJENO = '742b3857-8adb-4e48-afec-2e165303ccb6';
const doc = (id, numero, destino, estado = 'Certified') => ({
  Id: id, DocumentType: 'SupportDocument', DocumentNumber: numero, OriginName: 'BANCO DE OCCIDENTE', OriginCode: 'CO_NIT_890300279',
  DestinationName: 'Vitro', DestinationCode: destino, DocumentDate: '2026-10-01T10:00:00Z', CreationDate: '2026-10-01T10:05:00Z',
  DocumentStatus: estado, Currency: 'COP', TotalAmount: 1297130, Cufe: 'cuds-123', IsPdfGenerated: true,
  MainEmailNotification: 'ds@empresa.com', MainEmailNotificationStatus: 'Sent',
});

test('reglas: filtro de búsqueda, estados y líneas', () => {
  const { cuerpo, desde, hasta } = reglas.filtroBusqueda({}, '860.031.699', new Date('2026-10-13T15:00:00Z'));
  assert.strictEqual(hasta, '2026-10-13');
  assert.strictEqual(desde, '2026-09-13');
  assert.deepStrictEqual(cuerpo.CustomerCodes, ['CO_NIT_860031699']);
  assert.deepStrictEqual(cuerpo.DocumentTypes, ['SupportDocument', 'SupportDocumentAdjustment']);
  assert.strictEqual(cuerpo.CreationDateStart, '2026-09-13T05:00:00.000Z');
  assert.strictEqual(cuerpo.CreationDateEnd, '2026-10-14T04:59:59.999Z');
  assert.strictEqual(reglas.filtroBusqueda({ numero: ' seds1 ', pagina: '2' }, '1').cuerpo.DocumentNumber, 'SEDS1');
  assert.throws(() => reglas.filtroBusqueda({ desde: '2026-10-10', hasta: '2026-10-01' }, '1'), /posterior/);
  assert.throws(() => reglas.filtroBusqueda({ desde: '2024-01-01', hasta: '2026-01-01' }, '1'), /máximo/);
  assert.throws(() => reglas.filtroBusqueda({ desde: '01/10/2026' }, '1'), /AAAA-MM-DD/);
  assert.deepStrictEqual(['Certified', 'Rejected', 'InProcess', ''].map(reglas.estadoApp), ['aceptado', 'rechazado', 'en_proceso', 'en_proceso']);
  assert.strictEqual(reglas.listaDocumentos({ Items: [1] }).length, 1);
  assert.deepStrictEqual(reglas.listaDocumentos(null), []);
  assert.ok(reglas.perteneceA({ DestinationCode: 'CO_NIT_860031699' }, '860031699'));
  assert.ok(!reglas.perteneceA({ DestinationCode: 'CO_NIT_900' }, '860031699'));
  const [l] = reglas.lineasDto({ Lines: [{ Item: { Description: 'GASTOS' }, GrossAmount: '100.00', TaxTotals: [{ TaxAmount: '19.00' }] }] });
  assert.deepStrictEqual([l.numero, l.descripcion, l.valor, l.iva], [1, 'GASTOS', '100.00', 19]);
  assert.throws(() => reglas.validarId('../x'), /inválido/);
});

test('emitidos: lista, detalle y archivos de la compañía, nunca de otra', async () => {
  const busquedas = [];
  const mock = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      const json = (datos, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(datos)); };
      const ok = (rd) => json({ IsValid: true, Errors: [], Warnings: [], ResultData: rd, ResultCode: 200 });
      if (req.url === '/v2/auth/gettoken') return ok({ access_token: 'tok', expires: new Date(Date.now() + 3600e3).toISOString() });
      assert.strictEqual(req.headers.authorization, 'Bearer tok');
      const base = '/v2/jtc/outbounddocuments';
      if (req.url === `${base}/search`) {
        busquedas.push(JSON.parse(cuerpo));
        // Un documento de otra compañía no debe llegar al navegador aunque Saphety lo devuelva.
        return ok([doc(ID_PROPIO, 'SEDS984003689', 'CO_NIT_860031699'), doc(ID_AJENO, 'X1', 'CO_NIT_900111222')]);
      }
      if (req.url === `${base}/count`) return ok(1);
      if (req.url === `${base}/${ID_PROPIO}`) return ok(doc(ID_PROPIO, 'SEDS984003689', 'CO_NIT_860031699'));
      if (req.url === `${base}/${ID_AJENO}`) return ok(doc(ID_AJENO, 'X1', 'CO_NIT_900111222'));
      if (req.url === `${base}/${ID_PROPIO}/status`) return ok({ Status: 'Certified', ValidationErrors: null });
      if (req.url === `${base}/${ID_PROPIO}/applicationresponses`) return ok([{ ResponseCode: '02', Description: 'Documento validado por la DIAN' }]);
      if (req.url === `${base}/${ID_PROPIO}/dto/content`) return json({ Lines: [{ Item: { Description: 'GASTOS BANCARIOS' }, GrossAmount: '1297130.00' }] });
      if (req.url === `${base}/${ID_PROPIO}/pdf/content`) { res.setHeader('Content-Type', 'application/pdf'); return res.end('%PDF-1.4 prueba'); }
      if (req.url === `${base}/${ID_PROPIO}/ubl/content`) return ok(Buffer.from('<Invoice/>').toString('base64'));
      return json({ IsValid: false, Errors: [{ Code: 'DocumentNotFound' }], ResultData: null }, 400);
    });
  });
  const iniciar = (s) => new Promise((r) => { const x = s.listen(0, '127.0.0.1', () => r(x)); });
  const sMock = await iniciar(mock);
  const sApp = await iniciar(http.createServer(app));
  const URL_APP = `http://127.0.0.1:${sApp.address().port}`;
  const llamar = async (ruta, opciones) => {
    const r = await fetch(URL_APP + ruta, opciones);
    return { status: r.status, tipo: r.headers.get('content-type'), disposicion: r.headers.get('content-disposition'), cuerpo: Buffer.from(await r.arrayBuffer()) };
  };
  const json = async (ruta) => { const r = await llamar(ruta); return { status: r.status, datos: JSON.parse(r.cuerpo.toString()) }; };

  try {
    const [perfil] = (await json('/api/perfiles')).datos;
    const config = { url: `http://127.0.0.1:${sMock.address().port}`, usuario: 'u@test.com', opv: 'jtc' };
    await fetch(`${URL_APP}/api/perfiles/${perfil.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'Vitro', config, clave: 'secreta' }) });

    // Sin NIT no se puede saber qué documentos son de la compañía
    const sinNit = await json('/api/emitidos');
    assert.strictEqual(sinNit.status, 400);
    assert.match(sinNit.datos.error, /NIT/);
    await fetch(`${URL_APP}/api/perfiles/${perfil.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { nit: '860031699' } }) });

    const lista = await json('/api/emitidos?desde=2026-10-01&hasta=2026-10-13&numero=seds984003689');
    assert.strictEqual(lista.status, 200, JSON.stringify(lista.datos));
    assert.deepStrictEqual(lista.datos.documentos.map((d) => [d.numero, d.estado, d.proveedor]), [['SEDS984003689', 'aceptado', 'BANCO DE OCCIDENTE']]);
    assert.strictEqual(lista.datos.total, 1);
    assert.strictEqual(busquedas[0].DocumentNumber, 'SEDS984003689');
    assert.deepStrictEqual(busquedas[0].CustomerCodes, ['CO_NIT_860031699']);

    const detalle = await json(`/api/emitidos/${ID_PROPIO}`);
    assert.strictEqual(detalle.status, 200, JSON.stringify(detalle.datos));
    assert.strictEqual(detalle.datos.documento.cuds, 'cuds-123');
    assert.strictEqual(detalle.datos.documento.consultaDian, 'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=cuds-123');
    assert.strictEqual(detalle.datos.lineas[0].descripcion, 'GASTOS BANCARIOS');
    assert.strictEqual(detalle.datos.respuestas[0].ResponseCode, '02');
    assert.deepStrictEqual(detalle.datos.avisos, []);

    const pdf = await llamar(`/api/emitidos/${ID_PROPIO}/pdf`);
    assert.strictEqual(pdf.status, 200);
    assert.strictEqual(pdf.tipo, 'application/pdf');
    assert.match(pdf.disposicion, /^inline; filename="SEDS984003689.pdf"/);
    assert.strictEqual(pdf.cuerpo.toString(), '%PDF-1.4 prueba');
    // El XML llega envuelto en base64 y se entrega decodificado
    const xml = await llamar(`/api/emitidos/${ID_PROPIO}/xml?descargar=1`);
    assert.match(xml.disposicion, /^attachment/);
    assert.strictEqual(xml.cuerpo.toString(), '<Invoice/>');

    // Documento de otra compañía o inexistente
    assert.strictEqual((await json(`/api/emitidos/${ID_AJENO}`)).status, 404);
    assert.strictEqual((await llamar(`/api/emitidos/${ID_AJENO}/pdf`)).status, 404);
    assert.strictEqual((await json('/api/emitidos/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.strictEqual((await json(`/api/emitidos/${ID_PROPIO}/exe`)).status, 400);
    assert.strictEqual((await json('/api/emitidos/no-es-un-id')).status, 400);
  } finally {
    sApp.close();
    sMock.close();
  }
});
