// Utilidades compartidas por las páginas.
async function api(ruta, opciones = {}) {
  const resp = await fetch(ruta, opciones);
  const tipo = resp.headers.get('content-type') || '';
  const datos = tipo.includes('json') ? await resp.json() : await resp.text();
  if (!resp.ok) throw new Error((datos && datos.error) || `HTTP ${resp.status}`);
  return datos;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ETIQUETAS_ESTADO = {
  pendiente: 'Listo para enviar', con_errores: 'Con errores', aceptado: 'Aceptado', rechazado: 'Rechazado',
  simulado: 'Simulado', error_envio: 'Error de envío',
};
const chip = (estado) => `<span class="chip ${esc(estado)}">${esc(ETIQUETAS_ESTADO[estado] || estado)}</span>`;
const pesos = (n) => (n == null ? '' : Number(n).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

async function pintarBanner() {
  const el = document.getElementById('banner');
  if (!el) return;
  try {
    const { perfil } = await api('/api/estado');
    if (!perfil) { el.innerHTML = '<span class="chip con_errores">Sin perfil activo</span>'; return; }
    const modo = perfil.modoEnvio === 'real'
      ? '<span class="chip real">ENVÍO REAL</span>'
      : '<span class="chip simulado">Modo simulado</span>';
    el.innerHTML = `Perfil <b>${esc(perfil.nombre)}</b> · ${modo}`;
  } catch (e) {
    el.textContent = e.message;
  }
}
document.addEventListener('DOMContentLoaded', pintarBanner);
