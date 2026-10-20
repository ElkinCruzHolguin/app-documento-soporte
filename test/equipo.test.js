'use strict';
// Navegador de confianza: tras validar el código, ese navegador entra 7 días solo con contraseña.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-equipo-'));
process.env.APP_USUARIO = 'Jefe';
process.env.APP_CLAVE = 'clave-del-jefe-123';
process.env.APP_CORREO = 'jefe@ejemplo.com';
process.env.APP_SECRETO = 'secreto-de-prueba';
process.env.CORREO_CONSOLA = '1';
const { app } = require('../src/server');
const { bandejaLocal } = require('../src/infraestructura/correo');

test('recordar el navegador evita pedir el código hasta que cambie la contraseña', async () => {
  const s = await new Promise((resolve) => { const x = http.createServer(app).listen(0, '127.0.0.1', () => resolve(x)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const llamar = async (ruta, { cookie, metodo = 'GET', cuerpo } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const cookies = r.headers.getSetCookie().map((c) => c.split(';')[0]);
    const de = (n) => cookies.find((c) => c.startsWith(`${n}=`) && c.length > n.length + 1) || '';
    return { status: r.status, datos: await r.json().catch(() => null), sesion: de('ds_sesion'), pendiente: de('ds_2fa'), equipo: de('ds_equipo') };
  };
  const codigo = (para) => [...bandejaLocal].reverse().find((x) => x.para === para).texto.match(/\b(\d{6})\b/)[1];
  const paso1 = (usuario, clave, equipo) => llamar('/api/login', { metodo: 'POST', cookie: equipo, cuerpo: { usuario, clave } });
  const paso2 = (pendiente, para, recordar) => llamar('/api/login/verificar', { metodo: 'POST', cookie: pendiente, cuerpo: { codigo: codigo(para), recordar } });

  try {
    // Admin sin recordar: no queda navegador de confianza
    let r = await paso1('jefe', 'clave-del-jefe-123');
    let v = await paso2(r.pendiente, 'jefe@ejemplo.com', false);
    assert.strictEqual(v.status, 200);
    assert.strictEqual(v.equipo, '');
    const admin = v.sesion;

    const perfil = (await llamar('/api/perfiles', { cookie: admin, metodo: 'POST', cuerpo: { nombre: 'Vitro QA', config: {} } })).datos;
    const ana = (await llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario: 'ana@vitro.com', clave: 'clave-larga-123', perfilId: perfil.id } })).datos;

    // Ana valida el código y pide recordar el navegador
    r = await paso1('ana@vitro.com', 'clave-larga-123');
    assert.strictEqual(r.datos.paso, 'codigo');
    v = await paso2(r.pendiente, 'ana@vitro.com', true);
    assert.match(v.equipo, /^ds_equipo=.+/);
    const equipo = v.equipo;

    // Siguiente ingreso en ese navegador: solo contraseña
    const enviados = bandejaLocal.length;
    r = await paso1('ana@vitro.com', 'clave-larga-123', equipo);
    assert.strictEqual(r.status, 200);
    assert.ok(r.sesion, 'entra sin código');
    assert.strictEqual(bandejaLocal.length, enviados, 'no se envía código');
    // La contraseña sigue siendo obligatoria
    assert.strictEqual((await paso1('ana@vitro.com', 'mala-clave-123', equipo)).status, 401);
    // El navegador recordado de Ana no sirve para otra cuenta
    assert.strictEqual((await paso1('jefe', 'clave-del-jefe-123', equipo)).datos.paso, 'codigo');

    // Si el administrador le cambia la contraseña, vuelve a pedir el código
    await llamar(`/api/usuarios/${ana.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { clave: 'otra-clave-456' } });
    assert.strictEqual((await paso1('ana@vitro.com', 'otra-clave-456', equipo)).datos.paso, 'codigo');
  } finally {
    s.close();
  }
});
