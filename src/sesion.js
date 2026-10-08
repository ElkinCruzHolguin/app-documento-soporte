'use strict';
// Inicio de sesión: contraseñas con scrypt y sesión en una cookie firmada (HMAC).
// La llave de la firma sale de APP_SECRETO; sin ella (solo en local) se genera una por proceso.
const crypto = require('node:crypto');

const DURACION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'ds_sesion';

function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(clave), sal, 64);
  return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
}

function verificarClave(clave, guardado) {
  const [tipo, sal, hash] = String(guardado || '').split('$');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = crypto.scryptSync(String(clave), Buffer.from(sal, 'base64'), esperado.length);
  return crypto.timingSafeEqual(esperado, calculado);
}

/** Compara dos textos sin filtrar por tiempo cuánto coinciden. */
function igualSeguro(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function crearFirmador(secreto) {
  const llave = secreto
    ? crypto.createHash('sha256').update(`sesion|${secreto}`).digest()
    : crypto.randomBytes(32);
  const firmar = (texto) => crypto.createHmac('sha256', llave).update(texto).digest('base64url');
  return {
    /** datos: { usuario, rol, perfilId } */
    emitir(datos) {
      const cuerpo = Buffer.from(JSON.stringify({ ...datos, exp: Date.now() + DURACION_MS })).toString('base64url');
      return `${cuerpo}.${firmar(cuerpo)}`;
    },
    leer(token) {
      const [cuerpo, firma] = String(token || '').split('.');
      if (!cuerpo || !firma || !igualSeguro(firma, firmar(cuerpo))) return null;
      try {
        const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
        return datos.exp > Date.now() ? datos : null;
      } catch {
        return null;
      }
    },
  };
}

function leerCookie(req, nombre) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return '';
}

function cookieSesion(token, { segura }) {
  const atributos = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${token ? DURACION_MS / 1000 : 0}`];
  if (segura) atributos.push('Secure');
  return `${COOKIE}=${encodeURIComponent(token)}; ${atributos.join('; ')}`;
}

// Frena ataques de fuerza bruta: 5 intentos fallidos por IP y usuario cada 15 minutos.
const intentos = new Map();
const VENTANA_MS = 15 * 60 * 1000;
function bloqueado(clave) {
  const i = intentos.get(clave);
  return !!i && i.fallos >= 5 && Date.now() - i.desde < VENTANA_MS;
}
function registrarFallo(clave) {
  const i = intentos.get(clave);
  if (!i || Date.now() - i.desde >= VENTANA_MS) intentos.set(clave, { fallos: 1, desde: Date.now() });
  else i.fallos++;
}
const limpiarFallos = (clave) => intentos.delete(clave);

module.exports = { COOKIE, hashClave, verificarClave, igualSeguro, crearFirmador, leerCookie, cookieSesion, bloqueado, registrarFallo, limpiarFallos };
