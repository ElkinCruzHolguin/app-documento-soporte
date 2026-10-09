'use strict';
// Cliente de la API de Saphety: 1) pide el token, 2) crea el documento soporte.
// Igual que en Postman: POST {url}/v2/auth/gettoken y luego
// POST {url}/v2/{opv}/outbounddocuments/supportDocument con "Authorization: Bearer <token>".

const crypto = require('node:crypto');

const tokens = new Map(); // perfilId -> { token, vence (ms), firma }

const base = (cfg) => String(cfg.url || '').replace(/\/+$/, '');

async function pedirJson(url, opciones) {
  const resp = await fetch(url, { ...opciones, signal: AbortSignal.timeout(90_000) });
  const cuerpo = await resp.text();
  let datos;
  try { datos = cuerpo ? JSON.parse(cuerpo) : null; } catch { datos = { textoPlano: cuerpo.slice(0, 2000) }; }
  return { status: resp.status, datos };
}

async function obtenerToken(perfilId, cfg, clave, { forzar = false } = {}) {
  if (!cfg.url || !cfg.usuario || !clave || !cfg.opv) {
    throw new Error('Faltan URL, usuario, contraseña u operador virtual (opv) en Administración.');
  }
  // La firma invalida el token en caché si cambian las credenciales.
  const firma = crypto.createHash('sha256').update([cfg.url, cfg.usuario, clave, cfg.opv].join('|')).digest('hex');
  const cache = tokens.get(perfilId);
  if (!forzar && cache && cache.firma === firma && cache.vence - Date.now() > 120_000) return cache.token;

  const { status, datos } = await pedirJson(`${base(cfg)}/v2/auth/gettoken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.usuario, password: clave, virtual_operator: cfg.opv }),
  });
  const rd = datos && datos.ResultData;
  if (status !== 200 || !rd || !rd.access_token) {
    const detalle = datos && Array.isArray(datos.Errors) && datos.Errors.length
      ? datos.Errors.map((e) => e.Description).join('; ')
      : JSON.stringify(datos).slice(0, 300);
    throw new Error(`No se obtuvo el token (HTTP ${status}): ${detalle}`);
  }
  const vence = Date.parse(rd.expires) || Date.now() + 30 * 60_000;
  tokens.set(perfilId, { token: rd.access_token, vence, firma });
  return rd.access_token;
}

function olvidarToken(perfilId) {
  tokens.delete(perfilId);
}

/** Resume la respuesta de Saphety en un mensaje legible. */
function mensajeRespuesta(datos) {
  if (!datos) return 'Respuesta vacía';
  const partes = [];
  const vistos = new Set(); // Saphety a veces repite el mismo error

  for (const e of datos.Errors || []) {
    const clave = JSON.stringify(e);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    partes.push([e.Code, e.Field, e.Description].filter(Boolean).join(': '));
    for (const x of e.ExplanationValues || []) partes.push(`  • ${x}`);
  }
  for (const w of datos.Warnings || []) {
    partes.push(`Aviso: ${[w.Code, w.Description].filter(Boolean).join(': ')}`);
    for (const x of w.ExplanationValues || []) partes.push(`  • ${x}`);
  }
  if (datos.textoPlano) partes.push(datos.textoPlano);
  return partes.join('\n');
}

async function crearDocumentoSoporte(perfilId, cfg, clave, documento) {
  const ruta = cfg.endpoint === 'async' ? 'supportDocumentAsync' : 'supportDocument';
  const url = `${base(cfg)}/v2/${encodeURIComponent(cfg.opv)}/outbounddocuments/${ruta}`;
  const enviar = async (token) => pedirJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(documento),
  });

  let r = await enviar(await obtenerToken(perfilId, cfg, clave));
  if (r.status === 401) {
    // Token vencido o revocado: se pide uno nuevo y se reintenta una vez.
    r = await enviar(await obtenerToken(perfilId, cfg, clave, { forzar: true }));
  }
  const datos = r.datos || {};
  const rd = datos.ResultData || {};
  const valido = r.status >= 200 && r.status < 300 && datos.IsValid !== false;
  return {
    estado: valido ? 'aceptado' : 'rechazado',
    respuesta: datos,
    saphetyId: rd.Id || null,
    cuds: rd.CUFE || rd.CUDS || null,
    mensaje: mensajeRespuesta(datos) || (valido ? 'Documento creado' : `HTTP ${r.status}`),
  };
}

/** Modo simulado: no sale nada a internet, devuelve una respuesta con la forma de Saphety. */
function simular(documento) {
  const id = crypto.randomUUID();
  return {
    estado: 'simulado',
    respuesta: {
      IsValid: true,
      Warnings: [],
      Errors: [],
      ResultData: { Id: id, CorrelationDocumentId: documento.CorrelationDocumentId, CUFE: '(simulado)' },
      ResultCode: 200,
      Simulado: true,
    },
    saphetyId: id,
    cuds: null,
    mensaje: 'Simulado: el JSON se generó pero no se envió a Saphety.',
  };
}

/** Consulta un catálogo público de Saphety (por ejemplo identificationdocumenttypes). */
async function catalogo(perfilId, cfg, clave, nombre) {
  const token = await obtenerToken(perfilId, cfg, clave);
  const { status, datos } = await pedirJson(`${base(cfg)}/v2/dataelements/${encodeURIComponent(nombre)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (status !== 200) throw new Error(`HTTP ${status}: ${JSON.stringify(datos).slice(0, 300)}`);
  return datos;
}

module.exports = { obtenerToken, olvidarToken, crearDocumentoSoporte, simular, catalogo, mensajeRespuesta };
