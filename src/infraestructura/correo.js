'use strict';
// Envío de correos. En producción usa la API de Mailgun (MAILGUN_API_KEY, MAILGUN_DOMINIO, CORREO_REMITENTE)
// o la de Resend (RESEND_API_KEY, CORREO_REMITENTE).
// En local, sin esas variables, no envía nada: escribe el correo en la consola y lo deja en `bandejaLocal`
// (lo usan las pruebas). En Vercel, sin esas variables, el envío no está disponible.

const bandejaLocal = [];

function crearEnviadorCorreo({ correo = {}, enVercel = false } = {}, { fetch: fetchFn = globalThis.fetch } = {}) {
  const { llaveResend, llaveMailgun, dominioMailgun, regionMailgun, remitente } = correo;

  if (llaveMailgun && dominioMailgun && remitente) {
    const base = regionMailgun === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
    return {
      disponible: true,
      async enviar({ para, asunto, texto, html }) {
        const cuerpo = new URLSearchParams({ from: remitente, to: para, subject: asunto, text: texto || '' });
        if (html) cuerpo.set('html', html);
        const r = await fetchFn(`${base}/v3/${encodeURIComponent(dominioMailgun)}/messages`, {
          method: 'POST',
          headers: { Authorization: `Basic ${Buffer.from(`api:${llaveMailgun}`).toString('base64')}` },
          body: cuerpo,
        });
        if (!r.ok) {
          const detalle = await r.text().catch(() => '');
          throw new Error(`No se pudo enviar el correo (Mailgun HTTP ${r.status}): ${detalle.slice(0, 300)}`);
        }
      },
    };
  }

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
