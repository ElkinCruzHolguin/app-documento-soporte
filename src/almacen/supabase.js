'use strict';
// Almacén en Supabase (producción / Vercel). Usa la service_role key, que solo
// vive en variables de entorno del servidor; las tablas tienen RLS sin políticas.
// Esquema: supabase/esquema.sql
const { createClient } = require('@supabase/supabase-js');
const { DEFAULTS, conDefaults } = require('../config');
const { llaveDesdeTexto, crearCifrador } = require('../cifrado');
const { publico, resumenEnvio, fallo } = require('./comun');

function crearAlmacenSupabase({ url, llaveServicio, secreto, cliente }) {
  if (!secreto) throw new Error('Falta la variable APP_SECRETO (llave para cifrar la contraseña de Saphety).');
  const db = cliente || createClient(url, llaveServicio, { auth: { persistSession: false, autoRefreshToken: false } });
  const { cifrar, descifrar } = crearCifrador(llaveDesdeTexto(secreto));

  const revisar = ({ data, error }) => {
    if (error) {
      if (error.code === '23505') throw fallo(400, 'Ya existe un perfil con ese nombre.');
      throw new Error(`Supabase: ${error.message}`);
    }
    return data;
  };
  const aPerfil = (f) => f && ({ id: f.id, nombre: f.nombre, activo: f.activo, config: f.config, claveCifrada: f.clave_cifrada });
  const COLUMNAS = 'id, nombre, activo, config, clave_cifrada';

  async function filaPerfil(id) {
    return aPerfil(revisar(await db.from('perfiles').select(COLUMNAS).eq('id', Number(id)).maybeSingle()));
  }

  const perfiles = {
    listar: async () => {
      let filas = revisar(await db.from('perfiles').select(COLUMNAS).order('nombre'));
      if (!filas.length) {
        // Primera vez: un perfil inicial para empezar a configurar.
        revisar(await db.from('perfiles').insert({ nombre: 'Calidad (QA)', activo: true, config: { ...DEFAULTS } }));
        filas = revisar(await db.from('perfiles').select(COLUMNAS).order('nombre'));
      }
      return filas.map(aPerfil).map(publico);
    },
    obtener: async (id) => publico(await filaPerfil(id)),
    activo: async () => publico(aPerfil(revisar(await db.from('perfiles').select(COLUMNAS).eq('activo', true).maybeSingle()))),
    clave: async (id) => {
      const p = await filaPerfil(id);
      return p && p.claveCifrada ? descifrar(p.claveCifrada) : '';
    },
    crear: async (nombre, config, clave) => {
      const { count } = await db.from('perfiles').select('id', { count: 'exact', head: true });
      const fila = revisar(await db.from('perfiles')
        .insert({ nombre, activo: !count, config: conDefaults(config), clave_cifrada: clave ? cifrar(clave) : null })
        .select(COLUMNAS).single());
      return publico(aPerfil(fila));
    },
    actualizar: async (id, nombre, config, clave) => {
      const cambios = { nombre, config: conDefaults(config), actualizado_en: new Date().toISOString() };
      if (clave) cambios.clave_cifrada = cifrar(clave);
      return publico(aPerfil(revisar(await db.from('perfiles').update(cambios).eq('id', Number(id)).select(COLUMNAS).single())));
    },
    activar: async (id) => { revisar(await db.rpc('activar_perfil', { p_id: Number(id) })); },
    eliminar: async (id) => { revisar(await db.from('perfiles').delete().eq('id', Number(id))); },
    /** Reserva el siguiente consecutivo de pruebas de forma atómica (función SQL). */
    tomarConsecutivo: async (id) => {
      const n = revisar(await db.rpc('tomar_consecutivo', { p_id: Number(id), p_defecto: DEFAULTS.siguienteConsecutivo }));
      const p = await filaPerfil(id);
      return { prefijo: conDefaults(p.config).prefijoConsecutivo, numero: String(n) };
    },
  };

  const aEnvio = (f) => f && ({
    id: f.id, creadoEn: f.creado_en, perfilId: f.perfil_id, perfilNombre: f.perfil_nombre, modo: f.modo, estado: f.estado,
    numero: f.numero, nitAdquiriente: f.nit_adquiriente, proveedor: f.proveedor, identificacion: f.identificacion,
    valor: f.valor == null ? null : Number(f.valor), saphetyId: f.saphety_id, cuds: f.cuds, mensaje: f.mensaje,
    documento: f.documento, respuesta: f.respuesta,
  });

  const envios = {
    registrar: async (r) => revisar(await db.from('envios').insert({
      perfil_id: r.perfilId, perfil_nombre: r.perfilNombre, modo: r.modo, estado: r.estado, numero: r.numero,
      nit_adquiriente: r.nitAdquiriente, proveedor: r.proveedor, identificacion: r.identificacion, valor: r.valor,
      saphety_id: r.saphetyId, cuds: r.cuds, mensaje: r.mensaje, documento: r.documento, respuesta: r.respuesta,
    }).select('id').single()).id,
    aceptados: async (nit, numeros) => {
      const encontrados = new Set();
      for (let i = 0; i < numeros.length; i += 200) {
        const filas = revisar(await db.from('envios').select('numero')
          .eq('modo', 'real').eq('estado', 'aceptado').eq('nit_adquiriente', nit).in('numero', numeros.slice(i, i + 200)));
        for (const f of filas) encontrados.add(f.numero);
      }
      return encontrados;
    },
    listar: async ({ buscar = '', limite = 100 } = {}) => {
      let q = db.from('envios')
        .select('id, creado_en, perfil_nombre, modo, estado, numero, proveedor, identificacion, valor, saphety_id, cuds, mensaje')
        .order('id', { ascending: false }).limit(limite);
      const b = buscar.replace(/[^\p{L}\p{N} .-]/gu, '').trim();
      if (b) q = q.or(`numero.ilike.*${b}*,proveedor.ilike.*${b}*,identificacion.ilike.*${b}*`);
      return revisar(await q).map(aEnvio).map(resumenEnvio);
    },
    obtener: async (id) => aEnvio(revisar(await db.from('envios').select('*').eq('id', Number(id)).maybeSingle())),
  };

  return { tipo: 'supabase', perfiles, envios };
}

module.exports = { crearAlmacenSupabase };
