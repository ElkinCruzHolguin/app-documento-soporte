'use strict';
// Prueba de punta a punta contra una API de Saphety falsa (local): carga de
// Excel, envío simulado, envío "real" (token + documento) y consecutivo de pruebas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const ExcelJS = require('exceljs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-test-'));
const { app } = require('../src/server');

const ENCABEZADOS = ['TIPO', 'NUMORDEN', 'MONEDA', 'FECHA_DOC', 'CEDULA O NIT', 'PROVEEDOR', 'VALOR_TOTAL ITEM', 'IDENTIFICACION PRODUCTO',
  'CONCEPTO LINEA', 'PREFIJO + FOLIO', 'DESCRIPCION', 'FECHA_ITEM', 'NIT EMISOR', 'OBSERVACION', 'TIPO PERSONA NATURAL 2 -  JURIDICA - 1',
  'NOMBRE', 'SEGUNDO NOMBRE', 'APELLIDOS', 'DIRECCION', 'MUNICIPIO', 'DEPARTAMENTO', 'PAIS', 'CODIGO POSTAL', 'TELEFONO', 'TIPO DE DOCUMENTO',
  'REGIMEN FISCAL', 'OBLIGACIONES FISCALES', 'OBLIGACIONES IMPUESTO', 'PRECEDENCIA 10 RESIDENTE - 11 NO RESIDENTE', 'Prefijo', 'Folio'];

