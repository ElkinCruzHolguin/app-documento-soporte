'use strict';
// Almacén local en archivos JSON (desarrollo y pruebas). En Vercel se usa Supabase.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULTS, conDefaults } = require('../config');
const { llaveDesdeTexto, crearCifrador } = require('../cifrado');
const { publico, resumenEnvio, fallo } = require('./comun');

function crearAlmacenArchivo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ARCHIVO = path.join(dir, 'parametros.json');
  const ARCHIVO_ENVIOS = path.join(dir, 'envios.json');

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
    /** Números (de la lista) que ya fueron aceptados por Saphety en envío real para ese NIT. */
    aceptados: async (nit, numeros) => {
      const buscados = new Set(numeros);
      return new Set(leerEnvios().filter((e) => e.modo === 'real' && e.estado === 'aceptado' && e.nitAdquiriente === nit && buscados.has(e.numero)).map((e) => e.numero));
    },
    listar: async ({ buscar = '', limite = 100 } = {}) => {
      const q = buscar.toUpperCase();
      return leerEnvios()
        .filter((e) => !q || [e.numero, e.proveedor, e.identificacion].some((v) => String(v || '').toUpperCase().includes(q)))
        .sort((a, b) => b.id - a.id)
        .slice(0, limite)
        .map(resumenEnvio);
    },
    obtener: async (id) => leerEnvios().find((e) => e.id === Number(id)) || null,
  };

  return { tipo: 'archivo', perfiles, envios };
}

module.exports = { crearAlmacenArchivo };
