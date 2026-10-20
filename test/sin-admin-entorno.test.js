'use strict';
// Sin super administrador de entorno: los administradores son usuarios de la tabla.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sin-admin-'));
delete process.env.APP_USUARIO;
delete process.env.APP_CLAVE;
process.env.APP_AUTENTICACION = '1';
process.env.APP_SECRETO = 'secreto-de-prueba';
const { app } = require('../src/server');
const { crearAlmacenArchivo } = require('../src/repositorios/archivo');
const { hashClave } = require('../src/infraestructura/seguridad');

test('APP_AUTENTICACION=1 sin APP_USUARIO: se exige sesión y entra el administrador de la tabla', async () => {
  await crearAlmacenArchivo(process.env.DATA_DIR).usuarios.crear({ usuario: 'elkin.cruz@jtc.com.co', claveHash: hashClave('clave-de-elkin-123'), rol: 'admin', perfilId: null });
  const s = await new Promise((resolve) => { const x = http.createServer(app).listen(0, '127.0.0.1', () => resolve(x)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const llamar = async (ruta, { cookie, metodo = 'GET', cuerpo } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    return { status: r.status, datos: await r.json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  try {
    assert.strictEqual((await llamar('/api/estado')).status, 401, 'sin sesión no entra');
    assert.strictEqual((await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: '', clave: '' } })).status, 401, 'usuario y clave vacíos no son el admin');
    assert.strictEqual((await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'admin', clave: '' } })).status, 401);
    const r = await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'Elkin.Cruz@jtc.com.co', clave: 'clave-de-elkin-123' } });
    assert.strictEqual(r.status, 200);
    const estado = (await llamar('/api/estado', { cookie: r.cookie })).datos.usuario;
    assert.strictEqual(estado.rol, 'admin');
    assert.strictEqual(estado.usuario, 'elkin.cruz@jtc.com.co');
    const lista = (await llamar('/api/usuarios', { cookie: r.cookie })).datos;
    assert.deepStrictEqual(lista.map((u) => u.usuario), ['elkin.cruz@jtc.com.co'], 'el administrador aparece en la lista');
  } finally {
    s.close();
  }
});