async function excelDePrueba() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja');
  ws.addRow(ENCABEZADOS);
  const fecha = new Date(Date.UTC(2026, 7, 3));
  ws.addRow(['DSE', 1, 'COP', fecha, 1026142589, 'SUAREZ FELIPE', 80000, 'DES01', 1, 7460, 'SERVICIO', fecha, 860031699, 1, 2, 'FELIPE', null, 'SUAREZ', 'CRA 3', 25175, 25, 'CO', 250001, '0', 31, 49, 'R-99-PN', 'ZZ', 10, 'DSE', null]);
  ws.addRow(['DSE', 1, 'COP', fecha, 901549995, 'UBER COLOMBIA', 20000, 'TRA01', 1, 7461, 'TRANSPORTE', fecha, 860031699, 1, 1, null, null, null, 'CL 1', '05001', '05', 'CO', '050001', '0', 31, 49, 'R-99-PN', 'ZZ', 10, 'DSE', null]);
  ws.addRow(['DSE', 1, 'COP', fecha, 'X1', 'SIN DIRECCION', 0, 'TRA01', 1, 7462, 'MALA', fecha, 860031699, 1, 1, null, null, null, null, '05001', '05', 'CO', '050001', '0', 31, 49, 'R-99-PN', 'ZZ', 10, 'DSE', null]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function iniciar(servidor) {
  return new Promise((resolve) => { const s = servidor.listen(0, '127.0.0.1', () => resolve(s)); });
}

test('flujo completo', async () => {
  // --- API falsa de Saphety
  const recibidos = [];
  const mock = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v2/auth/gettoken') {
        const b = JSON.parse(cuerpo);
        if (b.username !== 'user@test.com' || b.password !== 'secreta' || b.virtual_operator !== 'jtc') {
          res.statusCode = 401; return res.end(JSON.stringify({ IsValid: false, Errors: [{ Description: 'Credenciales inválidas' }] }));
        }
        return res.end(JSON.stringify({ ResultData: { access_token: 'tok-1', expires: new Date(Date.now() + 3600e3).toISOString(), token_type: 'bearer' } }));
      }
      if (req.url === '/v2/jtc/outbounddocuments/supportDocument') {
        assert.strictEqual(req.headers.authorization, 'Bearer tok-1');
        const doc = JSON.parse(cuerpo);
        recibidos.push(doc);
        const rechazar = doc.SerieNumber === '7461';
        return res.end(JSON.stringify({
          IsValid: !rechazar,
          Errors: rechazar ? [{ Code: 'DIAN_99', Description: 'Validación contiene errores', ExplanationValues: ['Regla: X'] }] : [],
          Warnings: [],
          ResultData: { Id: `id-${doc.SerieNumber}`, CorrelationDocumentId: doc.CorrelationDocumentId, CUFE: 'cuds', Content: Buffer.from('<Invoice/>').toString('base64') },
          ResultCode: rechazar ? 400 : 200,
        }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  const sMock = await iniciar(mock);
  const sApp = await iniciar(http.createServer(app));
  const URL_APP = `http://127.0.0.1:${sApp.address().port}`;
  const llamar = async (ruta, opciones = {}) => {
    const r = await fetch(URL_APP + ruta, opciones);
    const t = await r.text();
    try { return { status: r.status, datos: JSON.parse(t) }; } catch { throw new Error(`${ruta} -> ${r.status}: ${t.slice(0, 400)}`); }
  };
  const esperar = async (loteId) => {
    for (let i = 0; i < 100; i++) {
      const { datos } = await llamar(`/api/lotes/${loteId}`);
      if (!datos.enviando) return datos;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('El envío no terminó');
  };

  try {
    // Perfil con la contraseña cifrada; nunca vuelve al navegador.
    const [perfil] = (await llamar('/api/perfiles')).datos;
    const config = { url: `http://127.0.0.1:${sMock.address().port}`, usuario: 'user@test.com', opv: 'jtc', nit: '860031699', digitoVerificacion: '0', serieExternalKeyDS: 'CLAVE', emailProveedorDefecto: 'ds@empresa.com' };
    const act = await llamar(`/api/perfiles/${perfil.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'Prueba', config, clave: 'secreta' }) });
    assert.strictEqual(act.status, 200);
    assert.strictEqual(act.datos.tieneClave, true);
    assert.ok(!JSON.stringify(act.datos).includes('secreta'));

    const prueba = await llamar(`/api/perfiles/${perfil.id}/probar`, { method: 'POST' });
    assert.strictEqual(prueba.status, 200, JSON.stringify(prueba.datos));

    // Conversión del Excel: no se guarda nada en el servidor
    const conv = await llamar('/api/convertir', { method: 'POST', body: await excelDePrueba() });
    assert.strictEqual(conv.status, 200, JSON.stringify(conv.datos));
    const docs = conv.datos.documentos;
    assert.deepStrictEqual(docs.map((d) => d.errores.length > 0), [false, false, true]);
    assert.strictEqual(docs[0].json.CorrelationDocumentId, 'DSE7460');
    assert.deepStrictEqual(fs.readdirSync(process.env.DATA_DIR).sort(), ['.secreto', 'parametros.json']);

    const enviar = (d, extra = {}) => llamar('/api/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datos: d.datos, ...extra }) });

    // Envío simulado: no llega nada a la API
    const sim = await enviar(docs[0]);
    assert.strictEqual(sim.datos.estado, 'simulado');
    assert.strictEqual(recibidos.length, 0);
    const conErr = await enviar(docs[2]);
    assert.strictEqual(conErr.datos.estado, 'con_errores');

    // Envío real: exige confirmación
    await llamar(`/api/perfiles/${perfil.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { modoEnvio: 'real' } }) });
    assert.strictEqual((await enviar(docs[0])).status, 400);
    const ok = await enviar(docs[0], { confirmado: true });
    assert.strictEqual(ok.datos.estado, 'aceptado');
    assert.strictEqual(ok.datos.saphetyId, 'id-7460');
    assert.strictEqual(Buffer.from(ok.datos.respuesta.ResultData.Content, 'base64').toString(), '<Invoice/>');
    const mal = await enviar(docs[1], { confirmado: true });
    assert.strictEqual(mal.datos.estado, 'rechazado');
    assert.match(mal.datos.mensaje, /DIAN_99/);
    assert.strictEqual(recibidos.length, 2);

    // Historial: los envíos reales quedan guardados y un número aceptado no se reenvía
    const hist = (await llamar('/api/envios')).datos;
    assert.deepStrictEqual(hist.map((e) => [e.numero, e.estado]), [['DSE7461', 'rechazado'], ['DSE7460', 'aceptado']]);
    const detalle = (await llamar(`/api/envios/${hist[1].id}`)).datos;
    assert.strictEqual(detalle.documento.CorrelationDocumentId, 'DSE7460');
    assert.strictEqual(detalle.respuesta.ResultData.Id, 'id-7460');
    assert.strictEqual((await llamar('/api/envios?buscar=uber')).datos.length, 1);
    const repetido = await enviar(docs[0], { confirmado: true });
    assert.strictEqual(repetido.datos.estado, 'con_errores');
    assert.match(repetido.datos.errores[0], /ya fue aceptado/);
    assert.strictEqual(recibidos.length, 2);
    const conv2 = (await llamar('/api/convertir', { method: 'POST', body: await excelDePrueba() })).datos.documentos;
    assert.deepStrictEqual(conv2.map((d) => d.errores.some((e) => /ya fue aceptado/.test(e))), [true, false, false]);

    // Consecutivo de pruebas: se reserva y se incrementa solo en envíos reales
    await llamar(`/api/perfiles/${perfil.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { numeracion: 'consecutivo', prefijoConsecutivo: 'SEDS', siguienteConsecutivo: 984000010 } }) });
    // DSE7460 ya fue aceptado: también se bloquea con consecutivo y no gasta número
    const bloqueado = await enviar(docs[0], { confirmado: true });
    assert.strictEqual(bloqueado.datos.estado, 'con_errores');
    // DSE7461 fue rechazado: se puede reenviar, ahora con el consecutivo
    const c1 = await enviar(docs[1], { confirmado: true });
    assert.strictEqual(c1.datos.numero, 'SEDS984000010');
    assert.strictEqual(c1.datos.estado, 'aceptado');
    // Volver a enviar el mismo documento del Excel: bloqueado aunque el consecutivo sería otro
    const c2 = await enviar(docs[1], { confirmado: true });
    assert.strictEqual(c2.datos.estado, 'con_errores');
    assert.match(c2.datos.errores[0], /DSE7461 ya fue aceptado por Saphety como SEDS984000010/);
    const otro = await enviar({ datos: { ...docs[0].datos, prefijoFolio: 7470 } }, { confirmado: true });
    assert.strictEqual(otro.datos.numero, 'SEDS984000011');
    const conv3 = (await llamar('/api/convertir', { method: 'POST', body: await excelDePrueba() })).datos.documentos;
    assert.deepStrictEqual(conv3.map((d) => d.errores.some((e) => /ya fue aceptado/.test(e))), [true, true, false]);
    const hist2 = (await llamar('/api/envios?buscar=DSE7461')).datos;
    assert.strictEqual(hist2[0].numero, 'SEDS984000010');
    assert.strictEqual(hist2[0].numeroExcel, 'DSE7461');

    // Token inválido: se avisa que hay que detener el lote
    await llamar(`/api/perfiles/${perfil.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: 'otra' }) });
    const sinToken = await enviar({ datos: { ...docs[0].datos, prefijoFolio: 7471 } }, { confirmado: true });
    assert.strictEqual(sinToken.datos.estado, 'error_envio');
    assert.strictEqual(sinToken.datos.detener, true);
    // El error de envío queda en el historial y la fila muestra un aviso (no bloquea)
    const { crearAlmacenArchivo } = require('../src/almacen/archivo');
    const previos = await crearAlmacenArchivo(process.env.DATA_DIR).envios.previos('860031699', ['DSE7471', 'DSE7460']);
    assert.deepStrictEqual(previos.get('DSE7471'), { aceptadoComo: null, errorEnvio: true });
    assert.deepStrictEqual(previos.get('DSE7460'), { aceptadoComo: 'DSE7460', errorEnvio: false });
  } finally {
    sApp.close();
    sMock.close();
  }
});
