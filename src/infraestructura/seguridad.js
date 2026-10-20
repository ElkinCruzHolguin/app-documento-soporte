'use strict';
// Inicio de sesión: contraseñas con scrypt y sesión en una cookie firmada (HMAC).
// La llave de la firma sale de APP_SECRETO; sin ella (solo en local) se genera una por proceso.
const crypto = require('node:crypto');

const DURACION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'ds_sesion';
// Segundo paso del inicio de sesión: contraseña correcta, falta el código del correo.
const COOKIE_PENDIENTE = 'ds_2fa';
const DURACION_PENDIENTE_MS = 10 * 60 * 1000;
// Navegador de confianza: tras validar el código, durante 7 días ese navegador entra solo con contraseña.
const COOKIE_CONFIANZA = 'ds_equipo';
const DURACION_CONFIANZA_MS = 7 * 24 * 60 * 60 * 1000;

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

/** proposito separa las llaves: un token de un propósito nunca sirve para otro (p. ej. el pendiente no es sesión). */
function crearFirmador(secreto, { proposito = 'sesion', duracionMs = DURACION_MS } = {}) {
  const llave = secreto
    ? crypto.createHash('sha256').update(`${proposito}|${secreto}`).digest()
    : crypto.randomBytes(32);
  const firmar = (texto) => crypto.createHmac('sha256', llave).update(texto).digest('base64url');
  return {
    /** datos: { usuario, rol, perfilId } */
    emitir(datos) {
      const cuerpo = Buffer.from(JSON.stringify({ ...datos, exp: Date.now() + duracionMs })).toString('base64url');
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

/** Código numérico aleatorio (OTP), con ceros a la izquierda. */
function generarCodigo(digitos = 6) {
  return String(crypto.randomInt(0, 10 ** digitos)).padStart(digitos, '0');
}

/** Hash de un código de acceso (HMAC con APP_SECRETO): el código nunca se guarda en claro. */
function crearHasherCodigos(secreto) {
  const llave = secreto
    ? crypto.createHash('sha256').update(`codigo|${secreto}`).digest()
    : crypto.randomBytes(32);
  return (correo, codigo) => crypto.createHmac('sha256', llave).update(`${correo}|${codigo}`).digest('base64url');
}

function leerCookie(req, nombre) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return '';
}

function crearCookie(nombre, token, duracionMs, { segura }) {
  const atributos = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${token ? duracionMs / 1000 : 0}`];
  if (segura) atributos.push('Secure');
  return `${nombre}=${encodeURIComponent(token)}; ${atributos.join('; ')}`;
}
const cookieSesion = (token, opciones) => crearCookie(COOKIE, token, DURACION_MS, opciones);
const cookiePendiente = (token, opciones) => crearCookie(COOKIE_PENDIENTE, token, DURACION_PENDIENTE_MS, opciones);
const cookieConfianza = (token, opciones) => crearCookie(COOKIE_CONFIANZA, token, DURACION_CONFIANZA_MS, opciones);

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

module.exports = { COOKIE, COOKIE_PENDIENTE, DURACION_PENDIENTE_MS, cookiePendiente, COOKIE_CONFIANZA, DURACION_CONFIANZA_MS, cookieConfianza, hashClave, verificarClave, igualSeguro, crearFirmador, generarCodigo, crearHasherCodigos, leerCookie, cookieSesion, bloqueado, registrarFallo, limpiarFallos };
