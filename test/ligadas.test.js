'use strict';
// Usuario ligado a varias compañías (p. ej. Vitro QA y Vitro PRD) que cambia de una a otra.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-ligadas-'));
process.env.APP_USUARIO = 'Jefe';
process.env.APP_CLAVE = 'clave-del-jefe-123';
process.env.APP_SECRETO = 'secreto-de-prueba';
const { app } = require('../src/server');
const { companiasDe, limpiarCompanias } = require('../src/dominio/accesos');
const { fallo } = require('../src/dominio/errores');

test('dominio: compañías de un usuario', () => {
  assert.deepStrictEqual(companiasDe({ rol: 'empresa', perfilId: 6, companias: [7, 6] }), [6, 7]);
  assert.deepStrictEqual(companiasDe({ rol: 'empresa', perfilId: 6 }), [6], 'usuarios antiguos: solo la principal');
  assert.deepStrictEqual(companiasDe({ rol: 'admin', perfilId: null, companias: [1] }), []);
  assert.deepStrictEqual(limpiarCompanias(['7', 5, 7], fallo), [5, 7]);
  assert.throws(() => limpiarCompanias(['x'], fallo), /inválida/);
});

test('API: ligar Vitro QA y PRD a un usuario y cambiar de ambiente', async () => {
  const s = await new Promise((resolve) => { const x = http.createServer(app).listen(0, '127.0.0.1', () => resolve(x)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const llamar = async (ruta, { cookie, metodo = 'GET', cuerpo } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const datos = await r.json().catch(() => null);
    return { status: r.status, datos, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  const entrar = async (usuario, clave) => (await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario, clave } })).cookie;

  try {
    const jefe = await entrar('jefe', 'clave-del-jefe-123');
    const crearCompania = async (nombre, config = {}) => (await llamar('/api/perfiles', { cookie: jefe, metodo: 'POST', cuerpo: { nombre, config } })).datos;
    const qa = await crearCompania('Vitro QA');
    const prd = await crearCompania('Vitro PRD', { modulos: ['cargar', 'historial'] });
    const atica = await crearCompania('Atica QA');

    const ana = (await llamar('/api/usuarios', { cookie: jefe, metodo: 'POST', cuerpo: { usuario: 'ana@vitro.com', clave: 'clave-larga-123', perfilId: qa.id, companias: [prd.id, qa.id] } })).datos;
    assert.deepStrictEqual(ana.companias, [prd.id], 'la principal no se repite en las ligadas');
    assert.strictEqual((await llamar('/api/usuarios', { cookie: jefe, metodo: 'POST', cuerpo: { usuario: 'x@vitro.com', clave: 'clave-larga-123', perfilId: qa.id, companias: [9999] } })).status, 400);

    // Entra en la principal y ve las dos para elegir
    let c = await entrar('ana@vitro.com', 'clave-larga-123');
    let estado = (await llamar('/api/estado', { cookie: c })).datos;
    assert.strictEqual(estado.perfil.id, qa.id);
    assert.deepStrictEqual(estado.usuario.companias.map((x) => x.nombre), ['Vitro QA', 'Vitro PRD']);

    // Cambia a PRD: la sesión nueva trabaja con PRD y sus módulos
    const cambio = await llamar('/api/sesion/compania', { cookie: c, metodo: 'POST', cuerpo: { perfilId: prd.id } });
    assert.strictEqual(cambio.status, 200);
    c = cambio.cookie;
    estado = (await llamar('/api/estado', { cookie: c })).datos;
    assert.strictEqual(estado.perfil.id, prd.id);
    assert.deepStrictEqual(estado.usuario.modulos, ['cargar', 'historial']);
    assert.strictEqual((await llamar('/api/perfiles', { cookie: c })).status, 403, 'PRD no tiene habilitado «Mi compañía»');

    // No puede pasarse a una compañía que no es suya
    assert.strictEqual((await llamar('/api/sesion/compania', { cookie: c, metodo: 'POST', cuerpo: { perfilId: atica.id } })).status, 403);
    // El administrador elige en Administración, no aquí
    assert.strictEqual((await llamar('/api/sesion/compania', { cookie: jefe, metodo: 'POST', cuerpo: { perfilId: qa.id } })).status, 400);

    // No se puede eliminar una compañía ligada a un usuario
    assert.strictEqual((await llamar(`/api/perfiles/${prd.id}`, { cookie: jefe, metodo: 'DELETE' })).status, 400);

    // Si el administrador le quita PRD, la sesión que estaba en PRD se cierra
    assert.deepStrictEqual((await llamar(`/api/usuarios/${ana.id}`, { cookie: jefe, metodo: 'PUT', cuerpo: { companias: [] } })).datos.companias, []);
    assert.strictEqual((await llamar('/api/estado', { cookie: c })).status, 401);
    const c2 = await entrar('ana@vitro.com', 'clave-larga-123');
    assert.deepStrictEqual((await llamar('/api/estado', { cookie: c2 })).datos.usuario.companias.map((x) => x.id), [qa.id]);
  } finally {
    s.close();
  }
});
