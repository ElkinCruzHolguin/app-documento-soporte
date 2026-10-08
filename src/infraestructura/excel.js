'use strict';
// Lectura del Excel de documentos soporte. Las columnas se reconocen por el
// nombre del encabezado (no por la posición), así que el orden puede cambiar.
const ExcelJS = require('exceljs');

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// campo interno -> función que reconoce el encabezado normalizado
const COLUMNAS = {
  tipo: (h) => h === 'tipo',
  numOrden: (h) => h === 'numorden' || h === 'num orden',
  moneda: (h) => h === 'moneda',
  fechaDoc: (h) => h === 'fecha doc',
  identificacion: (h) => h === 'cedula o nit',
  proveedor: (h) => h === 'proveedor',
  valor: (h) => h.startsWith('valor total item'),
  codigoProducto: (h) => h === 'identificacion producto',
  conceptoLinea: (h) => h === 'concepto linea',
  prefijoFolio: (h) => h === 'prefijo folio',
  descripcion: (h) => h === 'descripcion',
  fechaItem: (h) => h === 'fecha item',
  nitEmisor: (h) => h === 'nit emisor',
  observacion: (h) => h === 'observacion',
  tipoPersona: (h) => h.startsWith('tipo persona'),
  nombre: (h) => h === 'nombre',
  segundoNombre: (h) => h === 'segundo nombre',
  apellidos: (h) => h === 'apellidos',
  direccion: (h) => h === 'direccion',
  municipio: (h) => h === 'municipio',
  departamento: (h) => h === 'departamento',
  pais: (h) => h === 'pais',
  codigoPostal: (h) => h === 'codigo postal',
  telefono: (h) => h === 'telefono',
  tipoDocumento: (h) => h === 'tipo de documento',
  regimenFiscal: (h) => h === 'regimen fiscal',
  obligacionesFiscales: (h) => h === 'obligaciones fiscales',
  obligacionesImpuesto: (h) => h === 'obligaciones impuesto',
  precedencia: (h) => h.startsWith('precedencia'),
  prefijo: (h) => h === 'prefijo',
  folio: (h) => h === 'folio',
  baseReteIva: (h) => h === 'base reteiva',
  tasaReteIva: (h) => h === 'tasa reteiva',
  valorReteIva: (h) => h === 'valor reteiva',
  baseReteFuente: (h) => h === 'base retefuente',
  tasaReteFuente: (h) => h === 'tasa retefuente',
  valorReteFuente: (h) => h === 'valor retefuente',
  valorTrm: (h) => h === 'valor trm',
  fechaTrm: (h) => h === 'fecha trm',
  // Opcional: si algún día el Excel trae el correo del proveedor
  emailProveedor: (h) => h === 'email' || h === 'correo' || h === 'email proveedor' || h === 'correo proveedor',
};

const OBLIGATORIAS = ['fechaDoc', 'identificacion', 'proveedor', 'valor', 'descripcion', 'prefijoFolio', 'pais', 'tipoDocumento', 'precedencia'];

function valorCelda(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return valorCelda(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if ('error' in v) return null;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v;
}

/**
 * Devuelve { columnas: {campo: encabezadoOriginal}, faltantes: [...], filas: [{numeroFila, datos}] }
 */
async function leerExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas.');

  const encabezado = ws.getRow(1);
  const indice = {}; // campo -> número de columna
  const columnas = {};
  encabezado.eachCell((cell, col) => {
    const h = normalizar(valorCelda(cell.value));
    for (const [campo, reconoce] of Object.entries(COLUMNAS)) {
      if (!(campo in indice) && reconoce(h)) {
        indice[campo] = col;
        columnas[campo] = String(valorCelda(cell.value));
        break;
      }
    }
  });
  const faltantes = OBLIGATORIAS.filter((c) => !(c in indice));

  const filas = [];
  ws.eachRow((row, numeroFila) => {
    if (numeroFila === 1) return;
    const datos = {};
    let vacia = true;
    for (const [campo, col] of Object.entries(indice)) {
      const v = valorCelda(row.getCell(col).value);
      datos[campo] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
      if (v !== null) vacia = false;
    }
    if (!vacia) filas.push({ numeroFila, datos });
  });

  return { hoja: ws.name, columnas, faltantes, filas };
}

module.exports = { leerExcel, normalizar, COLUMNAS };
