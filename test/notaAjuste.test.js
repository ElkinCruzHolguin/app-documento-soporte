'use strict';
// Nota de ajuste al documento soporte: reglas y flujo contra una API de Saphety falsa (local).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-nota-'));
const { app } = require('../src/server');
const reglas = require('../src/dominio/notaAjuste');

const ID_DS = '40120177-845e-4612-bbe1-9acb34207927';
const ID_SIN_ACEPTAR = '742b3857-8adb-4e48-afec-2e165303ccb6';
const CFG = { nit: '860031699', serieExternalKeyNotaAjuste: 'clave-nads', prefijoNotaAjuste: 'NADS', siguienteNotaAjuste: 7 };
const REF = { numero: 'SEDS984003689', fecha: '2026-10-01T10:00:00Z', cuds: 'cuds-123' };

// JSON de un documento soporte como lo arma la app: una línea con IVA 19 % y ReteFuente 4 %, otra sin IVA.
const ORIGINAL = {
  Currency: 'COP',
  OperationType: '10',
  PaymentMeans: [{ Code: '1', Mean: '1', DueDate: '2026-10-01' }],
  CustomerParty: { Identification: { DocumentNumber: '860031699', DocumentType: 'NIT', CountryCode: 'CO', CheckDigit: '0' } },
  SupplierParty: { Name: 'TOBON MAZO JOSE ALBERTO', Identification: { DocumentNumber: '70000001', DocumentType: 'NIT', CountryCode: 'CO', CheckDigit: '1' } },
  Lines: [
    {
      Number: '1', Quantity: '1.00', QuantityUnitOfMeasure: 'NAR', UnitPrice: '1000.00', GrossAmount: '1000.00', NetAmount: '1000.00',
      Item: { Description: 'HONORARIOS' }, InvoicePeriod: { From: '2026-10-01', DescriptionCode: '1' },
      TaxSubTotals: [{ TaxCategory: '01', TaxPercentage: '19.00', TaxableAmount: '1000.00', TaxAmount: '190.00' }],
      TaxTotals: [{ TaxCategory: '01', TaxAmount: '190.00', RoundingAmount: '0.00' }],
      WithholdingTaxSubTotals: [{ WithholdingTaxCategory: '06', TaxPercentage: '4.00', TaxableAmount: '1000.00', TaxAmount: '40.00' }],
      WithholdingTaxTotals: [{ WithholdingTaxCategory: '06', TaxAmount: '40.00' }],
    },
    {
      Number: '2', Quantity: '1.00', QuantityUnitOfMeasure: 'NAR', UnitPrice: '500.00', GrossAmount: '500.00', NetAmount: '500.00',
      Item: { Description: 'TRANSPORTE' }, InvoicePeriod: { From: '2026-10-01', DescriptionCode: '1' }, ExcludeVat: 'true',
    },
  ],
};
const AHORA = new Date('2026-10-14T15:00:00Z'); // 10:00 en Bogotá

test('reglas: anulación total copia las líneas y referencia el documento original', () => {
  const pedido = { concepto: '2', motivo: 'Se anula por error en el proveedor', lineas: [{ numero: '1', valor: 1000 }, { numero: '2', valor: 500 }] };
  const { json, errores, resumen } = reglas.construirNotaAjuste(ORIGINAL, REF, pedido, CFG, { ahora: AHORA });
  assert.deepStrictEqual(errores, []);
  assert.strictEqual(json.ReasonCredit, '2');
  assert.strictEqual(`${json.SeriePrefix}${json.SerieNumber}`, 'NADS7');
  assert.strictEqual(json.SerieExternalKey, 'clave-nads');
  assert.strictEqual(json.IssueDate, '2026-10-14T10:00:00');
  assert.deepStrictEqual(json.DocumentReferences, [{ DocumentReferred: 'SEDS984003689', IssueDate: '2026-10-01T10:00:00', Type: 'InvoiceReference', DocumentReferredCUFE: 'cuds-123' }]);
  assert.deepStrictEqual(json.SupplierParty, ORIGINAL.SupplierParty);
  assert.deepStrictEqual(json.Total, { GrossAmount: '1500.00', TotalBillableAmount: '1690.00', PayableAmount: '1690.00', TaxableAmount: '1000.00' });
  assert.deepStrictEqual(json.WithholdingTaxTotals, [{ WithholdingTaxCategory: '06', TaxAmount: '40.00' }]);
  assert.strictEqual(json.Lines[1].ExcludeVat, 'true');
  // DSFC02b: el periodo de cada línea es la fecha de emisión de la nota.
  assert.deepStrictEqual(json.Lines.map((l) => l.InvoicePeriod), [{ From: '2026-10-14', DescriptionCode: '1' }, { From: '2026-10-14', DescriptionCode: '1' }]);
  assert.deepStrictEqual(json.Notes, ['Se anula por error en el proveedor']);
  assert.strictEqual(resumen.valor, 1690);
  // El original no se modifica.
  assert.strictEqual(ORIGINAL.Lines[0].InvoicePeriod.From, '2026-10-01');
});

