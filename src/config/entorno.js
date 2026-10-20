'use strict';
// Variables de entorno de la app (ver .env.example). Se leen en un solo lugar.

function leerEntorno(env = process.env) {
  const usuarioAdmin = env.APP_USUARIO || '';
  const claveAdmin = env.APP_CLAVE || '';
  // Con APP_USUARIO y APP_CLAVE se exige inicio de sesión (obligatorio en Vercel).
  const autenticacion = !!(usuarioAdmin && claveAdmin);
  return {
    puerto: Number(env.PORT || 3000),
    host: env.HOST || (autenticacion ? '0.0.0.0' : '127.0.0.1'),
    usuarioAdmin,
    claveAdmin,
    autenticacion,
    secreto: env.APP_SECRETO || '',
    enVercel: !!env.VERCEL,
    // Ingreso con código de un solo uso (OTP) enviado al correo.
    correoAdmin: String(env.APP_CORREO || '').trim().toLowerCase(), // correo del super administrador (opcional)
    correo: {
      llaveResend: env.RESEND_API_KEY || '',
      llaveMailgun: env.MAILGUN_API_KEY || '',
      dominioMailgun: env.MAILGUN_DOMINIO || '',
      regionMailgun: String(env.MAILGUN_REGION || 'us').toLowerCase(), // 'us' o 'eu', según la región de la cuenta
      remitente: env.CORREO_REMITENTE || '',
    },
  };
}

module.exports = { leerEntorno };
