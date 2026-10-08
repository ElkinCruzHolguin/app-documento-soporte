// Utilidades compartidas por las páginas.
async function api(ruta, opciones = {}) {
  const resp = await fetch(ruta, opciones);
  if (resp.status === 401) {
    // Sin sesión o sesión vencida: a la pantalla de inicio de sesión.
    location.href = 'login.html';
    throw new Error('Inicia sesión.');
  }
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

async function salir() {
  await fetch('/api/logout', { method: 'POST' });
  location.href = 'login.html';
}

async function pintarBanner() {
  const el = document.getElementById('banner');
  if (!el) return;
  try {
    const { perfil, usuario } = await api('/api/estado');
    const esAdmin = usuario.rol === 'admin';
    // Un usuario de compañía ve la configuración de la suya en solo lectura (el servidor impide modificarla).
    if (!esAdmin) document.querySelectorAll('[data-enlace-admin]').forEach((a) => { a.textContent = 'Mi compañía'; });
    const modo = !perfil ? '<span class="chip con_errores">Sin compañía</span>'
      : perfil.modoEnvio === 'real' ? '<span class="chip real">ENVÍO REAL</span>' : '<span class="chip simulado">Modo simulado</span>';
    const quien = usuario.login
      ? ` · <b>${esc(usuario.usuario)}</b>${esAdmin ? ' (admin)' : ''} · <a href="#" id="btnSalir">Salir</a>`
      : '';
    el.innerHTML = `${perfil ? `Compañía <b>${esc(perfil.nombre)}</b> · ` : ''}${modo}${quien}`;
    const btn = document.getElementById('btnSalir');
    if (btn) btn.onclick = (ev) => { ev.preventDefault(); salir(); };
  } catch (e) {
    el.textContent = e.message;
  }
}
document.addEventListener('DOMContentLoaded', pintarBanner);