test('reglas: ajuste parcial recalcula IVA y retenciones en proporción', () => {
  const pedido = { concepto: '4', motivo: 'Ajuste de precio', lineas: [{ numero: '1', valor: 250 }] };
  const { json, errores } = reglas.construirNotaAjuste(ORIGINAL, REF, pedido, CFG, { ahora: AHORA });
  assert.deepStrictEqual(errores, []);
  assert.strictEqual(json.Lines.length, 1);
  const [l] = json.Lines;
  assert.deepStrictEqual([l.Quantity, l.UnitPrice, l.GrossAmount], ['1.00', '250.00', '250.00']);
  assert.deepStrictEqual(l.TaxSubTotals, [{ TaxCategory: '01', TaxPercentage: '19.00', TaxableAmount: '250.00', TaxAmount: '47.50' }]);
  assert.deepStrictEqual(l.WithholdingTaxSubTotals, [{ WithholdingTaxCategory: '06', TaxPercentage: '4.00', TaxableAmount: '250.00', TaxAmount: '10.00' }]);
  assert.deepStrictEqual(json.Total, { GrossAmount: '250.00', TotalBillableAmount: '297.50', PayableAmount: '297.50', TaxableAmount: '250.00' });
});

test('reglas: errores de la nota', () => {
  const r = reglas.construirNotaAjuste(ORIGINAL, { numero: 'X' }, { lineas: [{ numero: '1', valor: 2000 }, { numero: '9', valor: 1 }] }, { ...CFG, serieExternalKeyNotaAjuste: '' });
  const texto = r.errores.join('\n');
  for (const esperado of [/concepto/, /motivo/, /SerieExternalKey/, /CUDS/, /supera el valor original/, /línea 9 no existe/]) assert.match(texto, esperado);
  assert.match(reglas.construirNotaAjuste(ORIGINAL, REF, { concepto: '5', motivo: 'x'.repeat(561), lineas: [{ numero: '2', valor: 1 }] }, CFG).errores[0], /560/);
  assert.match(reglas.construirNotaAjuste(ORIGINAL, REF, { concepto: '5', motivo: 'x', lineas: [] }, CFG).errores[0], /al menos una línea/);
  assert.strictEqual(reglas.documentoOriginal({ Document: ORIGINAL }), ORIGINAL);
  assert.strictEqual(reglas.documentoOriginal({ Lines: [] }), null);
  assert.throws(() => reglas.exigirOriginal(null), /documento soporte original/);
  assert.deepStrictEqual(reglas.conceptos(null), reglas.CONCEPTOS);
  assert.deepStrictEqual(reglas.conceptos([{ Code: '2', Description: 'Anulación' }]), [{ codigo: '2', nombre: 'Anulación' }]);
});

