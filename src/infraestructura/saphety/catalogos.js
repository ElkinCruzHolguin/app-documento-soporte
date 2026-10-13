'use strict';
// Catálogos públicos de Saphety (/v2/dataelements/...): medios de pago, monedas, causales de rechazo, etc.
const { obtenerToken, pedirJson, base } = require('./cliente');

// Nombres conocidos del kit de integración, por si una pantalla quiere listarlos.
const CATALOGOS = [
  'paymentmeanscode', 'paymentmeansmeans', 'incoterms', 'creditnotereasons', 'debitnotereasons', 'rejectionreasons',
  'allowancechargecodetypes', 'taxcategories', 'withholdingtaxes', 'countrycodes', 'currencies', 'docreferencetypes',
  'unitsofmeasure', 'unitsofmeasuresimplified', 'outbounddocumentstatuses', 'outbounddocumentstatusesextended',
  'qualificationdocumentstatuses', 'documentsubtypes', 'documenttypes', 'doclinereferencetypes', 'docoperationtypes',
  'identificationdocumenttypes',
];

/** Consulta un catálogo público de Saphety (por ejemplo identificationdocumenttypes). */
async function catalogo(perfilId, cfg, clave, nombre) {
  const token = await obtenerToken(perfilId, cfg, clave);
  const { status, datos } = await pedirJson(`${base(cfg)}/v2/dataelements/${encodeURIComponent(nombre)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(datos).slice(0, 300)}`);
  return datos;
}

module.exports = { CATALOGOS, catalogo };
