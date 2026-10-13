'use strict';
// Series (numeración) configuradas para la compañía en Saphety.
const { pedir } = require('./cliente');

const base = (cfg) => `companies/${encodeURIComponent(cfg.companyId || '')}`;
const exigirCompania = (cfg) => { if (!cfg.companyId) throw Object.assign(new Error('Configura el Company Id de la compañía en Administración.'), { status: 400 }); };
// Tipo de la app -> segmento de Saphety para consultar series por tipo.
const TIPOS = { soporte: 'supportdocument', factura: 'salesinvoice', notaCredito: 'creditnote', notaDebito: 'debitnote', contingencia: 'contingency', pos: 'equivalentposdocument', dian: 'dian' };

module.exports = {
  TIPOS_SERIE: TIPOS,
  /** Todas las series de emisión (o de habilitación con { habilitacion: true }). */
  listarSeries: (perfilId, cfg, clave, { habilitacion = false } = {}) => {
    exigirCompania(cfg);
    return pedir(perfilId, cfg, clave, `${base(cfg)}/${habilitacion ? 'qualificationseries' : 'series'}/getall`, 'consultar las series');
  },
  seriesPorTipo: (perfilId, cfg, clave, tipo) => {
    exigirCompania(cfg);
    if (!TIPOS[tipo]) throw Object.assign(new Error('Tipo de serie inválido.'), { status: 400 });
    return pedir(perfilId, cfg, clave, `${base(cfg)}/series/${TIPOS[tipo]}`, 'consultar las series');
  },
  serie: (perfilId, cfg, clave, id, { habilitacion = false } = {}) => {
    exigirCompania(cfg);
    return pedir(perfilId, cfg, clave, `${base(cfg)}/${habilitacion ? 'qualificationseries' : 'series'}/${encodeURIComponent(id)}`, 'consultar la serie');
  },
  crearSerie: (perfilId, cfg, clave, datos, { habilitacion = false } = {}) => {
    exigirCompania(cfg);
    return pedir(perfilId, cfg, clave, `${base(cfg)}/${habilitacion ? 'qualificationseries' : 'series'}`, 'crear la serie', { metodo: 'POST', cuerpo: datos });
  },
  actualizarSerie: (perfilId, cfg, clave, id, datos, { habilitacion = false } = {}) => {
    exigirCompania(cfg);
    return pedir(perfilId, cfg, clave, `${base(cfg)}/${habilitacion ? 'qualificationseries' : 'series'}/${encodeURIComponent(id)}`, 'actualizar la serie', { metodo: 'PUT', cuerpo: datos });
  },
};
