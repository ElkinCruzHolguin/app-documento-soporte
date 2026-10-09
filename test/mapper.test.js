'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { construirDocumento, calcularDV } = require('../src/dominio/mapper');

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

test('proveedor no residente: ciudad del Excel, capital del país o error', () => {
  const ext = { ...filaResidente, identificacion: 'VVM200921JN2', pais: 'MX', precedencia: 11, tipoDocumento: 42, tipoPersona: 1, municipio: null, departamento: null, codigoPostal: '64410' };
  const r = construirDocumento(ext, CFG);
  assert.deepStrictEqual(r.errores, []);
  assert.strictEqual(r.json.OperationType, '11');
  assert.strictEqual(r.json.SupplierParty.Identification.DocumentType, 'ForeignerCard');
  assert.strictEqual(r.json.SupplierParty.Identification.CheckDigit, undefined);

  // Sin ciudad en el Excel: capital del país, con advertencia (no bloquea el envío)
  const nuevo = { ...ext, identificacion: 'NUEVO123' };
  const porCapital = construirDocumento(nuevo, CFG);
  assert.deepStrictEqual(porCapital.errores, []);
  assert.strictEqual(porCapital.json.SupplierParty.Address.CityName, 'Ciudad de México');
  assert.strictEqual(porCapital.json.SupplierParty.Address.DepartmentName, 'Ciudad de México');
  assert.ok(porCapital.advertencias.some((a) => a.includes('capital del país')));
  const panama = construirDocumento({ ...nuevo, pais: 'PA' }, CFG);
  assert.strictEqual(panama.json.SupplierParty.Address.CityName, 'Ciudad de Panamá');

  // Si el Excel trae la ciudad, se usa esa y no hay aviso
  const conCiudad = construirDocumento({ ...nuevo, municipio: 'Monterrey', departamento: 'Nuevo León' }, CFG);
  assert.strictEqual(conCiudad.json.SupplierParty.Address.CityName, 'Monterrey');
  assert.ok(!conCiudad.advertencias.some((a) => a.includes('capital del país')));

  // Lista completa de países, todos con ciudad y departamento
  const { CAPITALES } = require('../src/dominio/capitales');
  assert.ok(Object.keys(CAPITALES).length >= 240);
  for (const [codigo, u] of Object.entries(CAPITALES)) assert.ok(/^[A-Z]{2}$/.test(codigo) && u.ciudad && u.departamento, codigo);

  // Código de país que no existe: error
  assert.ok(construirDocumento({ ...nuevo, pais: 'ZZ' }, CFG).errores.some((e) => e.includes('no es un país válido')));
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

test('varias filas del mismo folio: una línea excluida de IVA y otra con IVA 19 %', () => {
  const banco = { ...filaResidente, identificacion: 890300279, proveedor: 'BANCO DE OCCIDENTE', tipoPersona: 1, nombre: null, apellidos: null, fechaItem: '2026-08-03' };
  const filas = [
    { ...banco, valor: 1287372, descripcion: 'GMF', excluidoIva: 'SI' },
    { ...banco, valor: 8200, descripcion: 'COMISIÓN', tasaIva: 0.19, baseReteFuente: 8200, tasaReteFuente: 0.04, valorReteFuente: 328 },
  ];
  const { json, errores, resumen } = construirDocumento(filas, CFG);
  assert.deepStrictEqual(errores, []);
  assert.strictEqual(json.Lines.length, 2);
  assert.strictEqual(json.Lines[0].ExcludeVat, 'true');
  assert.strictEqual(json.Lines[0].TaxSubTotals, undefined);
  assert.strictEqual(json.Lines[1].Number, '2');
  assert.deepStrictEqual(json.Lines[1].TaxSubTotals[0], { TaxCategory: '01', TaxPercentage: '19.00', TaxableAmount: '8200.00', TaxAmount: '1558.00' });
  assert.deepStrictEqual(json.TaxSubTotals, json.Lines[1].TaxSubTotals);
  assert.deepStrictEqual(json.Total, { GrossAmount: '1295572.00', TotalBillableAmount: '1297130.00', PayableAmount: '1297130.00', TaxableAmount: '8200.00' });
  assert.deepStrictEqual(json.WithholdingTaxTotals, [{ WithholdingTaxCategory: '06', TaxAmount: '328.00' }]);
  assert.strictEqual(resumen.valor, 1297130);
  assert.strictEqual(resumen.lineas, 2);
});

test('filas del mismo folio con proveedor distinto', () => {
  const { errores } = construirDocumento([filaResidente, { ...filaResidente, identificacion: 901549995 }], CFG);
  assert.ok(errores.some((e) => e.includes('Línea 2: CEDULA O NIT')));
});

test('mensaje de Saphety: incluye el campo y no repite errores iguales', () => {
  const { mensajeRespuesta } = require('../src/infraestructura/saphety');
  const e = { Code: 'NotFound', Field: 'SupportDocument.serieExternalKey', Description: null, ExplanationValues: [] };
  assert.strictEqual(mensajeRespuesta({ Errors: [e, { ...e }] }), 'NotFound: SupportDocument.serieExternalKey');
});

test('avisos de reglas DIAN: código postal (DSAJ08a) y fecha por operación (DSFC02b)', () => {
  const { advertencias } = construirDocumento({ ...filaResidente, codigoPostal: null }, CFG);
  assert.ok(advertencias.some((a) => a.includes('DSAJ08a')));
  assert.ok(advertencias.some((a) => a.includes('DSFC02b')), 'FECHA_DOC 2026-08-03 no es hoy');
  const hoy = construirDocumento(filaResidente, { ...CFG, fechaEmision: 'hoy' });
  assert.ok(!hoy.advertencias.some((a) => a.includes('DSFC02b')));
});
