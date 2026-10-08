'use strict';
// Parámetros por defecto de un perfil (ambiente). Todo se puede cambiar desde
// la pantalla de Administración. La contraseña de Saphety NO va aquí: se guarda
// cifrada aparte y nunca se devuelve al navegador.

const DEFAULTS = {
  // Conexión con Saphety
  url: 'https://api-factura-electronica-co-qa.saphety.com',
  usuario: '',
  opv: '',
  companyId: '',
  // Adquiriente (la empresa que emite el documento soporte)
  nit: '',
  digitoVerificacion: '',
  serieExternalKeyDS: '',

  // Envío
  modoEnvio: 'simulado', // 'simulado' | 'real'
  endpoint: 'sync', // 'sync' -> supportDocument | 'async' -> supportDocumentAsync

  // Numeración
  numeracion: 'excel', // 'excel' -> prefijo y folio del Excel | 'consecutivo' -> serie de pruebas
  prefijoConsecutivo: 'SEDS',
  siguienteConsecutivo: 984000001,

  // Fechas
  fechaEmision: 'excel', // 'excel' -> FECHA_DOC | 'hoy' -> fecha actual (Bogotá)

  // Valores por defecto que el Excel no trae
  emailProveedorDefecto: 'Elkin.Cruz@jtc.com.co',
  medioPagoCodigo: '1', // PaymentMeans.Code
  medioPagoForma: '1', // PaymentMeans.Mean (1 contado, 2 crédito)
  unidadMedida: 'NAR',
  incluirIvaCero: true, // informa IVA 01 al 0 % en la línea y en el total
  ciudadExtranjeroDefecto: '', // no residentes de un país sin capital en src/capitales.js
  departamentoExtranjeroDefecto: '',
  incluirTelefono: true,

  // Tipo de documento DIAN (columna TIPO DE DOCUMENTO) -> DocumentType de Saphety
  tiposDocumento: {
    '13': 'CitizenshipCard',
    '22': 'ForeignerCard',
    '31': 'NIT',
    '41': 'Passport',
    '42': 'ForeignerCard',
    '50': 'ForeignNIT',
  },
};

function conDefaults(config) {
  const c = { ...DEFAULTS, ...(config || {}) };
  c.tiposDocumento = { ...DEFAULTS.tiposDocumento, ...((config && config.tiposDocumento) || {}) };
  // Tabla de ubicaciones de extranjeros retirada: ahora se usa la capital del país (src/capitales.js).
  delete c.ubicacionesExtranjeros;
  return c;
}

module.exports = { DEFAULTS, conDefaults };
