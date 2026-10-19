// Utilidades compartidas por las páginas.

// Menú lateral: una sola lista para todas las páginas. Para agregar una página nueva basta con sumarla aquí
// y poner <nav id="menu" data-activo="mi-pagina.html"></nav> en su HTML.
const MENU = [
  { href: 'dashboard.html', texto: 'Dashboard' },
  { href: 'index.html', texto: 'Cargar y enviar' },
  { href: 'emitidos.html', texto: 'Emitidos' },
  { href: 'recibidos.html', texto: 'Recibidos' },
  { href: 'historial.html', texto: 'Historial' },
  { href: 'admin.html', texto: 'Administración', admin: true },
];

function pintarMenu() {
  const nav = document.getElementById('menu');
  if (!nav) return;
  const activo = nav.dataset.activo || location.pathname.split('/').pop() || 'index.html';
  nav.innerHTML = MENU.map((m) => `<a href="${m.href}"${m.href === activo ? ' class="activo"' : ''}${m.admin ? ' data-enlace-admin' : ''}>${m.texto}</a>`).join('');
}
document.addEventListener('DOMContentLoaded', pintarMenu);
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
  simulado: 'Simulado', error_envio: 'Error de envío', en_proceso: 'En proceso',
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
      ? ` · <b>${esc(usuario.usuario)}</b>${esAdmin ? ' (admin)' : ' · <a href="cuenta.html">Mi contraseña</a>'} · <a href="#" id="btnSalir">Salir</a>`
      : '';
    el.innerHTML = `${perfil ? `Compañía <b>${esc(perfil.nombre)}</b> · ` : ''}${modo}${quien}`;
    const btn = document.getElementById('btnSalir');
    if (btn) btn.onclick = (ev) => { ev.preventDefault(); salir(); };
  } catch (e) {
    el.textContent = e.message;
  }
}
document.addEventListener('DOMContentLoaded', pintarBanner);
