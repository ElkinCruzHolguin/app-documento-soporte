'use strict';
// Buzón de recepción y eventos RADIAN contra una API de Saphety falsa (local).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-recibidos-'));
const { app } = require('../src/server');
const reglas = require('../src/dominio/recibidos');

const ID_PROPIO = '5d1c2a10-9b7e-4c3a-8f21-0a1b2c3d4e5f';
const ID_AJENO = '6e2d3b21-ac8f-4d4b-9032-1b2c3d4e5f60';
const doc = (id, numero, destino, estado = 'Registered') => ({
  Id: id, DocumentType: 'SalesInvoice', DocumentNumber: numero, OriginName: 'PROVEEDOR SAS', OriginCode: 'CO_NIT_900123456',
  DestinationName: 'Vitro', DestinationCode: destino, DocumentDate: '2026-10-01T10:00:00Z', CreationDate: '2026-10-01T10:05:00Z',
  DocumentStatus: estado, Currency: 'COP', TotalAmount: 119000, TotalTaxableAmount: 100000, VatTotalAmount: 19000, Cufe: 'cufe-abc',
});

test('reglas: filtro, estados y eventos permitidos', () => {
  const { cuerpo } = reglas.filtroBusqueda({ proveedor: '900.123.456', estado: 'pendientes', numero: ' fe1 ' }, { companyId: 'c-1' }, new Date('2026-10-13T15:00:00Z'));
  assert.deepStrictEqual(cuerpo.DocumentTypes, ['SalesInvoice', 'CreditNote', 'DebitNote']);
  assert.deepStrictEqual(cuerpo.CompanyIds, ['c-1']);
  assert.deepStrictEqual(cuerpo.SuppliersCodes, ['CO_NIT_900123456']);
  assert.deepStrictEqual(cuerpo.DocumentStatus, ['Registered', 'Received', 'GoodsOrServicesReceived']);
  assert.strictEqual(cuerpo.DocumentNumber, 'FE1');
  assert.ok(!('CompanyIds' in reglas.filtroBusqueda({}, {}).cuerpo));
  assert.throws(() => reglas.filtroBusqueda({ estado: 'otro' }, {}), /Estado inválido/);
  assert.deepStrictEqual(reglas.eventosPermitidos('Registered'), ['acuse']);
  assert.deepStrictEqual(reglas.eventosPermitidos('Received'), ['reciboBien']);
  assert.deepStrictEqual(reglas.eventosPermitidos('GoodsOrServicesReceived'), ['aceptar', 'rechazar']);
  assert.deepStrictEqual(reglas.eventosPermitidos('Accepted'), []);
  assert.ok(reglas.esAdquiriente({ DestinationCode: 'CO_NIT_860031699' }, '860.031.699'));
  assert.ok(!reglas.esAdquiriente({ DestinationCode: 'CO_NIT_900' }, '860031699'));
  assert.throws(() => reglas.datosEvento('acuse', { persona: { nombre: 'Ana' } }), /nombre, apellido y documento/);
  const { persona } = reglas.datosEvento('acuse', { persona: { nombre: 'Ana', apellido: 'Gómez', documento: '1.020.304' } });
  assert.deepStrictEqual(persona.Identification, { DocumentNumber: '1020304', DocumentType: 'CC', CountryCode: 'CO' });
  assert.throws(() => reglas.datosEvento('rechazar', {}), /concepto/);
  assert.deepStrictEqual(reglas.datosEvento('rechazar', { concepto: '04' }).motivo, 'Servicio no prestado');
  assert.throws(() => reglas.datosEvento('borrar', {}), /Evento inválido/);
});

