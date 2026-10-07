'use strict';
// Copia los perfiles locales (data/parametros.json) a Supabase, una sola vez.
// La contraseña se descifra con la llave local (data/.secreto) y se vuelve a cifrar con APP_SECRETO.
// Uso: npm run migrar   (lee SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y APP_SECRETO del archivo .env)
const fs = require('node:fs');
const path = require('node:path');
const { crearCifrador } = require('../src/cifrado');
const { crearAlmacenSupabase } = require('../src/almacen/supabase');

async function main() {
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const archivo = path.join(dir, 'parametros.json');
  if (!fs.existsSync(archivo)) throw new Error(`No existe ${archivo}: no hay perfiles locales que migrar.`);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_SECRETO } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !APP_SECRETO) throw new Error('Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o APP_SECRETO en .env');

  const local = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  const secretoLocal = path.join(dir, '.secreto');
  const { descifrar } = crearCifrador(Buffer.from(fs.readFileSync(secretoLocal, 'utf8').trim(), 'hex'));
  const destino = crearAlmacenSupabase({ url: SUPABASE_URL, llaveServicio: SUPABASE_SERVICE_ROLE_KEY, secreto: APP_SECRETO });

  const existentes = new Map((await destino.perfiles.listar()).map((p) => [p.nombre, p]));
  for (const p of local.perfiles) {
    if (existentes.has(p.nombre)) {
      console.log(`- «${p.nombre}» ya existe en Supabase, no se toca.`);
      continue;
    }
    const nuevo = await destino.perfiles.crear(p.nombre, p.config, p.claveCifrada ? descifrar(p.claveCifrada) : undefined);
    if (p.activo) await destino.perfiles.activar(nuevo.id);
    console.log(`+ «${p.nombre}» migrado${p.claveCifrada ? ' (con contraseña)' : ''}${p.activo ? ' y activo' : ''}.`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
