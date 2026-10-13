'use strict';
// Buzón de recepción: facturas y notas que los proveedores le envían a la compañía, consultadas en Saphety,
// y los eventos RADIAN (acuse, recibo del bien, aceptación, reclamo). Cada actor ve solo los de su compañía.
const { fallo } = require('../dominio/errores');
const { validarId, listaDocumentos, totalBusqueda, TAMANO_PAGINA } = require('../dominio/emitidos');
const reglas = require('../dominio/recibidos');

const FORMATOS = {
  pdf: { ruta: 'pdf', tipo: 'application/pdf', extension: 'pdf' },
  xml: { ruta: 'ubl', tipo: 'application/xml', extension: 'xml' },
  attached: { ruta: 'attacheddocument', tipo: 'application/xml', extension: 'attached.xml' },
};

function crearServicioRecibidos({ companias, perfiles, saphety, log = console }) {
  async function conexion(actor) {
    const compania = await companias.requerida(actor);
    if (!String(compania.config.nit || '').replace(/\D/g, '')) {
      throw fallo(400, 'Configura el NIT de la compañía en Administración para consultar sus documentos.');
    }
    const clave = await perfiles.clave(compania.id);
    const llamar = (fn, ...args) => saphety[fn](compania.id, compania.config, clave, ...args);
    return { compania, nit: compania.config.nit, llamar };
  }

  /** Metadatos del documento, solo si la compañía es el adquiriente. */
  async function propio(llamar, nit, id) {
    const d = await llamar('recibido', id);
    if (!d || !reglas.esAdquiriente(d, nit)) throw fallo(404, 'Documento no encontrado para esta compañía.');
    return d;
  }

  /**
   * Sin resultados: mira si en el mismo rango la cuenta de Saphety tiene documentos de otras empresas,
   * para que se entienda por qué la lista sale vacía. Los nombres de esas empresas solo los ve el administrador.
   */
  async function explicarVacio(actor, llamar, cuerpo, nit) {
    const { DocumentTypes, CreationDateStart, CreationDateEnd } = cuerpo;
    const otros = await llamar('buscarRecibidos', { DocumentTypes, CreationDateStart, CreationDateEnd, Offset: 0, NumberOfRecords: TAMANO_PAGINA })
      .then((r) => listaDocumentos(r).filter((d) => !reglas.esAdquiriente(d, nit)))
      .catch(() => []);
    if (!otros.length) return [];
    const adquirientes = [...new Map(otros.map((d) => [d.DestinationCode, `${d.DestinationName || 'Sin nombre'} (${String(d.DestinationCode || '').split('_').pop()})`])).values()];
    const quienes = actor.rol === 'admin' ? `: ${adquirientes.slice(0, 5).join(', ')}${adquirientes.length > 5 ? '…' : ''}` : '';
    return [`En estas fechas la cuenta de Saphety sí tiene documentos recibidos, pero son de otras empresas${quienes}. Esta compañía solo muestra los que llegan a su NIT ${nit}.`];
  }

  return {
    async listar(actor, filtros = {}) {
      const { compania, nit, llamar } = await conexion(actor);
      const { cuerpo, pagina, desde, hasta } = reglas.filtroBusqueda(filtros, compania.config);
      const { Offset, NumberOfRecords, ...filtroConteo } = cuerpo; // eslint-disable-line no-unused-vars
      const [encontrados, total] = await Promise.all([
        llamar('buscarRecibidos', cuerpo),
        llamar('contarRecibidos', filtroConteo).catch((e) => { log.warn(`Conteo de recibidos: ${e.message}`); return null; }),
      ]);
      const documentos = listaDocumentos(encontrados).filter((d) => reglas.esAdquiriente(d, nit)).map(reglas.resumenRecibido);
      const avisos = documentos.length || pagina ? [] : await explicarVacio(actor, llamar, cuerpo, nit);
      return {
        compania: compania.nombre, desde, hasta, pagina, tamanoPagina: TAMANO_PAGINA,
        total: documentos.length ? totalBusqueda(total, encontrados) : 0, hayMas: documentos.length >= TAMANO_PAGINA, documentos, avisos,
      };
    },

    async obtener(actor, id) {
      const docId = validarId(id);
      const { compania, nit, llamar } = await conexion(actor);
      const documento = reglas.resumenRecibido(await propio(llamar, nit, docId));
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
      const { nit, llamar } = await conexion(actor);
      const d = await propio(llamar, nit, docId);
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
      const { compania, nit, llamar } = await conexion(actor);
      if (compania.config.modoEnvio !== 'real') {
        throw fallo(400, 'La compañía está en modo simulado: los eventos RADIAN no se envían. Cámbiala a modo real en Administración.');
      }
      if (confirmado !== true) throw fallo(400, `Confirma el evento «${ev.nombre}»: se envía a la DIAN y no se puede deshacer.`);
      const d = await propio(llamar, nit, docId);
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
