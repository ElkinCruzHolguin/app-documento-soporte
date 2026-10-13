'use strict';
// Documentos soporte emitidos, consultados en línea en Saphety (no en el historial local).
// Cada actor consulta con la conexión de su compañía y solo ve los documentos de ella.
const { fallo } = require('../dominio/errores');
const reglas = require('../dominio/emitidos');

function crearServicioEmitidos({ companias, perfiles, saphety, log = console }) {
  /** Compañía del actor, su NIT y lo necesario para llamar a Saphety. */
  async function conexion(actor) {
    const compania = await companias.requerida(actor);
    if (!String(compania.config.nit || '').replace(/\D/g, '')) {
      throw fallo(400, 'Configura el NIT de la compañía en Administración para consultar sus documentos.');
    }
    const clave = await perfiles.clave(compania.id);
    const llamar = (fn, ...args) => saphety[fn](compania.id, compania.config, clave, ...args);
    return { compania, nit: compania.config.nit, llamar };
  }

  /** Lo que es opcional en el detalle: si falla, se informa y el resto se muestra igual. */
  async function opcional(promesa, aviso, avisos) {
    try {
      return await promesa;
    } catch (e) {
      avisos.push(`${aviso}: ${e.message}`);
      return null;
    }
  }

  return {
    async listar(actor, filtros = {}) {
      const { compania, nit, llamar } = await conexion(actor);
      const { cuerpo, pagina, desde, hasta } = reglas.filtroBusqueda(filtros, nit);
      const { Offset, NumberOfRecords, ...filtroConteo } = cuerpo; // eslint-disable-line no-unused-vars
      const [encontrados, total] = await Promise.all([
        llamar('buscarEmitidos', cuerpo),
        // El total es informativo: si el conteo falla, la lista se muestra igual.
        llamar('contarEmitidos', filtroConteo).catch((e) => { log.warn(`Conteo de emitidos: ${e.message}`); return null; }),
      ]);
      const documentos = reglas.listaDocumentos(encontrados).filter((d) => reglas.perteneceA(d, nit)).map(reglas.resumenEmitido);
      return {
        compania: compania.nombre,
        desde,
        hasta,
        pagina,
        tamanoPagina: reglas.TAMANO_PAGINA,
        total: reglas.totalBusqueda(total, encontrados),
        hayMas: documentos.length >= reglas.TAMANO_PAGINA,
        documentos,
      };
    },

    async obtener(actor, id) {
      const docId = reglas.validarId(id);
      const { nit, llamar } = await conexion(actor);
      const metadatos = await llamar('emitido', docId);
      if (!metadatos || !reglas.perteneceA(metadatos, nit)) throw fallo(404, 'Documento no encontrado para esta compañía.');
      const avisos = [];
      const [estado, respuestas, dto] = await Promise.all([
        opcional(llamar('estadoEmitido', docId), 'No se pudo consultar el estado', avisos),
        opcional(llamar('respuestasEmitido', docId), 'No se pudieron consultar las respuestas de la DIAN', avisos),
        opcional(llamar('archivoEmitido', docId, 'dto').then((a) => JSON.parse(a.contenido.toString('utf8'))), 'No se pudieron leer las líneas', avisos),
      ]);
      const documento = reglas.resumenEmitido(metadatos);
      if (estado && estado.Status) {
        documento.estadoSaphety = estado.Status;
        documento.estado = reglas.estadoApp(estado.Status);
      }
      return {
        documento,
        validaciones: (estado && estado.ValidationErrors) || [],
        respuestas: respuestas == null ? [] : [].concat(respuestas),
        lineas: reglas.lineasDto(dto),
        avisos,
      };
    },

    /** Archivo del documento (pdf, xml o attached) listo para enviar al navegador. */
    async archivo(actor, id, formato) {
      const docId = reglas.validarId(id);
      const f = reglas.FORMATOS[formato];
      if (!f) throw fallo(400, 'Formato inválido: usa pdf, xml o attached.');
      const { nit, llamar } = await conexion(actor);
      const metadatos = await llamar('emitido', docId);
      if (!metadatos || !reglas.perteneceA(metadatos, nit)) throw fallo(404, 'Documento no encontrado para esta compañía.');
      const { contenido } = await llamar('archivoEmitido', docId, f.ruta);
      const nombre = `${String(metadatos.DocumentNumber || docId).replace(/[^\w.-]/g, '')}.${f.extension}`;
      return { contenido, tipo: f.tipo, nombre };
    },
  };
}

module.exports = { crearServicioEmitidos };
