'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { construirDocumento, calcularDV } = require('../src/mapper');

const CFG = { nit: '860031699', digitoVerificacion: '0', serieExternalKeyDS: 'CLAVE', emailProveedorDefecto: 'ds@empresa.com' };

const filaResidente = {
  tipo: 'DSE', numOrden: 4800598490, moneda: 'COP', fechaDoc: '2026-08-03', identificacion: 1026142589,
  proveedor: 'SUAREZ FELIPE', valor: 80000, codigoProducto: 'DES01', conceptoLinea: 1, prefijoFolio: 7460,
  descripcion: 'SERVICIO DE DESCARGUE', fechaItem: '2026-07-15', nitEmisor: 860031699, observacion: 4800598490,
  tipoPersona: 2, nombre: 'FELIPE', apellidos: 'SUAREZ', direccion: 'CRA 3 ESTE NO.6B-41', municipio: 25175,
  departamento: 25, pais: 'CO', codigoPostal: 250001, telefono: '0', tipoDocumento: 31, regimenFiscal: 49,
  obligacionesFiscales: 'R-99-PN', obligacionesImpuesto: 'ZZ', precedencia: 10, prefijo: 'DSE',
};

test('dígito de verificación DIAN', () => {
  assert.strictEqual(calcularDV('860031699'), '0');
  assert.strictEqual(calcularDV('900024398'), '4');
  assert.strictEqual(calcularDV('860002964'), '4');
});

test('fila de proveedor residente persona natural', () => {
  const { json, errores } = construirDocumento(filaResidente, CFG);
  assert.deepStrictEqual(errores, []);
  assert.strictEqual(json.SeriePrefix, 'DSE');
  assert.strictEqual(json.SerieNumber, '7460');
  assert.strictEqual(json.CorrelationDocumentId, 'DSE7460');
  assert.strictEqual(json.OperationType, '10');
  assert.ok(json.IssueDate.startsWith('2026-08-03T'));
  assert.strictEqual(json.Lines[0].InvoicePeriod.From, '2026-08-03', 'con concepto 1 el periodo es la fecha de emisión');
  assert.strictEqual(json.SupplierParty.LegalType, 'Natural');
  assert.strictEqual(json.SupplierParty.Identification.CheckDigit, calcularDV('1026142589'));
  assert.strictEqual(json.SupplierParty.Address.CityCode, '25175');
  assert.strictEqual(json.SupplierParty.Telephone, undefined, 'teléfono 0 no se envía');
  assert.strictEqual(json.Total.PayableAmount, '80000.00');
  assert.match(json.Notes[0], /Fecha del servicio: 2026-07-15/);
});

test('códigos con ceros a la izquierda y municipio que no corresponde', () => {
  const ok = construirDocumento({ ...filaResidente, municipio: 5001, departamento: 5, codigoPostal: 50048 }, CFG);
  assert.strictEqual(ok.json.SupplierParty.Address.DepartmentCode, '05');
  assert.strictEqual(ok.json.SupplierParty.Address.CityCode, '05001');
  assert.strictEqual(ok.json.SupplierParty.Address.PostalCode, '050048');
  const mal = construirDocumento({ ...filaResidente, municipio: 11001 }, CFG);
  assert.ok(mal.errores.some((e) => e.includes('no pertenece')));
});

test('retención en la fuente con tasa decimal', () => {
  const { json, errores } = construirDocumento({ ...filaResidente, baseReteFuente: 1350000, tasaReteFuente: 0.035, valorReteFuente: 47250.00000000001 }, CFG);
  assert.deepStrictEqual(errores, []);
  assert.deepStrictEqual(json.WithholdingTaxSubTotals[0], { WithholdingTaxCategory: '06', TaxPercentage: '3.50', TaxableAmount: '1350000.00', TaxAmount: '47250.00' });
  assert.strictEqual(json.Total.PayableAmount, '80000.00');
});

test('proveedor no residente: ciudad por tabla de proveedor, por país o error', () => {
  const ext = { ...filaResidente, identificacion: 'VVM200921JN2', pais: 'MX', precedencia: 11, tipoDocumento: 42, tipoPersona: 1, municipio: null, departamento: null, codigoPostal: '64410' };
  const porProveedor = construirDocumento(ext, CFG);
  assert.deepStrictEqual(porProveedor.errores, []);
  assert.strictEqual(porProveedor.json.OperationType, '11');
  assert.strictEqual(porProveedor.json.SupplierParty.Identification.DocumentType, 'ForeignerCard');
  assert.strictEqual(porProveedor.json.SupplierParty.Identification.CheckDigit, undefined);
  assert.strictEqual(porProveedor.json.SupplierParty.Address.CityName, 'Monterrey');
  assert.strictEqual(porProveedor.json.SupplierParty.Address.DepartmentName, 'Nuevo León');

  const nuevo = { ...ext, identificacion: 'NUEVO123' };
  assert.ok(construirDocumento(nuevo, CFG).errores.some((e) => e.includes('falta ciudad')));
  const porPais = construirDocumento(nuevo, { ...CFG, ubicacionesExtranjeros: { MX: { ciudad: 'Ciudad de México', departamento: 'Ciudad de México' } } });
  assert.deepStrictEqual(porPais.errores, []);
  assert.strictEqual(porPais.json.SupplierParty.Address.CityName, 'Ciudad de México');
});

test('validaciones de configuración', () => {
  const r = construirDocumento(filaResidente, { ...CFG, serieExternalKeyDS: '', digitoVerificacion: '5', emailProveedorDefecto: '' });
  assert.ok(r.errores.some((e) => e.includes('SerieExternalKey')));
  assert.ok(r.errores.some((e) => e.includes('dígito de verificación')));
  assert.ok(r.errores.some((e) => e.includes('correo')));
});

test('numeración forzada (consecutivo de pruebas)', () => {
  const { json } = construirDocumento(filaResidente, CFG, { numeracion: { prefijo: 'SEDS', numero: '984000010' } });
  assert.strictEqual(json.SeriePrefix, 'SEDS');
  assert.strictEqual(json.CorrelationDocumentId, 'SEDS984000010');
});
