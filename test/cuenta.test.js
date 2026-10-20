'use strict';
// Un usuario de compañía cambia su propia contraseña.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-cuenta-'));
process.env.APP_USUARIO = 'Jefe';
process.env.APP_CLAVE = 'clave-del-jefe-123';
process.env.APP_SECRETO = 'secreto-de-prueba';
const { app } = require('../src/server');

test('cambiar mi contraseña', async () => {
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
  const login = (usuario, clave) => llamar('/api/login', { metodo: 'POST', cuerpo: { usuario, clave } });
  const cambiar = (cookie, actual, nueva) => llamar('/api/cuenta/clave', { cookie, metodo: 'POST', cuerpo: { actual, nueva } });

  try {
    // Sin sesión no se puede
    assert.strictEqual((await cambiar('', 'a', 'b')).status, 401);

    const admin = (await login('jefe', 'clave-del-jefe-123')).cookie;
    const vitro = (await llamar('/api/perfiles', { cookie: admin, metodo: 'POST', cuerpo: { nombre: 'Vitro QA', config: {} } })).datos;
    await llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario: 'vitro@ejemplo.com', clave: 'clave-vitro-123', perfilId: vitro.id } });
    await llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario: 'atica@ejemplo.com', clave: 'clave-atica-123', perfilId: vitro.id } });

    // El administrador no la cambia aquí (es APP_CLAVE)
    const rAdmin = await cambiar(admin, 'clave-del-jefe-123', 'otra-clave-larga');
    assert.strictEqual(rAdmin.status, 400);
    assert.match(rAdmin.datos.error, /APP_CLAVE/);

    const cVitro = (await login('vitro@ejemplo.com', 'clave-vitro-123')).cookie;
    // Validaciones
    assert.match((await cambiar(cVitro, 'equivocada', 'nueva-clave-vitro')).datos.error, /actual no es correcta/);
    assert.match((await cambiar(cVitro, 'clave-vitro-123', 'corta')).datos.error, /10 caracteres/);
    assert.match((await cambiar(cVitro, 'clave-vitro-123', 'clave-vitro-123')).datos.error, /distinta/);

    // Cambio correcto: la anterior deja de servir y la nueva entra
    assert.strictEqual((await cambiar(cVitro, 'clave-vitro-123', 'nueva-clave-vitro')).status, 200);
    assert.strictEqual((await login('vitro@ejemplo.com', 'clave-vitro-123')).status, 401);
    assert.strictEqual((await login('vitro@ejemplo.com', 'nueva-clave-vitro')).status, 200);
    // Solo cambia la del usuario conectado
    assert.strictEqual((await login('atica@ejemplo.com', 'clave-atica-123')).status, 200);

    // 5 intentos con la clave actual equivocada bloquean el cambio
    const cAtica = (await login('atica@ejemplo.com', 'clave-atica-123')).cookie;
    for (let i = 0; i < 5; i++) await cambiar(cAtica, 'mala', 'nueva-clave-atica');
    assert.strictEqual((await cambiar(cAtica, 'clave-atica-123', 'nueva-clave-atica')).status, 429);
  } finally {
    s.close();
  }
});
