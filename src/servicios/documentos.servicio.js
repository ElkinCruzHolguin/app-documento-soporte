'use strict';
// Documentos soporte: conversión del Excel al JSON de Saphety y envío (real o simulado).
const { fallo } = require('../dominio/errores');
const { construirDocumento } = require('../dominio/mapper');

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
const mensajeYaAceptado = (numeroExcel, aceptadoComo) =>
  `El documento ${numeroExcel} ya fue aceptado por Saphety${aceptadoComo !== numeroExcel ? ` como ${aceptadoComo}` : ''} (ver Historial).`;

function crearServicioDocumentos({ companias, perfiles, envios, saphety, excel, log = console }) {
  return {
    /** Lee el Excel, arma y valida el JSON de cada fila. No guarda nada. */
    async convertir(actor, archivo) {
      if (!archivo || !archivo.length) throw fallo(400, 'No llegó ningún archivo.');
      const compania = await companias.requerida(actor);
      let libro;
      try {
        libro = await excel.leerExcel(archivo);
      } catch (e) {
        throw fallo(400, `No se pudo leer el Excel: ${e.message}`);
      }
      if (libro.faltantes.length) throw fallo(400, `Al Excel le faltan columnas: ${libro.faltantes.join(', ')}`);
      if (!libro.filas.length) throw fallo(400, 'El Excel no tiene filas con datos.');

      const vistos = new Set();
      const documentos = libro.filas.map(({ numeroFila, datos }) => {
        const v = construirDocumento(datos, compania.config);
        if (vistos.has(v.resumen.numero)) v.errores.push(`Número ${v.resumen.numero} repetido dentro del archivo.`);
        vistos.add(v.resumen.numero);
        return { fila: numeroFila, datos, ...v.resumen, errores: v.errores, advertencias: v.advertencias, json: v.json };
      });

      // El historial dice qué documentos del Excel (PREFIJO + FOLIO) ya se enviaron, en cualquier modo de numeración.
      if (compania.config.nit) {
        const previos = await envios.previos(soloDigitos(compania.config.nit), [...vistos]);
        for (const d of documentos) {
          const p = previos.get(d.numero);
          if (p && p.aceptadoComo) d.errores.push(mensajeYaAceptado(d.numero, p.aceptadoComo));
          else if (p && p.errorEnvio) d.advertencias.push(`El último envío de ${d.numero} quedó con error de conexión: revisa en Saphety si se creó antes de reenviarlo.`);
        }
      }
      return { hoja: libro.hoja, columnas: libro.columnas, documentos };
    },

    /**
     * Envía una fila. En modo real exige confirmación, bloquea documentos ya aceptados,
     * reserva el consecutivo (si aplica) y deja el envío en el historial.
     */
    async enviar(actor, { datos, confirmado, indice }) {
      if (!datos || typeof datos !== 'object') throw fallo(400, 'Faltan los datos de la fila.');
      const compania = await companias.requerida(actor);
      const cfg = compania.config;
      const real = cfg.modoEnvio === 'real';
      if (real && !confirmado) throw fallo(400, 'El envío real necesita confirmación.');

      // Se valida primero sin reservar consecutivo, para no gastar números en filas con errores.
      const previa = construirDocumento(datos, cfg);
      if (previa.errores.length) return { estado: 'con_errores', errores: previa.errores, json: previa.json };
      const nit = soloDigitos(cfg.nit);
      const numeroExcel = previa.resumen.numero;
      if (real) {
        const p = (await envios.previos(nit, [numeroExcel])).get(numeroExcel);
        if (p && p.aceptadoComo) return { estado: 'con_errores', errores: [mensajeYaAceptado(numeroExcel, p.aceptadoComo)], json: previa.json };
      }

      let numeracion;
      if (cfg.numeracion === 'consecutivo') {
        numeracion = real
          ? await perfiles.tomarConsecutivo(compania.id)
          : { prefijo: cfg.prefijoConsecutivo, numero: String(Number(cfg.siguienteConsecutivo) + (Number(indice) || 0)) };
      }
      const { json, resumen } = construirDocumento(datos, cfg, { numeracion });
      const numero = `${json.SeriePrefix}${json.SerieNumber}`;
      let r;
      try {
        r = real ? await saphety.crearDocumentoSoporte(compania.id, cfg, await perfiles.clave(compania.id), json) : saphety.simular(json);
      } catch (e) {
        r = { estado: 'error_envio', mensaje: e.message, detener: /token/i.test(e.message) };
      }
      const salida = { ...r, modo: real ? 'real' : 'simulado', numero, json };
      if (real) {
        try {
          salida.envioId = await envios.registrar({
            perfilId: compania.id, perfilNombre: compania.nombre, modo: 'real', estado: r.estado, numero, numeroExcel, nitAdquiriente: nit,
            proveedor: resumen.proveedor, identificacion: resumen.identificacion, valor: resumen.valor,
            saphetyId: r.saphetyId || null, cuds: r.cuds || null, mensaje: r.mensaje || '', documento: json, respuesta: r.respuesta || null,
          });
        } catch (e) {
          log.error(e);
          salida.mensaje = `${salida.mensaje || ''}\nAviso: no se pudo guardar en el historial (${e.message}). Descarga los resultados.`.trim();
        }
      }
      return salida;
    },
  };
}

module.exports = { crearServicioDocumentos };
