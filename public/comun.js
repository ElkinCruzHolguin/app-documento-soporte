// Utilidades compartidas por las páginas.

// Menú lateral: una sola lista para todas las páginas. Para agregar una página nueva basta con sumarla aquí
// y poner <nav id="menu" data-activo="mi-pagina.html"></nav> en su HTML.
// `modulo` es el módulo que habilita la página (ver src/dominio/modulos.js).
const MENU = [
  { href: 'dashboard.html', texto: 'Dashboard', modulo: 'dashboard' },
  { href: 'index.html', texto: 'Cargar y enviar', modulo: 'cargar' },
  { href: 'emitidos.html', texto: 'Emitidos', modulo: 'emitidos' },
  { href: 'recibidos.html', texto: 'Recibidos', modulo: 'recibidos' },
  { href: 'historial.html', texto: 'Historial', modulo: 'historial' },
  { href: 'admin.html', texto: 'Administración', admin: true, modulo: 'compania' },
];
// Páginas de detalle que no están en el menú.
const MODULO_DE_PAGINA = { 'documento.html': 'emitidos', 'recibido.html': 'recibidos' };
const paginaActual = () => location.pathname.split('/').pop() || 'index.html';
const moduloDePagina = (pagina) => (MENU.find((m) => m.href === pagina) || {}).modulo || MODULO_DE_PAGINA[pagina];

// Lo que puede ver el usuario se guarda en la pestaña para pintar el menú ya filtrado al cargar cada
// página. Sin esto se alcanzan a ver un instante los módulos ocultos (el servidor igual los bloquea).
const LLAVE_MENU = 'ds_menu';
const leerMenu = () => { try { return JSON.parse(sessionStorage.getItem(LLAVE_MENU)); } catch { return null; } };
const guardarMenu = (v) => { try { if (v) sessionStorage.setItem(LLAVE_MENU, JSON.stringify(v)); else sessionStorage.removeItem(LLAVE_MENU); } catch { /* sin almacenamiento */ } };

/** Muestra en el menú solo los módulos del usuario y lo saca de una página que no puede ver. */
function aplicarModulos(modulos, esAdmin) {
  const nav = document.getElementById('menu');
  if (!Array.isArray(modulos)) { if (nav) nav.classList.remove('cargando'); return; }
  guardarMenu({ modulos, esAdmin });
  document.querySelectorAll('#menu a[data-modulo]').forEach((a) => { a.hidden = !modulos.includes(a.dataset.modulo); });
  // Un usuario de compañía ve la configuración de la suya en solo lectura (el servidor impide modificarla).
  if (!esAdmin) document.querySelectorAll('[data-enlace-admin]').forEach((a) => { a.textContent = 'Mi compañía'; });
  if (nav) nav.classList.remove('cargando');
  const modulo = moduloDePagina(paginaActual());
  if (modulo && !modulos.includes(modulo)) {
    const destino = MENU.find((m) => modulos.includes(m.modulo));
    location.replace(destino ? destino.href : 'cuenta.html');
  }
}