test('nota de ajuste: simulada y real contra Saphety, con número propio e historial', async () => {
  const creadas = [];
  const doc = (id, estado) => ({
    Id: id, DocumentType: 'SupportDocument', DocumentNumber: 'SEDS984003689', OriginName: 'TOBON', OriginCode: 'CO_NIT_70000001',
    DestinationName: 'Vitro', DestinationCode: 'CO_NIT_860031699', DocumentDate: '2026-10-01T10:00:00Z', DocumentStatus: estado, Cufe: 'cuds-123',
  });
  const mock = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      const json = (datos, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(datos)); };
      const ok = (rd) => json({ IsValid: true, Errors: [], Warnings: [], ResultData: rd, ResultCode: 200 });
      if (req.url === '/v2/auth/gettoken') return ok({ access_token: 'tok', expires: new Date(Date.now() + 3600e3).toISOString() });
      const base = '/v2/jtc/outbounddocuments';
      if (req.url === `${base}/${ID_DS}`) return ok(doc(ID_DS, 'Certified'));
      if (req.url === `${base}/${ID_SIN_ACEPTAR}`) return ok(doc(ID_SIN_ACEPTAR, 'Rejected'));
      // El DTO de Saphety trae el documento dentro de "Document".
      if (req.url === `${base}/${ID_DS}/dto/content`) return json({ Document: ORIGINAL });
      if (req.url === '/v2/dataelements/creditnotereasons') return json({ IsValid: false }, 500);
      if (req.url === `${base}/supportDocumentAdjust` && req.method === 'POST') {
        creadas.push(JSON.parse(cuerpo));
        return ok({ Id: 'id-nota', CUFE: 'cuds-nota' });
      }
      return json({ IsValid: false, Errors: [{ Code: 'NotFound' }], ResultData: null }, 404);
    });
  });
  const iniciar = (s) => new Promise((r) => { const x = s.listen(0, '127.0.0.1', () => r(x)); });
  const sMock = await iniciar(mock);
  const sApp = await iniciar(http.createServer(app));
  const URL_APP = `http://127.0.0.1:${sApp.address().port}`;
  const pedir = async (ruta, cuerpo) => {
    const r = await fetch(URL_APP + ruta, cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) } : undefined);
    return { status: r.status, datos: await r.json() };
  };
  const guardar = (config) => fetch(`${URL_APP}/api/perfiles/${perfil.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'Vitro', config, clave: 'secreta' }) });
  let perfil;
  try {
    [perfil] = (await pedir('/api/perfiles')).datos;
    const config = { ...CFG, url: `http://127.0.0.1:${sMock.address().port}`, usuario: 'u@test.com', opv: 'jtc' };
    await guardar(config);

    const ruta = `/api/emitidos/${ID_DS}/nota-ajuste`;
    const prep = await pedir(ruta);
    assert.strictEqual(prep.status, 200, JSON.stringify(prep.datos));
    assert.strictEqual(prep.datos.fuente, 'saphety');
    assert.strictEqual(prep.datos.referencia.numero, 'SEDS984003689');
    assert.deepStrictEqual(prep.datos.lineas.map((l) => [l.numero, l.valor, l.iva]), [['1', 1000, 190], ['2', 500, 0]]);
    assert.deepStrictEqual(prep.datos.conceptos, reglas.CONCEPTOS); // el catálogo falló: lista de la DIAN
    assert.deepStrictEqual(prep.datos.serie, { prefijo: 'NADS', siguiente: 7, configurada: true });

    // Solo documentos soporte aceptados; la ruta de archivos sigue funcionando para los demás formatos.
    assert.strictEqual((await pedir(`/api/emitidos/${ID_SIN_ACEPTAR}/nota-ajuste`)).status, 400);

    const pedido = { concepto: '2', motivo: 'Anulación por prueba', lineas: [{ numero: '1', valor: 1000 }, { numero: '2', valor: 500 }] };
    const sim = await pedir(ruta, pedido);
    assert.strictEqual(sim.datos.estado, 'simulado');
    assert.strictEqual(sim.datos.numero, 'NADS7');
    assert.strictEqual(creadas.length, 0);

    const conErrores = await pedir(ruta, { ...pedido, motivo: '' });
    assert.strictEqual(conErrores.datos.estado, 'con_errores');

    await guardar({ ...config, modoEnvio: 'real' });
    assert.strictEqual((await pedir(ruta, pedido)).status, 400); // sin confirmación
    const real = await pedir(ruta, { ...pedido, confirmado: true });
    assert.strictEqual(real.status, 200, JSON.stringify(real.datos));
    assert.strictEqual(real.datos.estado, 'aceptado');
    assert.strictEqual(real.datos.numero, 'NADS7');
    assert.strictEqual(creadas.length, 1);
    assert.strictEqual(creadas[0].DocumentReferences[0].DocumentReferredCUFE, 'cuds-123');
    assert.ok(real.datos.envioId);

    // El número sube solo con envíos reales, y la nota queda en el historial.
    const [p2] = (await pedir('/api/perfiles')).datos;
    assert.strictEqual(p2.config.siguienteNotaAjuste, 8);
    const historial = await pedir('/api/envios');
    assert.ok(historial.datos.some((e) => e.numero === 'NADS7' && /Nota de ajuste a SEDS984003689/.test(e.mensaje)));
  } finally {
    sApp.close();
    sMock.close();
  }
});
