'use strict';
// Rol de administrador asignado a usuarios de la tabla.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-roles-'));
process.env.APP_USUARIO = 'Jefe';
process.env.APP_CLAVE = 'clave-del-jefe-123';
process.env.APP_SECRETO = 'secreto-de-prueba';
const { app } = require('../src/server');
const { CLAVES } = require('../src/dominio/modulos');

test('API: un administrador puede hacer administrador a otro usuario y quitárselo', async () => {
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
    const vitro = (await llamar('/api/perfiles', { cookie: jefe, metodo: 'POST', cuerpo: { nombre: 'Vitro', config: { modulos: ['cargar'] } } })).datos;

    // Crear directamente como administrador: queda sin compañía y con todos los módulos.
    const ana = (await llamar('/api/usuarios', { cookie: jefe, metodo: 'POST', cuerpo: { usuario: 'ana@jtc.com.co', clave: 'clave-larga-123', rol: 'admin', perfilId: vitro.id, modulos: ['cargar'] } })).datos;
    assert.strictEqual(ana.rol, 'admin');
    assert.strictEqual(ana.perfilId, null);
    assert.strictEqual(ana.modulos, null);
    const cAna = await entrar('ana@jtc.com.co', 'clave-larga-123');
    const estadoAna = (await llamar('/api/estado', { cookie: cAna })).datos.usuario;
    assert.strictEqual(estadoAna.rol, 'admin');
    assert.deepStrictEqual(estadoAna.modulos, CLAVES);
    assert.strictEqual(estadoAna.cambiaClave, true, 'un administrador de la tabla cambia su propia contraseña');
    assert.strictEqual((await llamar('/api/usuarios', { cookie: cAna })).status, 200, 'gestiona usuarios');

    // Ascender a un usuario de compañía; su sesión anterior se cierra.
    const luis = (await llamar('/api/usuarios', { cookie: jefe, metodo: 'POST', cuerpo: { usuario: 'luis@vitro.com', clave: 'clave-larga-123', perfilId: vitro.id } })).datos;
    const cLuis = await entrar('luis@vitro.com', 'clave-larga-123');
    assert.strictEqual((await llamar('/api/usuarios', { cookie: cLuis })).status, 403);
    const ascendido = (await llamar(`/api/usuarios/${luis.id}`, { cookie: cAna, metodo: 'PUT', cuerpo: { rol: 'admin' } })).datos;
    assert.strictEqual(ascendido.rol, 'admin');
    assert.strictEqual(ascendido.perfilId, null);
    assert.strictEqual((await llamar('/api/estado', { cookie: cLuis })).status, 401, 'cambiar el rol cierra la sesión');

    // Nadie puede quitarse a sí mismo el rol, desactivarse ni eliminarse.
    assert.strictEqual((await llamar(`/api/usuarios/${ana.id}`, { cookie: cAna, metodo: 'PUT', cuerpo: { rol: 'empresa', perfilId: vitro.id } })).status, 400);
    assert.strictEqual((await llamar(`/api/usuarios/${ana.id}`, { cookie: cAna, metodo: 'PUT', cuerpo: { activo: false } })).status, 400);
    assert.strictEqual((await llamar(`/api/usuarios/${ana.id}`, { cookie: cAna, metodo: 'DELETE' })).status, 400);

    // Bajar a compañía exige una compañía válida.
    assert.strictEqual((await llamar(`/api/usuarios/${luis.id}`, { cookie: jefe, metodo: 'PUT', cuerpo: { rol: 'empresa', perfilId: 9999 } })).status, 400);
    const bajado = (await llamar(`/api/usuarios/${luis.id}`, { cookie: jefe, metodo: 'PUT', cuerpo: { rol: 'empresa', perfilId: vitro.id } })).datos;
    assert.strictEqual(bajado.rol, 'empresa');
    assert.strictEqual(bajado.perfilId, vitro.id);
    const cLuis2 = await entrar('luis@vitro.com', 'clave-larga-123');
    assert.deepStrictEqual((await llamar('/api/estado', { cookie: cLuis2 })).datos.usuario.modulos, ['cargar']);
    assert.strictEqual((await llamar('/api/usuarios', { cookie: cLuis2 })).status, 403);
  } finally {
    s.close();
  }
});
