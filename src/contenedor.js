'use strict';
// Inyección de dependencias: arma repositorios, infraestructura y servicios una sola vez.
// Cada capa recibe lo que necesita de la capa inferior; ninguna crea sus dependencias.
const { crearRepositorios } = require('./repositorios');
const seguridad = require('./infraestructura/seguridad');
const saphety = require('./infraestructura/saphety');
const excel = require('./infraestructura/excel');
const { crearServicioAutenticacion } = require('./servicios/autenticacion.servicio');
const { crearServicioCompanias } = require('./servicios/companias.servicio');
const { crearServicioUsuarios } = require('./servicios/usuarios.servicio');
const { crearServicioDocumentos } = require('./servicios/documentos.servicio');
const { crearServicioHistorial } = require('./servicios/historial.servicio');

function crearContenedor(entorno) {
  // Los repositorios se crean al primer uso: así un error de configuración (p. ej. faltan
  // las llaves de Supabase) se informa en la petición y no tumba el arranque.
  let repos;
  const repositorios = () => (repos ||= crearRepositorios());
  const perezoso = (nombre) => new Proxy({}, { get: (_, k) => repositorios()[nombre][k] });
  const perfiles = perezoso('perfiles');
  const envios = perezoso('envios');
  const usuarios = perezoso('usuarios');

  const companias = crearServicioCompanias({ perfiles, saphety });
  const servicios = {
    autenticacion: crearServicioAutenticacion({ entorno, usuarios, seguridad }),
    companias,
    usuarios: crearServicioUsuarios({ entorno, usuarios, perfiles, seguridad }),
    documentos: crearServicioDocumentos({ companias, perfiles, envios, saphety, excel }),
    historial: crearServicioHistorial({ envios }),
  };
  return { entorno, servicios, tipoAlmacen: () => repositorios().tipo };
}

module.exports = { crearContenedor };