function pintarMenu() {
  const nav = document.getElementById('menu');
  if (!nav) return;
  const activo = nav.dataset.activo || paginaActual();
  const previo = leerMenu();
  const visible = (m) => !previo || previo.modulos.includes(m.modulo);
  const texto = (m) => (m.admin && previo && !previo.esAdmin ? 'Mi compañía' : m.texto);
  nav.innerHTML = MENU.map((m) => `<a href="${m.href}" data-modulo="${m.modulo}"${m.href === activo ? ' class="activo"' : ''}${m.admin ? ' data-enlace-admin' : ''}${visible(m) ? '' : ' hidden'}>${texto(m)}</a>`).join('');
  // El cuadro de compañía (banner) va dentro del menú, justo debajo de Dashboard.
  const banner = document.getElementById('banner');
  const dashboard = nav.querySelector('a[data-modulo="dashboard"]');
  if (banner && dashboard) dashboard.after(banner);
  // Primera página de la sesión: el menú espera a saber qué módulos tiene el usuario.
  if (!previo) nav.classList.add('cargando');
}
document.addEventListener('DOMContentLoaded', pintarMenu);
async function api(ruta, opciones = {}) {
  const resp = await fetch(ruta, opciones);
  if (resp.status === 401) {
    // Sin sesión o sesión vencida: a la pantalla de inicio de sesión.
    guardarMenu(null);
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
  guardarMenu(null);
  await fetch('/api/logout', { method: 'POST' });
  location.href = 'login.html';
}

async function pintarBanner() {
  const el = document.getElementById('banner');
  if (!el) return;
  try {
    const { perfil, usuario } = await api('/api/estado');
    const esAdmin = usuario.rol === 'admin';
    aplicarModulos(usuario.modulos, esAdmin);
    // El modo de envío (real/simulado) no se muestra aquí porque confundía; se ve y cambia en Administración.
    const modo = !perfil ? '<span class="chip con_errores">Sin compañía</span>' : '';
    // Administrador o usuario ligado a varias compañías (p. ej. QA y producción): elige con cuál trabajar.
    const otras = usuario.companias || [];
    const sinElegir = !perfil ? '<option value="" selected disabled>Elige una compañía</option>' : '';
    const compania = otras.length > 1 || (esAdmin && otras.length && !perfil)
      ? `<select id="selCompania" class="selector-compania" aria-label="Cambiar de compañía">${sinElegir}${otras.map((c) => `<option value="${c.id}" ${perfil && c.id === perfil.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>`
      : perfil ? `<div class="banner-nombre">${esc(perfil.nombre)}</div>` : '';
    const quien = usuario.login
      ? `<div class="banner-usuario" title="${esc(usuario.usuario)}">${esc(usuario.usuario)}${esAdmin ? ' (admin)' : ''}</div>
         <div class="banner-enlaces">${usuario.cambiaClave ? '<a href="cuenta.html">Cambiar contraseña</a> · ' : ''}<a href="#" id="btnSalir">Salir</a></div>`
      : '';
    el.innerHTML = `<div class="banner-compania"><span class="banner-etiqueta">Compañía</span>${compania}${modo ? `<div>${modo}</div>` : ''}</div>${quien}`;
    const sel = document.getElementById('selCompania');
    if (sel) {
      sel.onchange = async () => {
        sel.disabled = true;
        try {
          // El administrador cambia la compañía activa (como «Trabajar con esta compañía»); el usuario, la de su sesión.
          if (esAdmin) await api(`/api/perfiles/${encodeURIComponent(sel.value)}/activar`, { method: 'POST' });
          else await api('/api/sesion/compania', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perfilId: Number(sel.value) }) });
          guardarMenu(null); // la otra compañía puede tener otros módulos
          location.reload();
        } catch (e) { sel.disabled = false; alert(e.message); }
      };
    }
    const btn = document.getElementById('btnSalir');
    if (btn) btn.onclick = (ev) => { ev.preventDefault(); salir(); };
  } catch (e) {
    el.textContent = e.message;
  }
}
document.addEventListener('DOMContentLoaded', pintarBanner);

/**
 * Ventana de confirmación con el diseño de la app (reemplaza al confirm() del navegador).
 * @returns {Promise<boolean>} true si el usuario acepta.
 */
function confirmar(mensaje, { titulo = 'Confirmar', aceptar = 'Aceptar', cancelar = 'Cancelar', peligro = false } = {}) {
  return new Promise((resolver) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirmar';
    dlg.innerHTML = `<div class="cabeza">${esc(titulo)}</div>
      <div class="cuerpo">${esc(mensaje)}</div>
      <div class="pie"><button type="button" class="secundario" data-r="no">${esc(cancelar)}</button>
      <button type="button" class="${peligro ? 'peligro' : ''}" data-r="si">${esc(aceptar)}</button></div>`;
    let respuesta = false;
    dlg.querySelector('[data-r="si"]').onclick = () => { respuesta = true; dlg.close(); };
    dlg.querySelector('[data-r="no"]').onclick = () => dlg.close();
    dlg.addEventListener('close', () => { dlg.remove(); resolver(respuesta); });
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector('[data-r="si"]').focus();
  });
}
