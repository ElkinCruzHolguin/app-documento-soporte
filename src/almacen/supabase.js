'use strict';
// Almacén en Supabase (producción / Vercel). Usa la service_role key, que solo
// vive en variables de entorno del servidor; las tablas tienen RLS sin políticas.
// Esquema: supabase/esquema.sql
const { createClient } = require('@supabase/supabase-js');
const { DEFAULTS, conDefaults } = require('../config');
const { llaveDesdeTexto, crearCifrador } = require('../cifrado');
const { publico, resumenEnvio, fallo, resumirPrevios, usuarioPublico } = require('./comun');

function crearAlmacenSupabase({ url, llaveServicio, secreto, cliente }) {
  if (!secreto) throw new Error('Falta la variable APP_SECRETO (llave para cifrar la contraseña de Saphety).');
  const db = cliente || createClient(url, llaveServicio, { auth: { persistSession: false, autoRefreshToken: false } });
  const { cifrar, descifrar } = crearCifrador(llaveDesdeTexto(secreto));

  const revisar = ({ data, error }) => {
    if (error) {
      if (error.code === '23505') throw fallo(400, /usuarios/.test(error.message) ? 'Ya existe un usuario con ese nombre.' : 'Ya existe una compañía con ese nombre.');
      if (error.code === '23503') throw fallo(400, 'La compañía tiene usuarios asignados: elimínalos o asígnalos a otra compañía primero.');
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
    numero: f.numero, numeroExcel: f.numero_excel, nitAdquiriente: f.nit_adquiriente, proveedor: f.proveedor, identificacion: f.identificacion,
    valor: f.valor == null ? null : Number(f.valor), saphetyId: f.saphety_id, cuds: f.cuds, mensaje: f.mensaje,
    documento: f.documento, respuesta: f.respuesta,
  });

  const envios = {
    registrar: async (r) => revisar(await db.from('envios').insert({
      perfil_id: r.perfilId, perfil_nombre: r.perfilNombre, modo: r.modo, estado: r.estado, numero: r.numero, numero_excel: r.numeroExcel,
      nit_adquiriente: r.nitAdquiriente, proveedor: r.proveedor, identificacion: r.identificacion, valor: r.valor,
      saphety_id: r.saphetyId, cuds: r.cuds, mensaje: r.mensaje, documento: r.documento, respuesta: r.respuesta,
    }).select('id').single()).id,
    previos: async (nit, numerosExcel) => {
      const filas = new Map(); // id -> fila (una fila puede salir por numero_excel y por numero)
      for (let i = 0; i < numerosExcel.length; i += 200) {
        const lote = numerosExcel.slice(i, i + 200);
        for (const columna of ['numero_excel', 'numero']) {
          const r = revisar(await db.from('envios').select('id, numero, numero_excel, estado')
            .eq('modo', 'real').eq('nit_adquiriente', nit).in(columna, lote));
          for (const f of r) filas.set(f.id, { id: f.id, numero: f.numero, numeroExcel: f.numero_excel, estado: f.estado });
        }
      }
      return resumirPrevios([...filas.values()], new Set(numerosExcel));
    },
    listar: async ({ buscar = '', limite = 100, perfilId = null } = {}) => {
      let q = db.from('envios')
        .select('id, creado_en, perfil_nombre, modo, estado, numero, numero_excel, proveedor, identificacion, valor, saphety_id, cuds, mensaje')
        .order('id', { ascending: false }).limit(limite);
      if (perfilId != null) q = q.eq('perfil_id', Number(perfilId));
      const b = buscar.replace(/[^\p{L}\p{N} .-]/gu, '').trim();
      if (b) q = q.or(`numero.ilike.*${b}*,numero_excel.ilike.*${b}*,proveedor.ilike.*${b}*,identificacion.ilike.*${b}*`);
      return revisar(await q).map(aEnvio).map(resumenEnvio);
    },
    obtener: async (id) => aEnvio(revisar(await db.from('envios').select('*').eq('id', Number(id)).maybeSingle())),
  };

  const aUsuario = (f) => f && ({
    id: f.id, usuario: f.usuario, claveHash: f.clave_hash, rol: f.rol, perfilId: f.perfil_id, activo: f.activo,
    creadoEn: f.creado_en, ultimoIngreso: f.ultimo_ingreso,
  });
  const usuarios = {
    listar: async () => revisar(await db.from('usuarios').select('*').order('usuario')).map(aUsuario).map(usuarioPublico),
    obtener: async (id) => usuarioPublico(aUsuario(revisar(await db.from('usuarios').select('*').eq('id', Number(id)).maybeSingle()))),
    /** Incluye claveHash: solo para el inicio de sesión. */
    porNombre: async (usuario) => aUsuario(revisar(await db.from('usuarios').select('*').eq('usuario', usuario).maybeSingle())),
    crear: async ({ usuario, claveHash, rol, perfilId }) => usuarioPublico(aUsuario(revisar(await db.from('usuarios')
      .insert({ usuario, clave_hash: claveHash, rol, perfil_id: perfilId ?? null }).select('*').single()))),
    actualizar: async (id, c) => {
      const cambios = {};
      if ('claveHash' in c) cambios.clave_hash = c.claveHash;
      if ('rol' in c) cambios.rol = c.rol;
      if ('perfilId' in c) cambios.perfil_id = c.perfilId;
      if ('activo' in c) cambios.activo = c.activo;
      if ('ultimoIngreso' in c) cambios.ultimo_ingreso = c.ultimoIngreso;
      return usuarioPublico(aUsuario(revisar(await db.from('usuarios').update(cambios).eq('id', Number(id)).select('*').single())));
    },
    eliminar: async (id) => { revisar(await db.from('usuarios').delete().eq('id', Number(id))); },
  };

  return { tipo: 'supabase', perfiles, envios, usuarios };
}

module.exports = { crearAlmacenSupabase };
