'use strict';
// Cifrado de la contraseña de Saphety (AES-256-GCM). La llave nunca se guarda
// junto a los datos: viene de APP_SECRETO (Vercel) o, en local, de data/.secreto.
const crypto = require('node:crypto');

const llaveDesdeTexto = (texto) => crypto.createHash('sha256').update(String(texto)).digest();

function crearCifrador(llave) {
  return {
    cifrar(textoPlano) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', llave, iv);
      const enc = Buffer.concat([c.update(textoPlano, 'utf8'), c.final()]);
      return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
    },
    descifrar(guardado) {
      const [iv, tag, enc] = guardado.split('.').map((s) => Buffer.from(s, 'base64'));
      const d = crypto.createDecipheriv('aes-256-gcm', llave, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
    },
  };
}

module.exports = { llaveDesdeTexto, crearCifrador };
