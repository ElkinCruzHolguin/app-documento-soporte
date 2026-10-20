'use strict';
// Módulos por compañía y por usuario.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-modulos-'));
process.env.APP_USUARIO = 'Jefe';
process.env.APP_CLAVE = 'clave-del-jefe-123';
process.env.APP_SECRETO = 'secreto-de-prueba';
const { app } = require('../src/server');
const { efectivos, limpiarModulos, CLAVES } = require('../src/dominio/modulos');
const { fallo } = require('../src/dominio/errores');

test('dominio: módulos efectivos', () => {
  assert.deepStrictEqual(efectivos({ rol: 'admin', config: { modulos: [] } }), CLAVES);
  assert.deepStrictEqual(efectivos({ rol: 'empresa', config: {} }), CLAVES, 'compañía sin configurar = todos (como antes)');
  assert.deepStrictEqual(efectivos({ rol: 'empresa', config: { modulos: ['historial', 'cargar'] } }), ['cargar', 'historial']);
  assert.deepStrictEqual(efectivos({ rol: 'empresa', config: { modulos: ['cargar', 'historial'] }, modulosUsuario: ['historial', 'emitidos'] }), ['historial'],
    'el usuario nunca ve más que su compañía');
  assert.deepStrictEqual(limpiarModulos(['historial', 'cargar'], fallo), ['cargar', 'historial']);
  assert.strictEqual(limpiarModulos(null, fallo), null);
  assert.throws(() => limpiarModulos(['admin'], fallo), /desconocido/);
});

test('API: la compañía habilita módulos y cada usuario ve solo los suyos', async () => {
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
    const admin = await entrar('jefe', 'clave-del-jefe-123');
    assert.deepStrictEqual((await llamar('/api/modulos', { cookie: admin })).datos.map((m) => m.clave), CLAVES);

    // Compañía con solo Cargar e Historial
    const vitro = (await llamar('/api/perfiles', { cookie: admin, metodo: 'POST', cuerpo: { nombre: 'Vitro PRD', config: { modulos: ['cargar', 'historial'] } } })).datos;
    assert.deepStrictEqual(vitro.config.modulos, ['cargar', 'historial']);
    assert.strictEqual((await llamar(`/api/perfiles/${vitro.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { config: { modulos: ['nomina'] } } })).status, 400);

    // Usuario con todos los de su compañía, y otro solo con Historial
    const crear = (usuario, modulos) => llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario, clave: 'clave-larga-123', perfilId: vitro.id, modulos } });
    const todo = (await crear('todo@vitro.com', null)).datos;
    assert.strictEqual(todo.modulos, null);
    const solo = (await crear('solo@vitro.com', ['historial'])).datos;
    assert.deepStrictEqual(solo.modulos, ['historial']);
    assert.strictEqual((await crear('malo@vitro.com', ['x'])).status, 400);

    const cTodo = await entrar('todo@vitro.com', 'clave-larga-123');
    assert.deepStrictEqual((await llamar('/api/estado', { cookie: cTodo })).datos.usuario.modulos, ['cargar', 'historial']);
    assert.strictEqual((await llamar('/api/envios', { cookie: cTodo })).status, 200);
    for (const ruta of ['/api/dashboard', '/api/emitidos', '/api/recibidos', '/api/perfiles']) {
      assert.strictEqual((await llamar(ruta, { cookie: cTodo })).status, 403, ruta);
    }

    const cSolo = await entrar('solo@vitro.com', 'clave-larga-123');
    assert.deepStrictEqual((await llamar('/api/estado', { cookie: cSolo })).datos.usuario.modulos, ['historial']);
    assert.strictEqual((await llamar('/api/envios', { cookie: cSolo })).status, 200);
    assert.strictEqual((await llamar('/api/enviar', { cookie: cSolo, metodo: 'POST', cuerpo: {} })).status, 403);

    // El admin cambia los módulos del usuario y de la compañía: efecto inmediato
    await llamar(`/api/usuarios/${solo.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { modulos: null } });
    assert.deepStrictEqual((await llamar('/api/estado', { cookie: cSolo })).datos.usuario.modulos, ['cargar', 'historial']);
    await llamar(`/api/perfiles/${vitro.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { config: { modulos: ['historial', 'compania'] } } });
    assert.deepStrictEqual((await llamar('/api/estado', { cookie: cSolo })).datos.usuario.modulos, ['historial', 'compania']);
    assert.strictEqual((await llamar('/api/perfiles', { cookie: cSolo })).status, 200);
    // Un módulo que la compañía no tiene no aparece aunque el usuario lo tenga
    await llamar(`/api/usuarios/${solo.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { modulos: ['cargar', 'historial'] } });
    assert.deepStrictEqual((await llamar('/api/estado', { cookie: cSolo })).datos.usuario.modulos, ['historial']);

    // El administrador siempre ve todo
    assert.deepStrictEqual((await llamar('/api/estado', { cookie: admin })).datos.usuario.modulos, CLAVES);
  } finally {
    s.close();
  }
});
