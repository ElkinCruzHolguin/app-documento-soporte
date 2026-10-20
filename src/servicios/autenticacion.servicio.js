'use strict';
// Inicio de sesión y validación de la sesión.
// El super administrador es APP_USUARIO/APP_CLAVE (y APP_CORREO para entrar con código);
// los usuarios de compañía están en el repositorio y su usuario es su correo.
// Dos formas de entrar: código de un solo uso (OTP) enviado al correo, o usuario y contraseña (respaldo).
const crypto = require('node:crypto');
const { fallo } = require('../dominio/errores');
const { esCorreo, normalizarCorreo, OTP, mensajeCodigo } = require('../dominio/correo');

const MENSAJE_CODIGO_ENVIADO = 'Si el correo está registrado, te llegará un código de acceso en unos segundos. Revisa también la carpeta de spam.';

function crearServicioAutenticacion({ entorno, usuarios, codigos, correo, seguridad }) {
  const firmador = seguridad.crearFirmador(entorno.secreto);
  const hashCodigo = seguridad.crearHasherCodigos(entorno.secreto);
  const HASH_FALSO = seguridad.hashClave(crypto.randomBytes(16).toString('hex')); // iguala el tiempo si el usuario no existe
  const USUARIO_LOCAL = { id: 0, usuario: 'local', rol: 'admin', perfilId: null };

  /** Datos de sesión del dueño de ese correo (activo), o null. */
  async function cuentaPorCorreo(direccion) {
    if (entorno.correoAdmin && seguridad.igualSeguro(direccion, entorno.correoAdmin)) return { id: 0, usuario: direccion, rol: 'admin', perfilId: null };
    const u = await usuarios.porNombre(direccion);
    return u && u.activo ? { id: u.id, usuario: u.usuario, rol: u.rol, perfilId: u.perfilId } : null;
  }

  return {
    /** false solo en local sin APP_USUARIO/APP_CLAVE: no se pide inicio de sesión. */
    activa: entorno.autenticacion,

    /** Formas de entrar que ofrece la pantalla de inicio de sesión. */
    opciones() {
      return { login: entorno.autenticacion, codigo: entorno.autenticacion && correo.disponible, clave: true };
    },

    /**
     * Envía un código de acceso al correo si pertenece a un usuario activo (o al super administrador).
     * Responde lo mismo exista o no el correo, para no revelar quién está registrado.
     * 5 solicitudes por IP y correo cada 15 minutos.
     */
    async solicitarCodigo({ correo: dato, ip }) {
      if (!entorno.autenticacion || !correo.disponible) throw fallo(503, 'El ingreso con código no está disponible. Entra con usuario y contraseña.');
      const direccion = normalizarCorreo(dato);
      if (!esCorreo(direccion)) throw fallo(400, 'Escribe un correo válido.');
      const llave = `otp-envio|${ip}|${direccion}`;
      if (seguridad.bloqueado(llave)) throw fallo(429, 'Pediste demasiados códigos. Espera 15 minutos e inténtalo de nuevo.');
      seguridad.registrarFallo(llave);

      if (!(await cuentaPorCorreo(direccion))) return { mensaje: MENSAJE_CODIGO_ENVIADO };
      const codigo = seguridad.generarCodigo(OTP.digitos);
      await codigos.crear({ correo: direccion, codigoHash: hashCodigo(direccion, codigo), expiraEn: new Date(Date.now() + OTP.vigenciaMs).toISOString() });
      await correo.enviar({ para: direccion, ...mensajeCodigo(codigo) });
      return { mensaje: MENSAJE_CODIGO_ENVIADO };
    },

    /** Valida el código y devuelve { token, rol }. Cada código sirve una vez, vence en 10 minutos y admite 5 intentos. */
    async verificarCodigo({ correo: dato, codigo, ip }) {
      if (!entorno.autenticacion || !correo.disponible) throw fallo(503, 'El ingreso con código no está disponible. Entra con usuario y contraseña.');
      const direccion = normalizarCorreo(dato);
      const texto = String(codigo || '').replace(/\s/g, '');
      const llave = `otp|${ip}|${direccion}`;
      if (seguridad.bloqueado(llave)) throw fallo(429, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');

      const c = esCorreo(direccion) ? await codigos.ultimo(direccion) : null;
      const vigente = c && !c.usado && c.intentos < OTP.intentos && Date.parse(c.expiraEn) > Date.now();
      const ok = vigente && seguridad.igualSeguro(hashCodigo(direccion, texto), c.codigoHash);
      const cuenta = ok ? await cuentaPorCorreo(direccion) : null;
      if (!cuenta) {
        seguridad.registrarFallo(llave);
        if (vigente) await codigos.actualizar(c.id, { intentos: c.intentos + 1 });
        throw fallo(401, 'El código no es correcto o ya venció. Pide uno nuevo.');
      }
      await codigos.actualizar(c.id, { usado: true });
      seguridad.limpiarFallos(llave);
      if (cuenta.id) await usuarios.actualizar(cuenta.id, { ultimoIngreso: new Date().toISOString() });
      return { token: firmador.emitir(cuenta), rol: cuenta.rol };
    },

    /** Devuelve { token, rol }. 5 intentos fallidos por IP y usuario bloquean 15 minutos. */
    async iniciarSesion({ usuario, clave, ip }) {
      const nombre = String(usuario || '').trim().toLowerCase();
      const contrasena = String(clave || '');
      if (!entorno.autenticacion) return { token: '', rol: 'admin' };
      const llave = `${ip}|${nombre}`;
      if (seguridad.bloqueado(llave)) throw fallo(429, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.');

      let datos = null;
      if (seguridad.igualSeguro(nombre, entorno.usuarioAdmin.toLowerCase()) && seguridad.igualSeguro(contrasena, entorno.claveAdmin)) {
        datos = { id: 0, usuario: nombre, rol: 'admin', perfilId: null };
      } else {
        const u = await usuarios.porNombre(nombre);
        const ok = seguridad.verificarClave(contrasena, u ? u.claveHash : HASH_FALSO);
        if (u && ok && u.activo) {
          datos = { id: u.id, usuario: u.usuario, rol: u.rol, perfilId: u.perfilId };
          await usuarios.actualizar(u.id, { ultimoIngreso: new Date().toISOString() });
        }
      }
      if (!datos) {
        seguridad.registrarFallo(llave);
        throw fallo(401, 'Usuario o contraseña incorrectos.');
      }
      seguridad.limpiarFallos(llave);
      return { token: firmador.emitir(datos), rol: datos.rol };
    },

    /**
     * Devuelve el usuario de la sesión o lanza 401. Los usuarios de compañía se revalidan
     * en cada petición para que desactivarlos o cambiarles la compañía tenga efecto inmediato.
     */
    async validarSesion(token) {
      if (!entorno.autenticacion) return USUARIO_LOCAL;
      const d = firmador.leer(token);
      let valido = !!d;
      if (d && d.id) {
        const u = await usuarios.obtener(d.id);
        valido = !!u && u.activo && u.rol === d.rol && (u.perfilId ?? null) === (d.perfilId ?? null) && (!d.usuario || u.usuario === d.usuario);
      }
      if (!valido) throw fallo(401, 'Tu sesión terminó. Inicia sesión de nuevo.');
      return d;
    },
  };
}

module.exports = { crearServicioAutenticacion };
