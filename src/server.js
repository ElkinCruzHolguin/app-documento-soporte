'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { leerExcel } = require('./excel');
const { construirDocumento } = require('./mapper');
const { crearAlmacen } = require('./almacen');
const sesion = require('./sesion');
const saphety = require('./saphety');

const app = express();
const PUERTO = Number(process.env.PORT || 3000);
const USUARIO_APP = process.env.APP_USUARIO || '';
const CLAVE_APP = process.env.APP_CLAVE || '';
const HOST = process.env.HOST || (USUARIO_APP && CLAVE_APP ? '0.0.0.0' : '127.0.0.1');

// Perfiles e historial: Supabase en Vercel, archivos JSON en local (ver src/almacen).
let almacenCreado;
const almacen = () => (almacenCreado ||= crearAlmacen());
const perfiles = new Proxy({}, { get: (_, k) => almacen().perfiles[k] });
const envios = new Proxy({}, { get: (_, k) => almacen().envios[k] });
const usuarios = new Proxy({}, { get: (_, k) => almacen().usuarios[k] });

// ---- Acceso: si se definen APP_USUARIO y APP_CLAVE (obligatorio en Vercel) se pide inicio de sesión.
// APP_USUARIO es el super administrador; los usuarios de cada compañía se crean en Administración › Usuarios.
// Sin esas variables (solo en local) no hay inicio de sesión y se trabaja como administrador.
const AUTENTICACION = !!(USUARIO_APP && CLAVE_APP);
const firmador = sesion.crearFirmador(process.env.APP_SECRETO);
const COOKIE_SEGURA = !!process.env.VERCEL;
const HASH_FALSO = sesion.hashClave(crypto.randomBytes(16).toString('hex')); // iguala el tiempo si el usuario no existe
if (!AUTENTICACION && process.env.VERCEL) {
  // Publicada en internet sin super administrador: no se atiende nada.
  app.use((req, res) => res.status(503).send('Configura APP_USUARIO y APP_CLAVE en las variables de entorno de Vercel.'));
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const envolver = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
};
const fallo = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
const mensajeYaAceptado = (numeroExcel, aceptadoComo) =>
  `El documento ${numeroExcel} ya fue aceptado por Saphety${aceptadoComo !== numeroExcel ? ` como ${aceptadoComo}` : ''} (ver Historial).`;

// El administrador trabaja con el perfil activo; un usuario de compañía, siempre con el suyo.
const perfilDe = (req) => (req.usuario.rol === 'admin' ? perfiles.activo() : perfiles.obtener(req.usuario.perfilId));
async function perfilActivo(req) {
  const p = await perfilDe(req);
  if (!p) throw fallo(400, req.usuario.rol === 'admin' ? 'No hay un perfil activo. Crea o activa uno en Administración.' : 'Tu usuario no tiene un perfil asignado. Contacta al administrador.');
  return p;
}

// ================= Inicio de sesión =================
app.post('/api/login', envolver(async (req, res) => {
  const usuario = String((req.body && req.body.usuario) || '').trim().toLowerCase();
  const clave = String((req.body && req.body.clave) || '');
  if (!AUTENTICACION) return res.json({ ok: true, rol: 'admin' });
  const llave = `${req.ip}|${usuario}`;
  if (sesion.bloqueado(llave)) throw fallo(429, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');
  let datos = null;
  if (sesion.igualSeguro(usuario, USUARIO_APP.toLowerCase()) && sesion.igualSeguro(clave, CLAVE_APP)) {
    datos = { id: 0, usuario, rol: 'admin', perfilId: null };
  } else {
    const u = await usuarios.porNombre(usuario);
    const ok = sesion.verificarClave(clave, u ? u.claveHash : HASH_FALSO);
    if (u && ok && u.activo) {
      datos = { id: u.id, usuario: u.usuario, rol: u.rol, perfilId: u.perfilId };
      await usuarios.actualizar(u.id, { ultimoIngreso: new Date().toISOString() });
    }
  }
  if (!datos) {
    sesion.registrarFallo(llave);
    throw fallo(401, 'Usuario o contraseña incorrectos.');
  }
  sesion.limpiarFallos(llave);
  res.set('Set-Cookie', sesion.cookieSesion(firmador.emitir(datos), { segura: COOKIE_SEGURA })).json({ ok: true, rol: datos.rol });
}));

app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', sesion.cookieSesion('', { segura: COOKIE_SEGURA })).json({ ok: true });
});