test('recibidos: lista, detalle, archivos y eventos solo de la compañía', async () => {
  const llamadas = [];
  let estado = 'Registered';
  const mock = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      const json = (datos, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(datos)); };
      const ok = (rd) => json({ IsValid: true, Errors: [], Warnings: [], ResultData: rd, ResultCode: 200 });
      if (req.url === '/v2/auth/gettoken') return ok({ access_token: 'tok', expires: new Date(Date.now() + 3600e3).toISOString() });
      llamadas.push({ metodo: req.method, url: req.url, cuerpo: cuerpo && JSON.parse(cuerpo) });
      const base = '/v2/jtc/inbounddocuments';
      if (req.url === `${base}/search`) return ok({ Items: [doc(ID_PROPIO, 'FE100', 'CO_NIT_860031699', estado), doc(ID_AJENO, 'X1', 'CO_NIT_900111222')], Total: 2 });
      if (req.url === `${base}/count`) return json({ IsValid: false, Errors: [{ Code: 'Boom' }] }, 500);
      if (req.url === `${base}/${ID_PROPIO}`) return ok(doc(ID_PROPIO, 'FE100', 'CO_NIT_860031699', estado));
      if (req.url === `${base}/${ID_AJENO}`) return ok(doc(ID_AJENO, 'X1', 'CO_NIT_900111222'));
      if (req.url === `${base}/${ID_PROPIO}/applicationresponses`) return ok([{ ResponseCode: '030', Description: 'Acuse' }]);
      if (req.url === `${base}/${ID_PROPIO}/pdf`) return ok({ Content: Buffer.from('%PDF-1.4 recibido').toString('base64') });
      if (req.url === `${base}/${ID_PROPIO}/ubl`) return ok(Buffer.from('<Invoice/>').toString('base64'));
      if (req.url === `${base}/${ID_PROPIO}/receive` && req.method === 'POST') { estado = 'Received'; return ok(true); }
      return json({ IsValid: false, Errors: [{ Code: 'DocumentNotFound' }], ResultData: null }, 400);
    });
  });
  const iniciar = (s) => new Promise((r) => { const x = s.listen(0, '127.0.0.1', () => r(x)); });
  const sMock = await iniciar(mock);
  const sApp = await iniciar(http.createServer(app));
  const URL_APP = `http://127.0.0.1:${sApp.address().port}`;
  const llamar = async (ruta, opciones) => {
    const r = await fetch(URL_APP + ruta, opciones);
    return { status: r.status, tipo: r.headers.get('content-type'), cuerpo: Buffer.from(await r.arrayBuffer()) };
  };
  const json = async (ruta, opciones) => { const r = await llamar(ruta, opciones); return { status: r.status, datos: JSON.parse(r.cuerpo.toString()) }; };
  const enviarEvento = (id, cuerpo) => json(`/api/recibidos/${id}/eventos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const persona = { nombre: 'Ana', apellido: 'Gómez', documento: '1020304' };

  try {
    const [perfil] = (await json('/api/perfiles')).datos;
    const actualizar = (datos) => fetch(`${URL_APP}/api/perfiles/${perfil.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) });
    await actualizar({ nombre: 'Vitro', config: { url: `http://127.0.0.1:${sMock.address().port}`, usuario: 'u@test.com', opv: 'jtc', nit: '860031699' }, clave: 'secreta' });

    // El conteo falla pero la lista sale con el Total de la búsqueda; el documento ajeno no llega
    const lista = await json('/api/recibidos?estado=pendientes');
    assert.strictEqual(lista.status, 200, JSON.stringify(lista.datos));
    assert.deepStrictEqual(lista.datos.documentos.map((d) => [d.numero, d.estadoTexto, d.eventos]), [['FE100', 'Recibido en buzón', ['acuse']]]);
    assert.strictEqual(lista.datos.total, 2);

    const detalle = await json(`/api/recibidos/${ID_PROPIO}`);
    assert.strictEqual(detalle.status, 200, JSON.stringify(detalle.datos));
    assert.strictEqual(detalle.datos.documento.iva, 19000);
    assert.strictEqual(detalle.datos.modoEnvio, 'simulado');
    assert.strictEqual(detalle.datos.respuestas[0].ResponseCode, '030');

    // PDF y XML llegan en base64 y se entregan decodificados
    const pdf = await llamar(`/api/recibidos/${ID_PROPIO}/pdf`);
    assert.strictEqual(pdf.tipo, 'application/pdf');
    assert.strictEqual(pdf.cuerpo.toString(), '%PDF-1.4 recibido');
    assert.strictEqual((await llamar(`/api/recibidos/${ID_PROPIO}/xml`)).cuerpo.toString(), '<Invoice/>');

    // Documento de otra compañía
    assert.strictEqual((await json(`/api/recibidos/${ID_AJENO}`)).status, 404);
    assert.strictEqual((await llamar(`/api/recibidos/${ID_AJENO}/pdf`)).status, 404);

    // En modo simulado ningún evento sale a Saphety
    const simulado = await enviarEvento(ID_PROPIO, { tipo: 'acuse', confirmado: true, persona });
    assert.strictEqual(simulado.status, 400);
    assert.match(simulado.datos.error, /simulado/);
    await actualizar({ config: { modoEnvio: 'real' } });

    // Sin confirmación, con el evento que no corresponde o sobre un documento ajeno: no se envía
    assert.match((await enviarEvento(ID_PROPIO, { tipo: 'acuse', persona })).datos.error, /Confirma/);
    assert.strictEqual((await enviarEvento(ID_PROPIO, { tipo: 'aceptar', confirmado: true })).status, 409);
    assert.strictEqual((await enviarEvento(ID_AJENO, { tipo: 'acuse', confirmado: true, persona })).status, 404);
    assert.ok(!llamadas.some((l) => l.metodo === 'POST' && /receive|accept|reject|goodsreceived/.test(l.url)));

    const acuse = await enviarEvento(ID_PROPIO, { tipo: 'acuse', confirmado: true, persona });
    assert.strictEqual(acuse.status, 200, JSON.stringify(acuse.datos));
    assert.strictEqual(acuse.datos.documento.estadoSaphety, 'Received');
    assert.deepStrictEqual(acuse.datos.documento.eventos, ['reciboBien']);
    const enviado = llamadas.find((l) => l.url.endsWith('/receive'));
    assert.strictEqual(enviado.cuerpo.FirstName, 'Ana');
    assert.strictEqual(enviado.cuerpo.Identification.DocumentNumber, '1020304');
  } finally {
    sApp.close();
    sMock.close();
  }
});
