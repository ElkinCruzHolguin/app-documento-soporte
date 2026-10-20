'use strict';
// Envío de correos. En producción usa la API de Resend (RESEND_API_KEY y CORREO_REMITENTE).
// En local, sin esas variables, no envía nada: escribe el correo en la consola y lo deja en `bandejaLocal`
// (lo usan las pruebas). En Vercel, sin esas variables, el envío no está disponible.

const bandejaLocal = [];

function crearEnviadorCorreo({ correo = {}, enVercel = false } = {}, { fetch: fetchFn = globalThis.fetch } = {}) {
  const { llaveResend, remitente } = correo;

  if (llaveResend && remitente) {
    return {
      disponible: true,
      async enviar({ para, asunto, texto, html }) {
        const r = await fetchFn('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${llaveResend}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: remitente, to: [para], subject: asunto, text: texto, html }),
        });
        if (!r.ok) {
          const detalle = await r.text().catch(() => '');
          throw new Error(`No se pudo enviar el correo (Resend HTTP ${r.status}): ${detalle.slice(0, 300)}`);
        }
      },
    };
  }

  if (enVercel) return { disponible: false, async enviar() { throw new Error('El envío de correos no está configurado.'); } };

  return {
    disponible: true,
    async enviar(mensaje) {
      bandejaLocal.push(mensaje);
      if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) {
        console.log(`[correo local] Para ${mensaje.para}: ${mensaje.asunto}`);
      }
    },
  };
}

module.exports = { crearEnviadorCorreo, bandejaLocal };
