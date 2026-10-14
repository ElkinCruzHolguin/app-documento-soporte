'use strict';
// Notas de ajuste a documentos soporte ya aceptados por la DIAN: se arman desde el documento original
// (el JSON que la app envió, guardado en el historial, o el DTO que Saphety guardó) y se envían a Saphety.
const { fallo } = require('../dominio/errores');
const emitidos = require('../dominio/emitidos');
const reglas = require('../dominio/notaAjuste');

function crearServicioNotasAjuste({ companias, perfiles, envios, saphety, log = console }) {
  /** Documento soporte original de la compañía, aceptado, con lo necesario para armar la nota. */
  async function original(actor, id) {
    const docId = emitidos.validarId(id);
    const compania = await companias.requerida(actor);
    const cfg = compania.config;
    if (!emitidos.soloDigitos(cfg.nit)) throw fallo(400, 'Configura el NIT de la compañía en Administración.');
    const clave = await perfiles.clave(compania.id);
    const llamar = (fn, ...args) => saphety[fn](compania.id, cfg, clave, ...args);

    const metadatos = await llamar('emitido', docId);
    if (!metadatos || !emitidos.perteneceA(metadatos, cfg.nit)) throw fallo(404, 'Documento no encontrado para esta compañía.');
    if (metadatos.DocumentType && metadatos.DocumentType !== 'SupportDocument') throw fallo(400, 'Solo se puede hacer nota de ajuste a un documento soporte.');
    if (emitidos.estadoApp(metadatos.DocumentStatus) !== 'aceptado') throw fallo(400, 'Solo se puede hacer nota de ajuste a un documento soporte aceptado por la DIAN.');

    // Primero el JSON que envió la app (exacto); si el documento se creó por otro medio, el DTO de Saphety.
    let json = null;
    let fuente = 'historial';
    const envio = await envios.porSaphetyId(docId);
    if (envio && reglas.documentoOriginal(envio.documento)) json = envio.documento;
    else {
      fuente = 'saphety';
      try {
        const { contenido } = await llamar('archivoEmitido', docId, 'dto');
        json = JSON.parse(contenido.toString('utf8'));
      } catch (e) {
        log.warn(`DTO del documento ${docId}: ${e.message}`);
      }
    }
    const referencia = { numero: metadatos.DocumentNumber || '', fecha: metadatos.DocumentDate || '', cuds: metadatos.Cufe || metadatos.Cuds || '' };
    return { compania, cfg, clave, llamar, original: reglas.exigirOriginal(json), referencia, fuente };
  }

  return {
    /** Datos para la pantalla: el documento original, sus líneas, los conceptos y la serie que se usará. */
    async preparar(actor, id) {
      const { cfg, llamar, original: o, referencia, fuente } = await original(actor, id);
      const catalogo = await llamar('catalogo', 'creditnotereasons').catch((e) => { log.warn(`Catálogo creditnotereasons: ${e.message}`); return null; });
      return {
        referencia,
        fuente,
        ...reglas.resumenOriginal(o),
        conceptos: reglas.conceptos(catalogo),
        modo: cfg.modoEnvio === 'real' ? 'real' : 'simulado',
        serie: { prefijo: cfg.prefijoNotaAjuste, siguiente: cfg.siguienteNotaAjuste, configurada: Boolean(cfg.serieExternalKeyNotaAjuste) },
      };
    },

    /** Arma y envía la nota (real o simulada). En real exige confirmación, reserva el número y deja el envío en el historial. */
    async enviar(actor, id, { concepto, motivo, lineas, confirmado } = {}) {
      const { compania, cfg, clave, original: o, referencia } = await original(actor, id);
      const pedido = { concepto, motivo, lineas };
      const real = cfg.modoEnvio === 'real';

      // Se valida primero sin reservar número, para no gastar consecutivos en notas con errores.
      const previa = reglas.construirNotaAjuste(o, referencia, pedido, cfg);
      if (previa.errores.length) return { estado: 'con_errores', errores: previa.errores, json: previa.json };
      if (real && !confirmado) throw fallo(400, 'El envío real necesita confirmación.');

      const numeracion = real ? await perfiles.tomarConsecutivoNota(compania.id) : undefined;
      const { json, resumen } = reglas.construirNotaAjuste(o, referencia, pedido, cfg, { numeracion });
      let r;
      try {
        r = real
          ? await saphety.crearDocumento(compania.id, cfg, clave, 'notaAjusteSoporte', json, { sincrono: cfg.endpoint !== 'async' })
          : saphety.simular(json);
      } catch (e) {
        r = { estado: 'error_envio', mensaje: e.message };
      }
      const salida = { ...r, modo: real ? 'real' : 'simulado', numero: resumen.numero, json };
      if (real) {
        try {
          salida.envioId = await envios.registrar({
            perfilId: compania.id, perfilNombre: compania.nombre, modo: 'real', estado: r.estado, numero: resumen.numero, numeroExcel: resumen.numero,
            nitAdquiriente: emitidos.soloDigitos(cfg.nit), proveedor: resumen.proveedor, identificacion: resumen.identificacion, valor: resumen.valor,
            saphetyId: r.saphetyId || null, cuds: r.cuds || null, mensaje: `Nota de ajuste a ${resumen.referencia}. ${r.mensaje || ''}`.trim(),
            documento: json, respuesta: r.respuesta || null,
          });
        } catch (e) {
          log.error(e);
          salida.mensaje = `${salida.mensaje || ''}\nAviso: no se pudo guardar en el historial (${e.message}).`.trim();
        }
      }
      return salida;
    },
  };
}

module.exports = { crearServicioNotasAjuste };
