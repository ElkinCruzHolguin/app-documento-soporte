'use strict';
// El administrador cambia de compañía desde el panel lateral, como los usuarios ligados a varias.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-admin-compania-'));
process.env.APP_USUARIO = 'Jefe';
process.env.APP_CLAVE = 'clave-del-jefe-123';
process.env.APP_SECRETO = 'secreto-de-prueba';
const { app } = require('../src/server');

test('API: el administrador ve todas las compañías y cambia la activa', async () => {
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

  try {
    const jefe = (await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'jefe', clave: 'clave-del-jefe-123' } })).cookie;
    const crear = async (nombre) => (await llamar('/api/perfiles', { cookie: jefe, metodo: 'POST', cuerpo: { nombre, config: {} } })).datos;
    const qa = await crear('Vitro QA');
    const sandbox = await crear('Vitro Sandbox');

    let estado = (await llamar('/api/estado', { cookie: jefe })).datos;
    const nombres = estado.usuario.companias.map((x) => x.nombre);
    assert.ok(nombres.includes('Vitro QA') && nombres.includes('Vitro Sandbox'), 've todas, no solo las ligadas');

    for (const p of [sandbox, qa]) {
      assert.strictEqual((await llamar(`/api/perfiles/${p.id}/activar`, { cookie: jefe, metodo: 'POST' })).status, 200);
      estado = (await llamar('/api/estado', { cookie: jefe })).datos;
      assert.strictEqual(estado.perfil.id, p.id);
    }
  } finally {
    s.close();
  }
});
