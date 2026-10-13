'use strict';
// Tablero de la compañía: indicadores del mes, volumen de los últimos 7 días y estado ante la DIAN,
// calculados con los documentos reales de Saphety (emitidos y recibidos) y los envíos del historial.
const { fallo } = require('../dominio/errores');
const reglasEmitidos = require('../dominio/emitidos');
const reglasRecibidos = require('../dominio/recibidos');
const reglas = require('../dominio/dashboard');

// Tope de documentos que se leen por tipo para calcular valores y estados (10 páginas de 50).
const MAX_PAGINAS = 10;
const RECIENTES = 5;

function crearServicioDashboard({ companias, perfiles, envios, saphety, log = console }) {
  /**
   * Lee todas las páginas de una búsqueda hasta MAX_PAGINAS. Quita repetidos por Id, así sirve tanto si
   * Saphety interpreta Offset como página o como registro. completo = false si quedó en el tope.
   */
  async function listarTodo(llamar, fn, cuerpoPagina, propio) {
    const vistos = new Map();
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const lote = reglasEmitidos.listaDocumentos(await llamar(fn, cuerpoPagina(pagina)));
      let nuevos = 0;
      for (const d of lote) if (d && d.Id && !vistos.has(d.Id)) { vistos.set(d.Id, d); nuevos += 1; }
      if (lote.length < reglasEmitidos.TAMANO_PAGINA || !nuevos) return { docs: [...vistos.values()].filter(propio), completo: true };
    }
    return { docs: [...vistos.values()].filter(propio), completo: false };
  }

  const contar = (llamar, fn, cuerpo) => {
    const { Offset, NumberOfRecords, ...filtro } = cuerpo; // eslint-disable-line no-unused-vars
    return llamar(fn, filtro).then((n) => (typeof n === 'number' ? n : reglasEmitidos.totalBusqueda(null, n)))
      .catch((e) => { log.warn(`Conteo ${fn}: ${e.message}`); return null; });
  };

  async function emitidos(llamar, nit, p) {
    if (!reglasEmitidos.soloDigitos(nit)) throw fallo(400, 'Configura el NIT de la compañía en Administración para ver los documentos emitidos.');
    const cuerpo = (rango, pagina = 0) => reglasEmitidos.filtroBusqueda({ ...rango, pagina }, nit).cuerpo;
    const [lista, totalMes, totalMesAnterior] = await Promise.all([
      listarTodo(llamar, 'buscarEmitidos', (pg) => cuerpo(p.consulta, pg), (d) => reglasEmitidos.perteneceA(d, nit)),
      contar(llamar, 'contarEmitidos', cuerpo(p.mes)),
      contar(llamar, 'contarEmitidos', cuerpo(p.mesAnterior)),
    ]);
    return {
      docs: lista.docs,
      datos: {
        ...reglas.indicadoresEmitidos(lista.docs, p), totalMes, totalMesAnterior, completo: lista.completo,
        recientes: reglas.recientes(lista.docs, RECIENTES).map(reglasEmitidos.resumenEmitido),
      },
    };
  }

  async function recibidos(llamar, cfg, p, ahora) {
    if (!String(cfg.companyId || '').trim()) throw fallo(400, 'Configura el companyId de la compañía en Administración para ver los documentos recibidos.');
    const cuerpo = (filtros) => reglasRecibidos.filtroBusqueda(filtros, cfg, ahora).cuerpo;
    const [lista, totalMes, porGestionar] = await Promise.all([
      listarTodo(llamar, 'buscarRecibidos', (pg) => cuerpo({ ...p.consulta, pagina: pg }), (d) => reglasRecibidos.esDeLaEmpresa(d, cfg.companyId)),
      contar(llamar, 'contarRecibidos', cuerpo(p.mes)),
      // Por gestionar: sin evento final, en el último año (el máximo que permite la consulta).
      contar(llamar, 'contarRecibidos', cuerpo({ desde: p.haceUnAnio, hasta: p.hoy, estado: 'pendientes' })),
    ]);
    return {
      docs: lista.docs,
      datos: { ...reglas.indicadoresRecibidos(lista.docs, p, reglasRecibidos.ESTADO_FILTRO.pendientes), totalMes, porGestionar, completo: lista.completo },
    };
  }

  /** Cada sección se calcula por separado: si una falla, el resto del tablero se muestra con el motivo. */
  const seccion = (promesa) => promesa.then((r) => ({ ok: true, ...r }), (e) => ({ ok: false, error: e.message }));

  return {
    async obtener(actor, ahora = new Date()) {
      const compania = await companias.requerida(actor);
      const clave = await perfiles.clave(compania.id);
      const llamar = (fn, ...args) => saphety[fn](compania.id, compania.config, clave, ...args);
      const p = reglas.periodo(ahora);
      const [e, r, ultimos] = await Promise.all([
        seccion(emitidos(llamar, compania.config.nit, p)),
        seccion(recibidos(llamar, compania.config, p, ahora)),
        envios.listar({ limite: RECIENTES, perfilId: actor.rol === 'admin' ? compania.id : actor.perfilId }).catch(() => []),
      ]);
      return {
        compania: compania.nombre,
        modoEnvio: compania.config.modoEnvio === 'real' ? 'real' : 'simulado',
        hoy: p.hoy,
        mes: p.mes,
        emitidos: e.ok ? { disponible: true, ...e.datos } : { disponible: false, error: e.error },
        recibidos: r.ok ? { disponible: true, ...r.datos } : { disponible: false, error: r.error },
        serie: reglas.serieDiaria(p, e.ok ? e.docs : null, r.ok ? r.docs : null),
        envios: ultimos,
        maxDocumentos: MAX_PAGINAS * reglasEmitidos.TAMANO_PAGINA,
      };
    },
  };
}

module.exports = { crearServicioDashboard };