// Todo lo demás de /api exige sesión. Los usuarios de compañía se revalidan en cada petición
// para que desactivarlos o cambiarles el perfil tenga efecto inmediato.
app.use('/api', envolver(async (req, res, next) => {
  if (!AUTENTICACION) {
    req.usuario = { id: 0, usuario: 'local', rol: 'admin', perfilId: null };
    return next();
  }
  const d = firmador.leer(sesion.leerCookie(req, sesion.COOKIE));
  let valido = !!d;
  if (d && d.id) {
    const u = await usuarios.obtener(d.id);
    valido = !!u && u.activo && u.rol === d.rol && (u.perfilId ?? null) === (d.perfilId ?? null);
  }
  if (!valido) {
    res.set('Set-Cookie', sesion.cookieSesion('', { segura: COOKIE_SEGURA }));
    throw fallo(401, 'Tu sesión terminó. Inicia sesión de nuevo.');
  }
  req.usuario = d;
  next();
}));

const soloAdmin = (req, res, next) => (req.usuario.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo el administrador puede hacer esto.' }));
app.use('/api/perfiles', soloAdmin);
app.use('/api/usuarios', soloAdmin);

// ================= Perfiles (Administración) =================
const CAMPOS_NUMERICOS = ['siguienteConsecutivo'];
const CAMPOS_BOOLEANOS = ['incluirIvaCero', 'incluirTelefono'];
function limpiarConfig(entrada) {
  const c = { ...(entrada || {}) };
  for (const k of CAMPOS_NUMERICOS) if (k in c) c[k] = Number(c[k]) || 0;
  for (const k of CAMPOS_BOOLEANOS) if (k in c) c[k] = c[k] === true || c[k] === 'true';
  for (const [k, v] of Object.entries(c)) if (typeof v === 'string') c[k] = v.trim();
  for (const [k, nombre] of [['tiposDocumento', 'tipos de documento']]) {
    if (typeof c[k] !== 'string') continue;
    try { c[k] = JSON.parse(c[k]); } catch { throw fallo(400, `La tabla de ${nombre} no es un JSON válido.`); }
  }
  return c;
}

app.get('/api/perfiles', envolver(async (req, res) => res.json(await perfiles.listar())));

app.post('/api/perfiles', envolver(async (req, res) => {
  const { nombre, config, clave } = req.body || {};
  if (!nombre || !String(nombre).trim()) throw fallo(400, 'El perfil necesita un nombre.');
  res.json(await perfiles.crear(String(nombre).trim(), limpiarConfig(config), clave));
}));

app.put('/api/perfiles/:id', envolver(async (req, res) => {
  const actual = await perfiles.obtener(req.params.id);
  if (!actual) throw fallo(404, 'Perfil no encontrado.');
  const { nombre, config, clave } = req.body || {};
  saphety.olvidarToken(actual.id);
  res.json(await perfiles.actualizar(actual.id, String(nombre || actual.nombre).trim(), { ...actual.config, ...limpiarConfig(config) }, clave));
}));

app.post('/api/perfiles/:id/activar', envolver(async (req, res) => {
  if (!(await perfiles.obtener(req.params.id))) throw fallo(404, 'Perfil no encontrado.');
  await perfiles.activar(req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/perfiles/:id', envolver(async (req, res) => {
  const p = await perfiles.obtener(req.params.id);
  if (!p) throw fallo(404, 'Perfil no encontrado.');
  if (p.activo) throw fallo(400, 'No se puede eliminar el perfil activo.');
  await perfiles.eliminar(p.id);
  res.json({ ok: true });
}));

// Solo pide el token: sirve para comprobar usuario, contraseña y opv.
app.post('/api/perfiles/:id/probar', envolver(async (req, res) => {
  const p = await perfiles.obtener(req.params.id);
  if (!p) throw fallo(404, 'Perfil no encontrado.');
  await saphety.obtenerToken(p.id, p.config, await perfiles.clave(p.id), { forzar: true });
  res.json({ ok: true, mensaje: 'Token obtenido correctamente.' });
}));

app.get('/api/perfiles/:id/catalogo/:nombre', envolver(async (req, res) => {
  const p = await perfiles.obtener(req.params.id);
  if (!p) throw fallo(404, 'Perfil no encontrado.');
  if (!/^[a-z]+$/i.test(req.params.nombre)) throw fallo(400, 'Nombre de catálogo inválido.');
  res.json(await saphety.catalogo(p.id, p.config, await perfiles.clave(p.id), req.params.nombre));
}));

// ================= Conversión: Excel -> JSON (no se guarda nada) =================
app.post('/api/convertir', express.raw({ type: () => true, limit: '30mb' }), envolver(async (req, res) => {
  if (!req.body || !req.body.length) throw fallo(400, 'No llegó ningún archivo.');
  const perfil = await perfilActivo(req);
  let excel;
  try {
    excel = await leerExcel(req.body);
  } catch (e) {
    throw fallo(400, `No se pudo leer el Excel: ${e.message}`);
  }
  if (excel.faltantes.length) throw fallo(400, `Al Excel le faltan columnas: ${excel.faltantes.join(', ')}`);
  if (!excel.filas.length) throw fallo(400, 'El Excel no tiene filas con datos.');

  const vistos = new Set();
  const documentos = excel.filas.map(({ numeroFila, datos }) => {
    const v = construirDocumento(datos, perfil.config);
    if (vistos.has(v.resumen.numero)) v.errores.push(`Número ${v.resumen.numero} repetido dentro del archivo.`);
    vistos.add(v.resumen.numero);
    return { fila: numeroFila, datos, ...v.resumen, errores: v.errores, advertencias: v.advertencias, json: v.json };
  });

  // El historial dice qué documentos del Excel (PREFIJO + FOLIO) ya se enviaron, en cualquier modo de numeración.
  if (perfil.config.nit) {
    const previos = await envios.previos(soloDigitos(perfil.config.nit), [...vistos]);
    for (const d of documentos) {
      const p = previos.get(d.numero);
      if (p && p.aceptadoComo) d.errores.push(mensajeYaAceptado(d.numero, p.aceptadoComo));
      else if (p && p.errorEnvio) d.advertencias.push(`El último envío de ${d.numero} quedó con error de conexión: revisa en Saphety si se creó antes de reenviarlo.`);
    }
  }
  res.json({ hoja: excel.hoja, columnas: excel.columnas, documentos });
}));

// ================= Envío de un documento =================
// El navegador llama una vez por fila; así ve el avance. Los envíos reales quedan en el historial.
app.post('/api/enviar', envolver(async (req, res) => {
  const { datos, confirmado, indice } = req.body || {};
  if (!datos || typeof datos !== 'object') throw fallo(400, 'Faltan los datos de la fila.');
  const perfil = await perfilActivo(req);
  const cfg = perfil.config;
  const real = cfg.modoEnvio === 'real';
  if (real && !confirmado) throw fallo(400, 'El envío real necesita confirmación.');

  // Se valida primero sin reservar consecutivo, para no gastar números en filas con errores.
  const previa = construirDocumento(datos, cfg);
  if (previa.errores.length) return res.json({ estado: 'con_errores', errores: previa.errores, json: previa.json });
  const nit = soloDigitos(cfg.nit);
  const numeroExcel = previa.resumen.numero;
  if (real) {
    const p = (await envios.previos(nit, [numeroExcel])).get(numeroExcel);
    if (p && p.aceptadoComo) return res.json({ estado: 'con_errores', errores: [mensajeYaAceptado(numeroExcel, p.aceptadoComo)], json: previa.json });
  }

  let numeracion;
  if (cfg.numeracion === 'consecutivo') {
    numeracion = real ? await perfiles.tomarConsecutivo(perfil.id) : { prefijo: cfg.prefijoConsecutivo, numero: String(Number(cfg.siguienteConsecutivo) + (Number(indice) || 0)) };
  }
  const { json, resumen } = construirDocumento(datos, cfg, { numeracion });
  const numero = `${json.SeriePrefix}${json.SerieNumber}`;
  let r;
  try {
    r = real ? await saphety.crearDocumentoSoporte(perfil.id, cfg, await perfiles.clave(perfil.id), json) : saphety.simular(json);
  } catch (e) {
    r = { estado: 'error_envio', mensaje: e.message, detener: /token/i.test(e.message) };
  }
  const salida = { ...r, modo: real ? 'real' : 'simulado', numero, json };
  if (real) {
    try {
      salida.envioId = await envios.registrar({
        perfilId: perfil.id, perfilNombre: perfil.nombre, modo: 'real', estado: r.estado, numero, numeroExcel, nitAdquiriente: nit,
        proveedor: resumen.proveedor, identificacion: resumen.identificacion, valor: resumen.valor,
        saphetyId: r.saphetyId || null, cuds: r.cuds || null, mensaje: r.mensaje || '', documento: json, respuesta: r.respuesta || null,
      });
    } catch (e) {
      console.error(e);
      salida.mensaje = `${salida.mensaje || ''}\nAviso: no se pudo guardar en el historial (${e.message}). Descarga los resultados.`.trim();
    }
  }
  res.json(salida);
}));

// ================= Historial de envíos reales =================
app.get('/api/envios', envolver(async (req, res) => {
  const limite = Math.min(Math.max(Number(req.query.limite) || 100, 1), 500);
  const perfilId = req.usuario.rol === 'admin' ? null : req.usuario.perfilId;
  res.json(await envios.listar({ buscar: String(req.query.buscar || ''), limite, perfilId }));
}));

app.get('/api/envios/:id', envolver(async (req, res) => {
  const e = await envios.obtener(req.params.id);
  if (!e || (req.usuario.rol !== 'admin' && e.perfilId !== req.usuario.perfilId)) throw fallo(404, 'Envío no encontrado.');
  res.json(e);
}));

app.get('/api/estado', envolver(async (req, res) => {
  const p = await perfilDe(req);
  res.json({
    usuario: { usuario: req.usuario.usuario, rol: req.usuario.rol, login: AUTENTICACION },
    perfil: p && { id: p.id, nombre: p.nombre, modoEnvio: p.config.modoEnvio, url: p.config.url, numeracion: p.config.numeracion },
  });
}));

// ================= Usuarios (solo administrador) =================
const ROLES = ['admin', 'empresa'];
async function validarUsuario({ rol, perfilId }) {
  if (!ROLES.includes(rol)) throw fallo(400, 'Rol inválido.');
  if (rol === 'empresa' && !(await perfiles.obtener(perfilId))) throw fallo(400, 'Elige el perfil (compañía) del usuario.');
}
function validarClave(clave) {
  if (String(clave || '').length < 10) throw fallo(400, 'La contraseña debe tener al menos 10 caracteres.');
}

app.get('/api/usuarios', envolver(async (req, res) => res.json(await usuarios.listar())));

app.post('/api/usuarios', envolver(async (req, res) => {
  const { clave, rol = 'empresa' } = req.body || {};
  const usuario = String((req.body && req.body.usuario) || '').trim().toLowerCase();
  if (!/^[a-z0-9._@-]{3,60}$/.test(usuario)) throw fallo(400, 'El usuario debe tener entre 3 y 60 caracteres: letras, números, punto, guion, guion bajo o @.');
  if (USUARIO_APP && usuario === USUARIO_APP.toLowerCase()) throw fallo(400, 'Ese nombre está reservado para el super administrador.');
  validarClave(clave);
  const perfilId = rol === 'empresa' ? Number(req.body.perfilId) : null;
  await validarUsuario({ rol, perfilId });
  res.json(await usuarios.crear({ usuario, claveHash: sesion.hashClave(clave), rol, perfilId }));
}));

app.put('/api/usuarios/:id', envolver(async (req, res) => {
  const actual = await usuarios.obtener(req.params.id);
  if (!actual) throw fallo(404, 'Usuario no encontrado.');
  const b = req.body || {};
  const cambios = {};
  if (b.clave) { validarClave(b.clave); cambios.claveHash = sesion.hashClave(b.clave); }
  if ('activo' in b) cambios.activo = !!b.activo;
  if ('rol' in b || 'perfilId' in b) {
    const rol = b.rol || actual.rol;
    const perfilId = rol === 'empresa' ? Number(b.perfilId ?? actual.perfilId) : null;
    await validarUsuario({ rol, perfilId });
    Object.assign(cambios, { rol, perfilId });
  }
  res.json(await usuarios.actualizar(actual.id, cambios));
}));

app.delete('/api/usuarios/:id', envolver(async (req, res) => {
  if (!(await usuarios.obtener(req.params.id))) throw fallo(404, 'Usuario no encontrado.');
  await usuarios.eliminar(req.params.id);
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.status === 413 ? 'El archivo es demasiado grande.' : err.message });
});

if (require.main === module) {
  app.listen(PUERTO, HOST, () => {
    console.log(`App de documentos soporte en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PUERTO}`);
    console.log(`Datos en: ${almacen().tipo === 'supabase' ? 'Supabase' : 'archivos locales (data/)'}`);
    if (!USUARIO_APP || !CLAVE_APP) console.log('Sin APP_USUARIO/APP_CLAVE: solo se escucha en 127.0.0.1.');
  });
}

module.exports = { app };
