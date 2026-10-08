'use strict';
// Inicio de sesión, roles y aislamiento entre compañías.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sesion-'));
process.env.APP_USUARIO = 'Jefe';
process.env.APP_CLAVE = 'clave-del-jefe-123';
process.env.APP_SECRETO = 'secreto-de-prueba';
const { app } = require('../src/server');
const { crearAlmacenArchivo } = require('../src/repositorios/archivo');
const { hashClave, verificarClave } = require('../src/infraestructura/seguridad');

test('hash de contraseñas', () => {
  const h = hashClave('una-clave-larga');
  assert.ok(h.startsWith('scrypt$') && !h.includes('una-clave-larga'));
  assert.ok(verificarClave('una-clave-larga', h));
  assert.ok(!verificarClave('otra-clave', h));
  assert.ok(!verificarClave('x', 'basura'));
});

test('login, roles y aislamiento entre compañías', async () => {
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
  const entrar = async (usuario, clave) => {
    const r = await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario, clave } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.datos));
    assert.match(r.cookie, /^ds_sesion=.+/);
    return r.cookie;
  };

  try {
    // Sin sesión no hay acceso
    assert.strictEqual((await llamar('/api/estado')).status, 401);
    assert.strictEqual((await llamar('/api/estado', { cookie: 'ds_sesion=falsa.firma' })).status, 401);
    assert.strictEqual((await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'jefe', clave: 'mala' } })).status, 401);

    // Super administrador (usuario sin distinguir mayúsculas)
    const admin = await entrar('JEFE', 'clave-del-jefe-123');
    const estadoAdmin = (await llamar('/api/estado', { cookie: admin })).datos;
    assert.strictEqual(estadoAdmin.usuario.rol, 'admin');

    // Perfiles de dos compañías
    const crearPerfil = async (nombre, nit) => (await llamar('/api/perfiles', { cookie: admin, metodo: 'POST', cuerpo: { nombre, config: { nit } } })).datos;
    const vitro = await crearPerfil('Vitro QA', '860031699');
    const atica = await crearPerfil('Atica QA', '900024398');

    // Usuarios: validaciones
    const crearUsuario = (cuerpo) => llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo });
    assert.strictEqual((await crearUsuario({ usuario: 'vitro', clave: 'corta', perfilId: vitro.id })).status, 400);
    assert.strictEqual((await crearUsuario({ usuario: 'jefe', clave: 'clave-larga-123', perfilId: vitro.id })).status, 400);
    assert.strictEqual((await crearUsuario({ usuario: 'sinperfil', clave: 'clave-larga-123' })).status, 400);
    assert.strictEqual((await crearUsuario({ usuario: 'otroadmin', clave: 'clave-larga-123', rol: 'admin' })).status, 400);
    const uVitro = (await crearUsuario({ usuario: 'Vitro', clave: 'clave-vitro-123', perfilId: vitro.id })).datos;
    assert.strictEqual(uVitro.usuario, 'vitro');
    assert.ok(!JSON.stringify(uVitro).includes('scrypt'));
    assert.strictEqual((await crearUsuario({ usuario: 'vitro', clave: 'clave-vitro-123', perfilId: vitro.id })).status, 400);
    await crearUsuario({ usuario: 'atica', clave: 'clave-atica-123', perfilId: atica.id });
    const lista = (await llamar('/api/usuarios', { cookie: admin })).datos;
    assert.deepStrictEqual(lista.map((u) => u.usuario), ['atica', 'vitro']);
    assert.ok(!JSON.stringify(lista).includes('scrypt'));

    // Historial con envíos de las dos compañías
    const almacen = crearAlmacenArchivo(process.env.DATA_DIR);
    const idVitro = await almacen.envios.registrar({ perfilId: vitro.id, perfilNombre: 'Vitro QA', modo: 'real', estado: 'aceptado', numero: 'V1', numeroExcel: 'V1', nitAdquiriente: '860031699' });
    const idAtica = await almacen.envios.registrar({ perfilId: atica.id, perfilNombre: 'Atica QA', modo: 'real', estado: 'aceptado', numero: 'A1', numeroExcel: 'A1', nitAdquiriente: '900024398' });

    // Usuario de compañía: solo su perfil y su historial; nada de Administración
    const cVitro = await entrar('vitro', 'clave-vitro-123');
    const est = (await llamar('/api/estado', { cookie: cVitro })).datos;
    assert.strictEqual(est.usuario.rol, 'empresa');
    assert.strictEqual(est.perfil.nombre, 'Vitro QA');
    // Puede ver (solo lectura) la configuración de su compañía, nunca la de otra ni modificarla
    assert.deepStrictEqual((await llamar('/api/perfiles', { cookie: cVitro })).datos.map((p) => p.nombre), ['Vitro QA']);
    assert.strictEqual((await llamar(`/api/perfiles/${atica.id}/catalogo/x`, { cookie: cVitro })).status, 403);
    assert.strictEqual((await llamar(`/api/perfiles/${vitro.id}`, { cookie: cVitro, metodo: 'PUT', cuerpo: { config: { modoEnvio: 'real' } } })).status, 403);
    assert.strictEqual((await llamar('/api/perfiles', { cookie: cVitro, metodo: 'POST', cuerpo: { nombre: 'Otra' } })).status, 403);
    assert.strictEqual((await llamar(`/api/perfiles/${atica.id}`, { cookie: cVitro, metodo: 'PUT', cuerpo: { config: { modoEnvio: 'real' } } })).status, 403);
    assert.strictEqual((await llamar('/api/usuarios', { cookie: cVitro })).status, 403);
    assert.deepStrictEqual((await llamar('/api/envios', { cookie: cVitro })).datos.map((e) => e.numero), ['V1']);
    assert.strictEqual((await llamar(`/api/envios/${idVitro}`, { cookie: cVitro })).status, 200);
    assert.strictEqual((await llamar(`/api/envios/${idAtica}`, { cookie: cVitro })).status, 404);
    assert.deepStrictEqual((await llamar('/api/envios', { cookie: admin })).datos.map((e) => e.numero).sort(), ['A1', 'V1']);

    // No se puede borrar un perfil con usuarios
    assert.strictEqual((await llamar(`/api/perfiles/${vitro.id}`, { cookie: admin, metodo: 'DELETE' })).status, 400);

    // Cambiar el perfil del usuario o desactivarlo invalida su sesión al instante
    await llamar(`/api/usuarios/${uVitro.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { perfilId: atica.id } });
    assert.strictEqual((await llamar('/api/estado', { cookie: cVitro })).status, 401);
    await llamar(`/api/usuarios/${uVitro.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { perfilId: vitro.id, activo: false } });
    assert.strictEqual((await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'vitro', clave: 'clave-vitro-123' } })).status, 401);
    await llamar(`/api/usuarios/${uVitro.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { activo: true, clave: 'nueva-clave-vitro' } });
    assert.strictEqual((await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'vitro', clave: 'clave-vitro-123' } })).status, 401);
    await entrar('vitro', 'nueva-clave-vitro');

    // Salir borra la cookie
    assert.match((await llamar('/api/logout', { cookie: admin, metodo: 'POST' })).cookie, /^ds_sesion=$/);

    // Bloqueo tras 5 intentos fallidos
    for (let i = 0; i < 5; i++) await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'atica', clave: 'mala' } });
    assert.strictEqual((await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'atica', clave: 'clave-atica-123' } })).status, 429);
  } finally {
    s.close();
  }
});
