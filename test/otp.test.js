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
process.env.CORREO_CONSOLA = '1';
const { app } = require('../src/server');
const { crearAlmacenArchivo } = require('../src/repositorios/archivo');
const { hashClave } = require('../src/infraestructura/seguridad');
const { crearEnviadorCorreo, bandejaLocal } = require('../src/infraestructura/correo');
const { esCorreo, enmascararCorreo } = require('../src/dominio/correo');

test('formato del correo', () => {
  assert.ok(esCorreo('Ana.Perez+ds@Vitro.com.co'));
  for (const malo of ['vitro', 'a@b', '@vitro.com', 'a b@vitro.com', '']) assert.ok(!esCorreo(malo), malo);
  assert.strictEqual(enmascararCorreo('elkin.cruz@jtc.com.co'), 'e***z@jtc.com.co');
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
  assert.strictEqual(crearEnviadorCorreo({ enVercel: false }).disponible, false);
  assert.strictEqual(crearEnviadorCorreo({ enVercel: false, correo: { consola: true } }).disponible, true);
  assert.strictEqual(crearEnviadorCorreo({ enVercel: true, correo: { consola: true } }).disponible, false);
});

test('login en dos pasos: contraseña y luego código al correo', async () => {
  const s = await new Promise((resolve) => { const x = http.createServer(app).listen(0, '127.0.0.1', () => resolve(x)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const cookiesDe = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || '']).map((c) => c.split(';')[0]);
  const llamar = async (ruta, { cookie, metodo = 'GET', cuerpo } = {}) => {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const datos = await r.json().catch(() => null);
    const cookies = cookiesDe(r);
    return { status: r.status, datos, sesion: cookies.find((c) => c.startsWith('ds_sesion=')) || '', pendiente: cookies.find((c) => c.startsWith('ds_2fa=')) || '' };
  };
  const paso1 = (usuario, clave) => llamar('/api/login', { metodo: 'POST', cuerpo: { usuario, clave } });
  const paso2 = (pendiente, codigo) => llamar('/api/login/verificar', { metodo: 'POST', cookie: pendiente, cuerpo: { codigo } });
  const ultimoCodigo = (para) => {
    const m = [...bandejaLocal].reverse().find((x) => x.para === para);
    return m && m.texto.match(/\b(\d{6})\b/)[1];
  };
  const entrar = async (usuario, clave, correo) => {
    const r1 = await paso1(usuario, clave);
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.datos));
    assert.strictEqual(r1.datos.paso, 'codigo');
    assert.strictEqual(r1.sesion, '', 'la contraseña sola no emite la sesión');
    const r2 = await paso2(r1.pendiente, ultimoCodigo(correo));
    assert.strictEqual(r2.status, 200, JSON.stringify(r2.datos));
    return r2.sesion;
  };

  try {
    // Contraseña mala: ni sesión ni código
    assert.strictEqual((await paso1('jefe', 'mala')).status, 401);
    assert.strictEqual(bandejaLocal.length, 0);

    // Super administrador: APP_USUARIO/APP_CLAVE y el código llega a APP_CORREO
    const r1 = await paso1('jefe', 'clave-del-jefe-123');
    assert.strictEqual(r1.datos.destino, 'j***e@ejemplo.com');
    assert.match(r1.pendiente, /^ds_2fa=.+/);
    // El estado pendiente no sirve como sesión
    assert.strictEqual((await llamar('/api/estado', { cookie: r1.pendiente.replace('ds_2fa=', 'ds_sesion=') })).status, 401);
    const codigoAdmin = ultimoCodigo('jefe@ejemplo.com');
    assert.ok(!fs.readFileSync(path.join(process.env.DATA_DIR, 'codigos.json'), 'utf8').includes(`"${codigoAdmin}"`), 'el código no se guarda en claro');
    const otro = codigoAdmin === '000000' ? '111111' : '000000';
    assert.strictEqual((await paso2(r1.pendiente, otro)).status, 401);
    assert.strictEqual((await paso2('', codigoAdmin)).status, 401, 'sin el paso 1 no hay código que valga');
    const ok = await paso2(r1.pendiente, codigoAdmin);
    assert.strictEqual(ok.status, 200);
    assert.match(ok.sesion, /^ds_sesion=.+/);
    const admin = ok.sesion;
    assert.strictEqual((await llamar('/api/estado', { cookie: admin })).datos.usuario.rol, 'admin');
    // Un código sirve una sola vez
    assert.strictEqual((await paso2(r1.pendiente, codigoAdmin)).status, 401);

    // Usuario de compañía con el MISMO correo que APP_CORREO: entra como compañía, nunca como admin
    const vitro = (await llamar('/api/perfiles', { cookie: admin, metodo: 'POST', cuerpo: { nombre: 'Vitro QA', config: {} } })).datos;
    assert.strictEqual((await llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario: 'ana@vitro.com', perfilId: vitro.id } })).status, 400, 'la contraseña es obligatoria');
    assert.strictEqual((await llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario: 'vitro', clave: 'clave-vitro-123', perfilId: vitro.id } })).status, 400, 'el usuario debe ser un correo');
    const mismo = (await llamar('/api/usuarios', { cookie: admin, metodo: 'POST', cuerpo: { usuario: 'Jefe@Ejemplo.com', clave: 'clave-compania-123', perfilId: vitro.id } })).datos;
    assert.strictEqual(mismo.usuario, 'jefe@ejemplo.com');
    const cMismo = await entrar('jefe@ejemplo.com', 'clave-compania-123', 'jefe@ejemplo.com');
    const est = (await llamar('/api/estado', { cookie: cMismo })).datos;
    assert.strictEqual(est.usuario.rol, 'empresa');
    assert.strictEqual(est.perfil.nombre, 'Vitro QA');
    assert.strictEqual((await llamar('/api/usuarios', { cookie: cMismo })).status, 403);

    // El código de una cuenta no sirve para la otra aunque compartan correo
    const pAdmin = await paso1('jefe', 'clave-del-jefe-123');
    const codigoDeAdmin = ultimoCodigo('jefe@ejemplo.com');
    const pCompania = await paso1('jefe@ejemplo.com', 'clave-compania-123');
    const codigoDeCompania = ultimoCodigo('jefe@ejemplo.com');
    if (codigoDeAdmin !== codigoDeCompania) assert.strictEqual((await paso2(pCompania.pendiente, codigoDeAdmin)).status, 401);
    const comoCompania = await paso2(pCompania.pendiente, codigoDeCompania);
    assert.strictEqual((await llamar('/api/estado', { cookie: comoCompania.sesion })).datos.usuario.rol, 'empresa');
    assert.strictEqual((await llamar('/api/estado', { cookie: (await paso2(pAdmin.pendiente, codigoDeAdmin)).sesion })).datos.usuario.rol, 'admin');

    // Reenviar código: el anterior deja de servir
    const p = await paso1('jefe@ejemplo.com', 'clave-compania-123');
    const viejo = ultimoCodigo('jefe@ejemplo.com');
    const re = await llamar('/api/login/reenviar', { metodo: 'POST', cookie: p.pendiente });
    assert.strictEqual(re.status, 200);
    const nuevo = ultimoCodigo('jefe@ejemplo.com');
    if (viejo !== nuevo) assert.strictEqual((await paso2(p.pendiente, viejo)).status, 401);
    assert.strictEqual((await paso2(p.pendiente, nuevo)).status, 200);

    // Si desactivan al usuario entre el paso 1 y el 2, no entra
    const p2 = await paso1('jefe@ejemplo.com', 'clave-compania-123');
    await llamar(`/api/usuarios/${mismo.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { activo: false } });
    assert.strictEqual((await paso2(p2.pendiente, ultimoCodigo('jefe@ejemplo.com'))).status, 401);
    await llamar(`/api/usuarios/${mismo.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { activo: true } });

    // 5 códigos equivocados anulan el código
    const p3 = await paso1('jefe@ejemplo.com', 'clave-compania-123');
    const bueno = ultimoCodigo('jefe@ejemplo.com');
    const malo = bueno === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++) assert.ok([401, 429].includes((await paso2(p3.pendiente, malo)).status));
    assert.notStrictEqual((await paso2(p3.pendiente, bueno)).status, 200);

    // Usuario antiguo (no es correo): sigue entrando solo con contraseña hasta que el admin le pone su correo
    const almacen = crearAlmacenArchivo(process.env.DATA_DIR);
    const viejoU = await almacen.usuarios.crear({ usuario: 'vitroqa', claveHash: hashClave('clave-vitroqa-123'), rol: 'empresa', perfilId: vitro.id });
    const directo = await paso1('vitroqa', 'clave-vitroqa-123');
    assert.match(directo.sesion, /^ds_sesion=.+/);
    assert.strictEqual(directo.datos.paso, undefined);
    assert.strictEqual((await llamar(`/api/usuarios/${viejoU.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { usuario: 'no-es-correo' } })).status, 400);
    await llamar(`/api/usuarios/${viejoU.id}`, { cookie: admin, metodo: 'PUT', cuerpo: { usuario: 'Compras@Vitro.com' } });
    assert.strictEqual((await llamar('/api/estado', { cookie: directo.sesion })).status, 401, 'cambiar el usuario cierra su sesión');
    await entrar('compras@vitro.com', 'clave-vitroqa-123', 'compras@vitro.com');

    // Límite de envíos de código por IP y cuenta
    let ultimo;
    for (let i = 0; i < 6; i++) ultimo = await paso1('compras@vitro.com', 'clave-vitroqa-123');
    assert.strictEqual(ultimo.status, 429);
  } finally {
    s.close();
  }
});
