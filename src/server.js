'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { leerExcel } = require('./excel');
const { construirDocumento } = require('./mapper');
const { crearAlmacen } = require('./almacen');
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

// ---- Acceso: autenticación básica si se definen APP_USUARIO y APP_CLAVE.
function igualSeguro(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
if (USUARIO_APP && CLAVE_APP) {
  app.use((req, res, next) => {
    const [tipo, valor] = String(req.headers.authorization || '').split(' ');
    if (tipo === 'Basic' && valor) {
      const [u, ...resto] = Buffer.from(valor, 'base64').toString('utf8').split(':');
      if (igualSeguro(u, USUARIO_APP) && igualSeguro(resto.join(':'), CLAVE_APP)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Documentos soporte", charset="UTF-8"').status(401).send('Autenticación requerida');
  });
} else if (process.env.VERCEL) {
  // Publicada en internet sin usuario y clave: no se atiende nada.
  app.use((req, res) => res.status(503).send('Configura APP_USUARIO y APP_CLAVE en las variables de entorno de Vercel.'));
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const envolver = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({ error: e.message });
  }
};
const fallo = (status, mensaje) => Object.assign(new Error(mensaje), { status });
const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
const mensajeYaAceptado = (numeroExcel, aceptadoComo) =>
  `El documento ${numeroExcel} ya fue aceptado por Saphety${aceptadoComo !== numeroExcel ? ` como ${aceptadoComo}` : ''} (ver Historial).`;

async function perfilActivo() {
  const p = await perfiles.activo();
  if (!p) throw fallo(400, 'No hay un perfil activo. Crea o activa uno en Administración.');
  return p;
}

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
  const perfil = await perfilActivo();
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
  const perfil = await perfilActivo();
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
  res.json(await envios.listar({ buscar: String(req.query.buscar || ''), limite }));
}));

app.get('/api/envios/:id', envolver(async (req, res) => {
  const e = await envios.obtener(req.params.id);
  if (!e) throw fallo(404, 'Envío no encontrado.');
  res.json(e);
}));

app.get('/api/estado', envolver(async (req, res) => {
  const p = await perfiles.activo();
  res.json({ perfil: p && { id: p.id, nombre: p.nombre, modoEnvio: p.config.modoEnvio, url: p.config.url, numeracion: p.config.numeracion } });
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
