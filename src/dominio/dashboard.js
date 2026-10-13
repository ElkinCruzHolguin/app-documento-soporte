'use strict';
// Reglas del tablero: periodos (en hora de Colombia) e indicadores calculados con los documentos de Saphety.
// Sin HTTP ni base de datos.
const { hoyBogota, estadoApp } = require('./emitidos');

const DIAS_SERIE = 7;
const sumarDias = (fecha, dias) => new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86400e3).toISOString().slice(0, 10);
/** Día en Colombia (AAAA-MM-DD) de una fecha ISO de Saphety. */
const diaBogota = (iso) => (iso ? hoyBogota(new Date(iso)) : null);

/** Mes en curso, mes anterior y los últimos 7 días, como fechas AAAA-MM-DD de Colombia. */
function periodo(ahora = new Date()) {
  const hoy = hoyBogota(ahora);
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const inicioSerie = sumarDias(hoy, -(DIAS_SERIE - 1));
  const finMesAnterior = sumarDias(inicioMes, -1);
  return {
    hoy,
    haceUnAnio: sumarDias(hoy, -365),
    mes: { desde: inicioMes, hasta: hoy },
    mesAnterior: { desde: `${finMesAnterior.slice(0, 8)}01`, hasta: finMesAnterior },
    // Lo que se lista en Saphety: el mes y, si el mes lleva menos de 7 días, los días que faltan para la gráfica.
    consulta: { desde: inicioSerie < inicioMes ? inicioSerie : inicioMes, hasta: hoy },
    dias: Array.from({ length: DIAS_SERIE }, (_, i) => sumarDias(inicioSerie, i)),
  };
}

const delMes = (docs, p) => docs.filter((d) => { const dia = diaBogota(d.CreationDate); return dia >= p.mes.desde && dia <= p.mes.hasta; });
const delDia = (docs, dia) => docs.filter((d) => diaBogota(d.CreationDate) === dia).length;
const valorCop = (docs) => docs.reduce((s, d) => s + ((d.Currency || 'COP') === 'COP' ? Number(d.TotalAmount) || 0 : 0), 0);

/** Indicadores de los documentos emitidos del mes. */
function indicadoresEmitidos(docs, p) {
  const mes = delMes(docs, p);
  const porEstado = { aceptado: 0, en_proceso: 0, rechazado: 0 };
  for (const d of mes) porEstado[estadoApp(d.DocumentStatus)] += 1;
  return {
    listadosMes: mes.length,
    valorMes: valorCop(mes),
    hoy: delDia(docs, p.hoy),
    porEstado,
    tasaAceptacion: mes.length ? porEstado.aceptado / mes.length : null,
  };
}

/** Indicadores de los documentos recibidos del mes. */
function indicadoresRecibidos(docs, p, pendientes) {
  const mes = delMes(docs, p);
  return { listadosMes: mes.length, valorMes: valorCop(mes), hoy: delDia(docs, p.hoy), porGestionarMes: mes.filter((d) => pendientes.includes(d.DocumentStatus)).length };
}

/** Documentos por día (últimos 7 días) para la gráfica de volumen. */
const serieDiaria = (p, emitidos, recibidos) => p.dias.map((dia) => ({
  dia, emitidos: emitidos ? delDia(emitidos, dia) : null, recibidos: recibidos ? delDia(recibidos, dia) : null,
}));

/** Los más recientes primero. */
const recientes = (docs, n) => [...docs].sort((a, b) => String(b.CreationDate || '').localeCompare(String(a.CreationDate || ''))).slice(0, n);

module.exports = { DIAS_SERIE, periodo, diaBogota, indicadoresEmitidos, indicadoresRecibidos, serieDiaria, recientes };
