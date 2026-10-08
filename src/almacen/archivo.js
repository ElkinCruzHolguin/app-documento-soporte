'use strict';
// Almacén local en archivos JSON (desarrollo y pruebas). En Vercel se usa Supabase.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULTS, conDefaults } = require('../config');
const { llaveDesdeTexto, crearCifrador } = require('../cifrado');
const { publico, resumenEnvio, fallo, resumirPrevios, usuarioPublico } = require('./comun');

function crearAlmacenArchivo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ARCHIVO = path.join(dir, 'parametros.json');
  const ARCHIVO_ENVIOS = path.join(dir, 'envios.json');
  const ARCHIVO_USUARIOS = path.join(dir, 'usuarios.json');

  function llave() {
    if (process.env.APP_SECRETO) return llaveDesdeTexto(process.env.APP_SECRETO);
    const archivo = path.join(dir, '.secreto');
    if (!fs.existsSync(archivo)) fs.writeFileSync(archivo, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    return Buffer.from(fs.readFileSync(archivo, 'utf8').trim(), 'hex');
  }
  const { cifrar, descifrar } = crearCifrador(llave());

  function guardarJson(archivo, datos) {
    const tmp = `${archivo}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(datos, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, archivo);
  }
  function leer() {
    if (!fs.existsSync(ARCHIVO)) return { siguienteId: 2, perfiles: [{ id: 1, nombre: 'Calidad (QA)', activo: true, config: { ...DEFAULTS }, claveCifrada: null }] };
    return JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  }
  const escribir = (d) => guardarJson(ARCHIVO, d);
  const leerUsuarios = () => (fs.existsSync(ARCHIVO_USUARIOS) ? JSON.parse(fs.readFileSync(ARCHIVO_USUARIOS, 'utf8')) : []);
  const leerEnvios = () => (fs.existsSync(ARCHIVO_ENVIOS) ? JSON.parse(fs.readFileSync(ARCHIVO_ENVIOS, 'utf8')) : []);

  const perfiles = {
    listar: async () => leer().perfiles.map(publico).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    obtener: async (id) => publico(leer().perfiles.find((p) => p.id === Number(id))),
    activo: async () => publico(leer().perfiles.find((p) => p.activo)),
    clave: async (id) => {
      const p = leer().perfiles.find((x) => x.id === Number(id));
      return p && p.claveCifrada ? descifrar(p.claveCifrada) : '';
    },
    crear: async (nombre, config, clave) => {
      const d = leer();
      if (d.perfiles.some((p) => p.nombre === nombre)) throw fallo(400, 'Ya existe un perfil con ese nombre.');
      const p = { id: d.siguienteId++, nombre, activo: d.perfiles.length === 0, config: conDefaults(config), claveCifrada: clave ? cifrar(clave) : null };
      d.perfiles.push(p);
      escribir(d);
      return publico(p);
    },
    actualizar: async (id, nombre, config, clave) => {
      const d = leer();
      const p = d.perfiles.find((x) => x.id === Number(id));
      if (d.perfiles.some((x) => x.nombre === nombre && x.id !== p.id)) throw fallo(400, 'Ya existe un perfil con ese nombre.');
      p.nombre = nombre;
      p.config = conDefaults(config);
      if (clave) p.claveCifrada = cifrar(clave);
      escribir(d);
      return publico(p);
    },
    activar: async (id) => {
      const d = leer();
      for (const p of d.perfiles) p.activo = p.id === Number(id);
      escribir(d);
    },
    eliminar: async (id) => {
      if (leerUsuarios().some((u) => u.perfilId === Number(id))) throw fallo(400, 'El perfil tiene usuarios asignados: elimínalos o asígnalos a otro perfil primero.');
      const d = leer();
      d.perfiles = d.perfiles.filter((p) => p.id !== Number(id));
      escribir(d);
    },
    /** Reserva el siguiente consecutivo de pruebas y lo incrementa (solo envíos reales). */
    tomarConsecutivo: async (id) => {
      const d = leer();
      const p = d.perfiles.find((x) => x.id === Number(id));
      const n = Number(conDefaults(p.config).siguienteConsecutivo);
      p.config.siguienteConsecutivo = n + 1;
      escribir(d);
      return { prefijo: conDefaults(p.config).prefijoConsecutivo, numero: String(n) };
    },
  };

  const envios = {
    registrar: async (registro) => {
      const lista = leerEnvios();
      const id = lista.reduce((m, e) => Math.max(m, e.id), 0) + 1;
      const fila = { id, creadoEn: new Date().toISOString(), ...registro };
      lista.push(fila);
      guardarJson(ARCHIVO_ENVIOS, lista);
      return id;
    },
    /** Envíos reales previos de esos números del Excel para ese NIT (ver resumirPrevios). */
    previos: async (nit, numerosExcel) => {
      const buscados = new Set(numerosExcel);
      return resumirPrevios(leerEnvios().filter((e) => e.modo === 'real' && e.nitAdquiriente === nit), buscados);
    },
    listar: async ({ buscar = '', limite = 100, perfilId = null } = {}) => {
      const q = buscar.toUpperCase();
      return leerEnvios()
        .filter((e) => perfilId == null || e.perfilId === Number(perfilId))
        .filter((e) => !q || [e.numero, e.numeroExcel, e.proveedor, e.identificacion].some((v) => String(v || '').toUpperCase().includes(q)))
        .sort((a, b) => b.id - a.id)
        .slice(0, limite)
        .map(resumenEnvio);
    },
    obtener: async (id) => leerEnvios().find((e) => e.id === Number(id)) || null,
  };

  const usuarios = {
    listar: async () => leerUsuarios().map(usuarioPublico).sort((a, b) => a.usuario.localeCompare(b.usuario)),
    obtener: async (id) => usuarioPublico(leerUsuarios().find((u) => u.id === Number(id))),
    /** Incluye claveHash: solo para el inicio de sesión. */
    porNombre: async (usuario) => leerUsuarios().find((u) => u.usuario === usuario) || null,
    crear: async ({ usuario, claveHash, rol, perfilId }) => {
      const lista = leerUsuarios();
      if (lista.some((u) => u.usuario === usuario)) throw fallo(400, 'Ya existe un usuario con ese nombre.');
      const u = { id: lista.reduce((m, x) => Math.max(m, x.id), 0) + 1, usuario, claveHash, rol, perfilId: perfilId ?? null, activo: true, creadoEn: new Date().toISOString() };
      lista.push(u);
      guardarJson(ARCHIVO_USUARIOS, lista);
      return usuarioPublico(u);
    },
    actualizar: async (id, cambios) => {
      const lista = leerUsuarios();
      const u = lista.find((x) => x.id === Number(id));
      if (!u) throw fallo(404, 'Usuario no encontrado.');
      Object.assign(u, cambios);
      guardarJson(ARCHIVO_USUARIOS, lista);
      return usuarioPublico(u);
    },
    eliminar: async (id) => guardarJson(ARCHIVO_USUARIOS, leerUsuarios().filter((u) => u.id !== Number(id))),
  };

  return { tipo: 'archivo', perfiles, envios, usuarios };
}

module.exports = { crearAlmacenArchivo };
