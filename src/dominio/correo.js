'use strict';
// Reglas del correo como nombre de usuario y del código de acceso (OTP).

const FORMATO_CORREO = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

const normalizarCorreo = (v) => String(v || '').trim().toLowerCase();
const esCorreo = (v) => FORMATO_CORREO.test(normalizarCorreo(v)) && normalizarCorreo(v).length <= 120;

// Código de 6 dígitos que vence en 10 minutos y admite 5 intentos.
const OTP = { digitos: 6, vigenciaMs: 10 * 60 * 1000, intentos: 5 };

/** Texto del correo con el código. */
function mensajeCodigo(codigo) {
  const minutos = OTP.vigenciaMs / 60000;
  return {
    asunto: `Tu código de acceso: ${codigo}`,
    texto: `Tu código para entrar a Documentos soporte es ${codigo}.\n\nVence en ${minutos} minutos y solo sirve una vez. Si no lo pediste, ignora este correo.`,
    html: `<p>Tu código para entrar a <b>Documentos soporte</b> es:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${codigo}</p><p>Vence en ${minutos} minutos y solo sirve una vez. Si no lo pediste, ignora este correo.</p>`,
  };
}

/** Correo para mostrar sin revelarlo completo: e***z@jtc.com.co */
function enmascararCorreo(correo) {
  const [usuario, dominio] = String(correo).split('@');
  if (!dominio) return '';
  return `${usuario[0]}***${usuario.length > 1 ? usuario.slice(-1) : ''}@${dominio}`;
}

module.exports = { esCorreo, normalizarCorreo, OTP, mensajeCodigo, enmascararCorreo };
