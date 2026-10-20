'use strict';
// Ingreso con código de un solo uso (OTP) enviado al correo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-otp-'));
process.env.APP_USUARIO = 'Jefe';
process.env.APP_CLAVE = 'clave-del-jefe-123';
process.env.APP_CORREO = 'Jefe@Ejemplo.com';
process.env.APP_SECRETO = 'secreto-de-prueba';
const { app } = require('../src/server');
const { crearAlmacenArchivo } = require('../src/repositorios/archivo');
const { hashClave } = require('../src/infraestructura/seguridad');
const { crearEnviadorCorreo, bandejaLocal } = require('../src/infraestructura/correo');
const { esCorreo } = require('../src/dominio/correo');

test('formato del correo', () => {
  assert.ok(esCorreo('Ana.Perez+ds@Vitro.com.co'));
  for (const malo of ['vitro', 'a@b', '@vitro.com', 'a b@vitro.com', '']) assert.ok(!esCorreo(malo), malo);
});

test('enviador de correo: Mailgun, Resend, local y Vercel sin configurar', async () => {
  const llamadas = [];
  const resend = crearEnviadorCorreo({ correo: { llaveResend: 're_x', remitente: 'App <no-responder@zupplio.app>' } }, {
    fetch: async (url, op) => { llamadas.push({ url, op }); return { ok: true }; },
  });
  assert.ok(resend.disponible);
  await resend.enviar({ para: 'a@b.co', asunto: 'Hola', texto: 't', html: '<p>t</p>' });
  assert.strictEqual(llamadas[0].url, 'https://api.resend.com/emails');
  assert.strictEqual(llamadas[0].op.headers.Authorization, 'Bearer re_x');
  assert.deepStrictEqual(JSON.parse(llamadas[0].op.body).to, ['a@b.co']);

  const mg = [];
  const mailgun = crearEnviadorCorreo({ correo: { llaveMailgun: 'key-x', dominioMailgun: 'zupplio.app', regionMailgun: 'us', remitente: 'App <no-responder@zupplio.app>' } }, {
    fetch: async (url, op) => { mg.push({ url, op }); return { ok: true }; },
  });
  await mailgun.enviar({ para: 'a@b.co', asunto: 'Hola', texto: 't', html: '<p>t</p>' });
  assert.strictEqual(mg[0].url, 'https://api.mailgun.net/v3/zupplio.app/messages');
  assert.strictEqual(mg[0].op.headers.Authorization, `Basic ${Buffer.from('api:key-x').toString('base64')}`);
  assert.strictEqual(mg[0].op.body.get('to'), 'a@b.co');
  assert.strictEqual(mg[0].op.body.get('from'), 'App <no-responder@zupplio.app>');
  const mgEu = [];
  await crearEnviadorCorreo({ correo: { llaveMailgun: 'k', dominioMailgun: 'zupplio.app', regionMailgun: 'eu', remitente: 'x@zupplio.app' } }, { fetch: async (url) => { mgEu.push(url); return { ok: true }; } })
    .enviar({ para: 'a@b.co', asunto: 'x' });
  assert.match(mgEu[0], /^https:\/\/api\.eu\.mailgun\.net\//);

  const fallaResend = crearEnviadorCorreo({ correo: { llaveResend: 're_x', remitente: 'x@y.co' } }, { fetch: async () => ({ ok: false, status: 403, text: async () => 'dominio' }) });
  await assert.rejects(fallaResend.enviar({ para: 'a@b.co', asunto: 'x' }), /HTTP 403/);

  assert.strictEqual(crearEnviadorCorreo({ enVercel: true }).disponible, false);
  assert.strictEqual(crearEnviadorCorreo({ enVercel: false }).disponible, true);
});

test('login con código al correo', async () => {
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
  const pedir = (correo) => llamar('/api/login/codigo', { metodo: 'POST', cuerpo: { correo } });
  const verificar = (correo, codigo) => llamar('/api/login/verificar', { metodo: 'POST', cuerpo: { correo, codigo } });
  const ultimoCodigo = (para) => {
    const m = [...bandejaLocal].reverse().find((x) => x.para === para);
    return m && m.texto.match(/\b(\d{6})\b/)[1];
  };

  try {
    assert.deepStrictEqual((await llamar('/api/login/opciones')).datos, { login: true, codigo: true, clave: true });

    // Correo inválido o no registrado: no se envía nada y la respuesta no revela si existe
    assert.strictEqual((await pedir('vitro')).status, 400);
    const desconocido = await pedir('nadie@ejemplo.com');
    assert.strictEqual(desconocido.status, 200);
    assert.strictEqual(bandejaLocal.length, 0);

    // El super administrador entra con APP_CORREO (sin distinguir mayúsculas)
    assert.strictEqual((await pedir('JEFE@ejemplo.com')).datos.mensaje, desconocido.datos.mensaje);
    const cAdmin = await verificar('jefe@ejemplo.com', ultimoCodigo('jefe@ejemplo.com'));
    assert.strictEqual(cAdmin.status, 200, JSON.stringify(cAdmin.datos));
    assert.strictEqual((await llamar('/api/estado', { cookie: cAdmin.cookie })).datos.usuario.rol, 'admin');
    // La contraseña sigue sirviendo como respaldo
    const admin = (await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'jefe', clave: 'clave-del-jefe-123' } })).cookie;

    // Usuario de compañía creado solo con su correo (sin contraseña)
    const vitro = (await llamar('/api/perfiles', { cookie: admin, metodo: 'POST', cuerpo: { nombre: 'Vitro QA', config: {} } })).datos;
    assert.strictEqual((await llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario: 'vitro', perfilId: vitro.id } })).status, 400);
    assert.strictEqual((await llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario: 'jefe@ejemplo.com', perfilId: vitro.id } })).status, 400);
    const ana = (await llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario: ' Ana@Vitro.com ', perfilId: vitro.id } })).datos;
    assert.strictEqual(ana.usuario, 'ana@vitro.com');

    await pedir('ana@vitro.com');
    const codigo = ultimoCodigo('ana@vitro.com');
    assert.match(codigo, /^\d{6}$/);
    assert.ok(!fs.readFileSync(path.join(process.env.DATA_DIR, 'codigos.json'), 'utf8').includes(codigo), 'el código no se guarda en claro');
    const otro = codigo === '000000' ? '111111' : '000000';
    assert.strictEqual((await verificar('ana@vitro.com', otro)).status, 401);
    const cAna = await verificar('ana@vitro.com', codigo);
    assert.strictEqual(cAna.status, 200);
    assert.match(cAna.cookie, /^ds_sesion=.+/);
    const est = (await llamar('/api/estado', { cookie: cAna.cookie })).datos;
    assert.strictEqual(est.usuario.usuario, 'ana@vitro.com');
    assert.strictEqual(est.perfil.nombre, 'Vitro QA');
    // Un código sirve una sola vez
    assert.strictEqual((await verificar('ana@vitro.com', codigo)).status, 401);
    // Sin contraseña asignada no se puede entrar con contraseña
    assert.strictEqual((await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'ana@vitro.com', clave: '' } })).status, 401);

    // Pedir otro código anula el anterior; 5 intentos fallidos anulan el código
    await pedir('ana@vitro.com');
    const viejo = ultimoCodigo('ana@vitro.com');
    await pedir('ana@vitro.com');
    const nuevo = ultimoCodigo('ana@vitro.com');
    if (viejo !== nuevo) assert.strictEqual((await verificar('ana@vitro.com', viejo)).status, 401);
    const malo = nuevo === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++) assert.ok([401, 429].includes((await verificar('ana@vitro.com', malo)).status));
    assert.strictEqual((await verificar('ana@vitro.com', nuevo)).status, 429);
    const guardado = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'codigos.json'), 'utf8')).find((c) => c.correo === 'ana@vitro.com');
    assert.ok(guardado.intentos >= 3 && !guardado.usado);

    // Usuario desactivado: no recibe código
    await llamar(`/api/usuarios/${ana.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { activo: false } });
    const antes = bandejaLocal.length;
    assert.strictEqual((await pedir('ana@vitro.com')).status, 200);
    assert.strictEqual(bandejaLocal.length, antes);
    assert.strictEqual((await llamar('/api/estado', { cookie: cAna.cookie })).status, 401);

    // Usuario antiguo (no es correo): sigue entrando con contraseña hasta que el admin le pone su correo
    const almacen = crearAlmacenArchivo(process.env.DATA_DIR);
    const viejoU = await almacen.usuarios.crear({ usuario: 'vitroqa', claveHash: hashClave('clave-vitroqa-123'), rol: 'empresa', perfilId: vitro.id });
    const cViejo = (await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'vitroqa', clave: 'clave-vitroqa-123' } })).cookie;
    assert.strictEqual((await llamar('/api/estado', { cookie: cViejo })).status, 200);
    assert.strictEqual((await llamar(`/api/usuarios/${viejoU.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { usuario: 'no-es-correo' } })).status, 400);
    const renombrado = await llamar(`/api/usuarios/${viejoU.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { usuario: 'Compras@Vitro.com' } });
    assert.strictEqual(renombrado.datos.usuario, 'compras@vitro.com');
    assert.strictEqual((await llamar('/api/estado', { cookie: cViejo })).status, 401, 'cambiar el usuario cierra su sesión');
    await pedir('compras@vitro.com');
    assert.strictEqual((await verificar('compras@vitro.com', ultimoCodigo('compras@vitro.com'))).status, 200);
    assert.strictEqual((await llamar('/api/login', { metodo: 'POST', cuerpo: { usuario: 'compras@vitro.com', clave: 'clave-vitroqa-123' } })).status, 200);

    // Límite de solicitudes de código por IP y correo
    for (let i = 0; i < 5; i++) await pedir('limite@ejemplo.com');
    assert.strictEqual((await pedir('limite@ejemplo.com')).status, 429);
  } finally {
    s.close();
  }
});
