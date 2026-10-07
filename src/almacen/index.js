'use strict';
// Elige dónde se guardan perfiles e historial:
// - Supabase si están SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (Vercel / producción).
// - Archivos JSON en DATA_DIR (./data) en cualquier otro caso (desarrollo y pruebas).
const path = require('node:path');

function crearAlmacen(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const { crearAlmacenSupabase } = require('./supabase');
    return crearAlmacenSupabase({ url: env.SUPABASE_URL, llaveServicio: env.SUPABASE_SERVICE_ROLE_KEY, secreto: env.APP_SECRETO });
  }
  if (env.VERCEL) throw new Error('En Vercel hay que configurar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY: el disco no es persistente.');
  const { crearAlmacenArchivo } = require('./archivo');
  return crearAlmacenArchivo(env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
}

module.exports = { crearAlmacen };
