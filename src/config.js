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
  ciudadExtranjeroDefecto: '', // para no residentes sin municipio en el Excel
  departamentoExtranjeroDefecto: '',
  incluirTelefono: true,

  // Ciudad y departamento/estado de proveedores no residentes (el Excel no los trae).
  // Clave: identificación del proveedor (CEDULA O NIT) o código de país (MX, PA...) como respaldo.
  // Valores iniciales deducidos de las direcciones del Excel DSE7460 a DSE7553.
  ubicacionesExtranjeros: {
    VVM200921JN2: { ciudad: 'Monterrey', departamento: 'Nuevo León' },
    FBW151214A52: { ciudad: 'Ciudad de México', departamento: 'Ciudad de México' },
    TAS860404J80: { ciudad: 'Ciudad de México', departamento: 'Ciudad de México' },
    RTO840921RE4: { ciudad: 'Ciudad de México', departamento: 'Ciudad de México' },
    SHE190630V37: { ciudad: 'Ciudad de México', departamento: 'Ciudad de México' },
    CCI190319JD6: { ciudad: 'Ciudad de México', departamento: 'Ciudad de México' },
    TPA100922MD8: { ciudad: 'Apodaca', departamento: 'Nuevo León' },
    SAG131008FA7: { ciudad: 'Ciudad de México', departamento: 'Ciudad de México' },
    M0407151WA: { ciudad: 'San Nicolás de los Garza', departamento: 'Nuevo León' },
    GTO1810249X9: { ciudad: 'San Pedro Garza García', departamento: 'Nuevo León' },
    UBV121024TN8: { ciudad: 'Ciudad de México', departamento: 'Ciudad de México' },
    GIR090206KG2: { ciudad: 'Ciudad de México', departamento: 'Ciudad de México' },
    AVC170711EM: { ciudad: 'San Pedro Garza García', departamento: 'Nuevo León' },
    '102019065': { ciudad: 'Ciudad de Panamá', departamento: 'Panamá' },
  },

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
  // La tabla de ubicaciones se reemplaza completa para que se puedan borrar filas desde Administración.
  if (!config || !config.ubicacionesExtranjeros) c.ubicacionesExtranjeros = DEFAULTS.ubicacionesExtranjeros;
  return c;
}

module.exports = { DEFAULTS, conDefaults };
