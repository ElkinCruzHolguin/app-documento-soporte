'use strict';
// Inicio de sesión y validación de la sesión.
// El super administrador es APP_USUARIO/APP_CLAVE; su código llega a APP_CORREO.
// Los usuarios de compañía están en el repositorio y su usuario es su correo.
// Inicio en dos pasos: 1) usuario y contraseña; 2) si son correctos, el servidor no emite la sesión todavía:
// deja un estado «pendiente» (cookie firmada aparte, 10 minutos), envía un código de un solo uso (OTP)
// al correo de la cuenta, y solo al validar el código emite la cookie de sesión.
// Sin envío de correos configurado (o una cuenta sin correo) se entra solo con contraseña, como antes.
const crypto = require('node:crypto');
const { fallo } = require('../dominio/errores');
const { esCorreo, OTP, mensajeCodigo, enmascararCorreo } = require('../dominio/correo');
const { companiasDe } = require('../dominio/accesos');

const BLOQUEADO = 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.';
const PENDIENTE_VENCIDO = 'Tu ingreso venció. Vuelve a escribir tu usuario y contraseña.';

function crearServicioAutenticacion({ entorno, usuarios, codigos, correo, seguridad }) {
  const firmador = seguridad.crearFirmador(entorno.secreto);
  const firmadorPendiente = seguridad.crearFirmador(entorno.secreto, { proposito: 'pendiente-2fa', duracionMs: seguridad.DURACION_PENDIENTE_MS });
  const hashCodigo = seguridad.crearHasherCodigos(entorno.secreto);
  const HASH_FALSO = seguridad.hashClave(crypto.randomBytes(16).toString('hex')); // iguala el tiempo si el usuario no existe
  const USUARIO_LOCAL = { id: 0, usuario: 'local', rol: 'admin', perfilId: null };
  const dosPasos = () => entorno.autenticacion && correo.disponible;

  // El código es de la cuenta (no solo del correo): el admin y un usuario de compañía pueden compartir correo.
  const llaveCodigo = (p) => `${p.id}|${p.destino}`;

  /** Correo al que se envía el código de esa cuenta, o '' si no tiene. */
  const destinoDe = (datos) => (datos.rol === 'admin' && !datos.id ? entorno.correoAdmin : esCorreo(datos.usuario) ? datos.usuario : '');

  async function enviarCodigo(pendiente) {
    const codigo = seguridad.generarCodigo(OTP.digitos);
    const llave = llaveCodigo(pendiente);
    await codigos.crear({ correo: llave, codigoHash: hashCodigo(llave, codigo), expiraEn: new Date(Date.now() + OTP.vigenciaMs).toISOString() });
    await correo.enviar({ para: pendiente.destino, ...mensajeCodigo(codigo) });
  }

  function limitarEnvios(ip, pendiente) {
    const llave = `otp-envio|${ip}|${llaveCodigo(pendiente)}`;
    if (seguridad.bloqueado(llave)) throw fallo(429, 'Pediste demasiados códigos. Espera 15 minutos e inténtalo de nuevo.');
    seguridad.registrarFallo(llave);
  }

  function leerPendiente(token) {
    const p = firmadorPendiente.leer(token);
    if (!p || !p.destino) throw fallo(401, PENDIENTE_VENCIDO);
    return p;
  }

  /**
   * Comprueba que la cuenta sigue activa, con el mismo rol, y que la compañía de la sesión sigue
   * siendo una de las suyas (la principal o una ligada).
   */
  async function sigueValida(d) {
    if (!d.id) return true;
    const u = await usuarios.obtener(d.id);
    if (!u || !u.activo || u.rol !== d.rol || (d.usuario && u.usuario !== d.usuario)) return false;
    return u.rol === 'admin' ? d.perfilId == null : companiasDe(u).includes(Number(d.perfilId));
  }

  async function emitirSesion(datos) {
    if (datos.id) await usuarios.actualizar(datos.id, { ultimoIngreso: new Date().toISOString() });
    return { token: firmador.emitir(datos), rol: datos.rol };
  }

  return {
    /** false solo en local sin APP_USUARIO/APP_CLAVE: no se pide inicio de sesión. */
    activa: entorno.autenticacion,

    /**
     * Paso 1: usuario y contraseña. 5 intentos fallidos por IP y usuario bloquean 15 minutos.
     * Devuelve { token, rol } si la cuenta entra solo con contraseña, o { pendiente, destino } si falta el código.
     */
    async iniciarSesion({ usuario, clave, ip }) {
      const nombre = String(usuario || '').trim().toLowerCase();
      const contrasena = String(clave || '');
      if (!entorno.autenticacion) return { token: '', rol: 'admin' };
      const llave = `${ip}|${nombre}`;
      if (seguridad.bloqueado(llave)) throw fallo(429, BLOQUEADO);

      let datos = null;
      if (seguridad.igualSeguro(nombre, entorno.usuarioAdmin.toLowerCase()) && seguridad.igualSeguro(contrasena, entorno.claveAdmin)) {
        datos = { id: 0, usuario: nombre, rol: 'admin', perfilId: null };
      } else {
        const u = await usuarios.porNombre(nombre);
        const ok = seguridad.verificarClave(contrasena, u ? u.claveHash : HASH_FALSO);
        if (u && ok && u.activo) datos = { id: u.id, usuario: u.usuario, rol: u.rol, perfilId: u.perfilId };
      }
      if (!datos) {
        seguridad.registrarFallo(llave);
        throw fallo(401, 'Usuario o contraseña incorrectos.');
      }
      seguridad.limpiarFallos(llave);

      const destino = dosPasos() ? destinoDe(datos) : '';
      if (!destino) return emitirSesion(datos);
      const pendiente = { ...datos, destino };
      limitarEnvios(ip, pendiente);
      await enviarCodigo(pendiente);
      return { pendiente: firmadorPendiente.emitir(pendiente), destino: enmascararCorreo(destino) };
    },

    /** Paso 2: valida el código del correo y emite la sesión. Cada código sirve una vez, vence en 10 minutos y admite 5 intentos. */
    async verificarCodigo({ pendiente: token, codigo, ip }) {
      const p = leerPendiente(token);
      const llave = llaveCodigo(p);
      const llaveIntentos = `otp|${ip}|${llave}`;
      if (seguridad.bloqueado(llaveIntentos)) throw fallo(429, BLOQUEADO);

      const texto = String(codigo || '').replace(/\s/g, '');
      const c = await codigos.ultimo(llave);
      const vigente = c && !c.usado && c.intentos < OTP.intentos && Date.parse(c.expiraEn) > Date.now();
      if (!vigente || !seguridad.igualSeguro(hashCodigo(llave, texto), c.codigoHash)) {
        seguridad.registrarFallo(llaveIntentos);
        if (vigente) await codigos.actualizar(c.id, { intentos: c.intentos + 1 });
        throw fallo(401, 'El código no es correcto o ya venció. Pide uno nuevo.');
      }
      await codigos.actualizar(c.id, { usado: true });
      seguridad.limpiarFallos(llaveIntentos);
      const { destino, exp, ...datos } = p; // eslint-disable-line no-unused-vars
      if (!(await sigueValida(datos))) throw fallo(401, PENDIENTE_VENCIDO);
      return emitirSesion(datos);
    },

    /** Envía un código nuevo a la cuenta que está en el paso 2. */
    async reenviarCodigo({ pendiente: token, ip }) {
      const p = leerPendiente(token);
      limitarEnvios(ip, p);
      await enviarCodigo(p);
      return { destino: enmascararCorreo(p.destino) };
    },

    /** Cambia la compañía con la que trabaja un usuario de compañía (una de las suyas) y emite la sesión nueva. */
    async cambiarCompania(actor, perfilId) {
      if (actor.rol === 'admin' || !actor.id) throw fallo(400, 'El administrador elige la compañía en Administración.');
      const u = await usuarios.obtener(actor.id);
      const id = Number(perfilId);
      if (!u || !companiasDe(u).includes(id)) throw fallo(403, 'No tienes acceso a esa compañía.');
      return { token: firmador.emitir({ id: actor.id, usuario: actor.usuario, rol: actor.rol, perfilId: id }) };
    },

    /**
     * Devuelve el usuario de la sesión o lanza 401. Los usuarios de compañía se revalidan
     * en cada petición para que desactivarlos o cambiarles la compañía tenga efecto inmediato.
     */
    async validarSesion(token) {
      if (!entorno.autenticacion) return USUARIO_LOCAL;
      const d = firmador.leer(token);
      if (!d || !(await sigueValida(d))) throw fallo(401, 'Tu sesión terminó. Inicia sesión de nuevo.');
      return d;
    },
  };
}

module.exports = { crearServicioAutenticacion };
