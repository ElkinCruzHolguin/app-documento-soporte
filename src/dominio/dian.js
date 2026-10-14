'use strict';
// Consulta pública de un documento electrónico en el catálogo de la DIAN, con el CUFE/CUDS ya puesto en la URL
// (la misma dirección que lleva el código QR de la representación gráfica). Allí solo falta resolver el captcha.

const CATALOGO = {
  produccion: 'https://catalogo-vpfe.dian.gov.co',
  habilitacion: 'https://catalogo-vpfe-hab.dian.gov.co',
};

/** Los documentos enviados por el ambiente de calidad (QA) de Saphety quedan en el ambiente de habilitación de la DIAN. */
function ambienteDian(urlSaphety) {
  return /-qa\b|qa\.saphety|calidad/i.test(String(urlSaphety || '')) ? 'habilitacion' : 'produccion';
}

/** URL del catálogo de la DIAN que muestra el documento con ese código único, o null si no hay código. */
function urlConsultaDian(codigo, urlSaphety) {
  const clave = String(codigo || '').trim();
  if (!clave) return null;
  return `${CATALOGO[ambienteDian(urlSaphety)]}/document/searchqr?documentkey=${encodeURIComponent(clave)}`;
}

module.exports = { CATALOGO, ambienteDian, urlConsultaDian };
