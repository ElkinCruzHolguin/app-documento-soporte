'use strict';
// Buzón de recepción: facturas y notas que los proveedores le envían a la compañía, consultadas en Saphety,
// y los eventos RADIAN (acuse, recibo del bien, aceptación, reclamo). Solo los de la empresa conectada por su
// companyId de Saphety, aunque el usuario de Saphety tenga acceso a más empresas.
const { fallo } = require('../dominio/errores');
const { validarId, listaDocumentos, totalBusqueda, TAMANO_PAGINA } = require('../dominio/emitidos');
const reglas = require('../dominio/recibidos');
const { urlConsultaDian } = require('../dominio/dian');

const FORMATOS = {
  pdf: { ruta: 'pdf', tipo: 'application/pdf', extension: 'pdf' },
  xml: { ruta: 'ubl', tipo: 'application/xml', extension: 'xml' },
  attached: { ruta: 'attacheddocument', tipo: 'application/xml', extension: 'attached.xml' },
};

function crearServicioRecibidos({ companias, perfiles, saphety, log = console }) {
  async function conexion(actor) {
    const compania = await companias.requerida(actor);
    if (!String(compania.config.companyId || '').trim()) {
      throw fallo(400, 'Configura el companyId de la compañía en Administración para consultar sus documentos recibidos.');
    }
    const clave = await perfiles.clave(compania.id);
    const llamar = (fn, ...args) => saphety[fn](compania.id, compania.config, clave, ...args);
    return { compania, companyId: compania.config.companyId, llamar };
  }

  /** Metadatos del documento, solo si es de la empresa conectada. */
  async function propio(llamar, companyId, id) {
    const d = await llamar('recibido', id);
    if (!d || !reglas.esDeLaEmpresa(d, companyId)) throw fallo(404, 'Documento no encontrado para esta compañía.');
    return d;
  }

  return {
    async listar(actor, filtros = {}) {
      const { compania, companyId, llamar } = await conexion(actor);
      const { cuerpo, pagina, desde, hasta } = reglas.filtroBusqueda(filtros, compania.config);
      const { Offset, NumberOfRecords, ...filtroConteo } = cuerpo; // eslint-disable-line no-unused-vars
      const [encontrados, total] = await Promise.all([
        llamar('buscarRecibidos', cuerpo),
        llamar('contarRecibidos', filtroConteo).catch((e) => { log.warn(`Conteo de recibidos: ${e.message}`); return null; }),
      ]);
      const documentos = listaDocumentos(encontrados).filter((d) => reglas.esDeLaEmpresa(d, companyId)).map(reglas.resumenRecibido);
      return {
        compania: compania.nombre, desde, hasta, pagina, tamanoPagina: TAMANO_PAGINA,
        total: totalBusqueda(total, encontrados), hayMas: documentos.length >= TAMANO_PAGINA, documentos,
      };
    },

    async obtener(actor, id) {
      const docId = validarId(id);
      const { compania, companyId, llamar } = await conexion(actor);
      const documento = reglas.resumenRecibido(await propio(llamar, companyId, docId));
      documento.consultaDian = urlConsultaDian(documento.cufe, compania.config.url);
      const avisos = [];
      const respuestas = await llamar('respuestasRecibido', docId).catch((e) => { avisos.push(`No se pudieron consultar las respuestas: ${e.message}`); return null; });
      return {
        documento,
        respuestas: respuestas == null ? [] : [].concat(respuestas),
        modoEnvio: compania.config.modoEnvio === 'real' ? 'real' : 'simulado',
        eventos: reglas.EVENTOS,
        conceptosReclamo: reglas.CONCEPTOS_RECLAMO,
        avisos,
      };
    },

    async archivo(actor, id, formato) {
      const docId = validarId(id);
      const f = FORMATOS[formato];
      if (!f) throw fallo(400, 'Formato inválido: usa pdf, xml o attached.');
      const { companyId, llamar } = await conexion(actor);
      const d = await propio(llamar, companyId, docId);
      const { contenido } = await llamar('archivoRecibido', docId, f.ruta);
      return { contenido, tipo: f.tipo, nombre: `${String(d.DocumentNumber || docId).replace(/[^\w.-]/g, '')}.${f.extension}` };
    },

    /**
     * Registra un evento RADIAN. Sale a la DIAN y al proveedor y no se puede deshacer, así que exige
     * confirmación, la compañía en modo real y que el evento corresponda al estado actual del documento.
     */
    async registrarEvento(actor, id, { tipo, confirmado, ...datos } = {}) {
      const docId = validarId(id);
      const { ev, persona, motivo, concepto } = reglas.datosEvento(tipo, datos);
      const { compania, companyId, llamar } = await conexion(actor);
      if (compania.config.modoEnvio !== 'real') {
        throw fallo(400, 'La compañía está en modo simulado: los eventos RADIAN no se envían. Cámbiala a modo real en Administración.');
      }
      if (confirmado !== true) throw fallo(400, `Confirma el evento «${ev.nombre}»: se envía a la DIAN y no se puede deshacer.`);
      const d = await propio(llamar, companyId, docId);
      if (!ev.desde.includes(d.DocumentStatus)) {
        throw fallo(409, `«${ev.nombre}» no corresponde al estado actual del documento (${reglas.resumenRecibido(d).estadoTexto}).`);
      }
      if (tipo === 'acuse') await llamar('acuseRecibo', docId, persona);
      else if (tipo === 'reciboBien') await llamar('reciboBien', docId, persona);
      else if (tipo === 'aceptar') await llamar('aceptar', docId, motivo);
      else await llamar('rechazar', docId, motivo, concepto);
      log.info(`Evento RADIAN ${ev.codigo} (${tipo}) en ${d.DocumentNumber} por ${actor.usuario || actor.id}`);
      return { ok: true, mensaje: `${ev.nombre} registrado en Saphety.`, documento: reglas.resumenRecibido(await llamar('recibido', docId)) };
    },
  };
}

module.exports = { crearServicioRecibidos };
