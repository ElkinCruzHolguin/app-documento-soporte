'use strict';
// Inyección de dependencias: arma repositorios, infraestructura y servicios una sola vez.
// Cada capa recibe lo que necesita de la capa inferior; ninguna crea sus dependencias.
const { crearRepositorios } = require('./repositorios');
const seguridad = require('./infraestructura/seguridad');
const saphety = require('./infraestructura/saphety');
const excel = require('./infraestructura/excel');
const { crearEnviadorCorreo } = require('./infraestructura/correo');
const { crearServicioAutenticacion } = require('./servicios/autenticacion.servicio');
const { crearServicioCompanias } = require('./servicios/companias.servicio');
const { crearServicioUsuarios } = require('./servicios/usuarios.servicio');
const { crearServicioDocumentos } = require('./servicios/documentos.servicio');
const { crearServicioHistorial } = require('./servicios/historial.servicio');
const { crearServicioEmitidos } = require('./servicios/emitidos.servicio');
const { crearServicioRecibidos } = require('./servicios/recibidos.servicio');
const { crearServicioDashboard } = require('./servicios/dashboard.servicio');
const { crearServicioCuenta } = require('./servicios/cuenta.servicio');
const { crearServicioModulos } = require('./servicios/modulos.servicio');

function crearContenedor(entorno) {
  // Los repositorios se crean al primer uso: así un error de configuración (p. ej. faltan
  // las llaves de Supabase) se informa en la petición y no tumba el arranque.
  let repos;
  const repositorios = () => (repos ||= crearRepositorios());
  const perezoso = (nombre) => new Proxy({}, { get: (_, k) => repositorios()[nombre][k] });
  const perfiles = perezoso('perfiles');
  const envios = perezoso('envios');
  const usuarios = perezoso('usuarios');
  const codigos = perezoso('codigos');
  const correo = crearEnviadorCorreo(entorno);

  const companias = crearServicioCompanias({ perfiles, saphety });
  const servicios = {
    autenticacion: crearServicioAutenticacion({ entorno, usuarios, codigos, correo, seguridad }),
    companias,
    usuarios: crearServicioUsuarios({ entorno, usuarios, perfiles, seguridad }),
    documentos: crearServicioDocumentos({ companias, perfiles, envios, saphety, excel }),
    historial: crearServicioHistorial({ envios }),
    emitidos: crearServicioEmitidos({ companias, perfiles, saphety }),
    recibidos: crearServicioRecibidos({ companias, perfiles, saphety }),
    dashboard: crearServicioDashboard({ companias, perfiles, envios, saphety }),
    cuenta: crearServicioCuenta({ usuarios, seguridad }),
    modulos: crearServicioModulos({ companias, usuarios }),
  };
  return { entorno, servicios, tipoAlmacen: () => repositorios().tipo };
}

module.exports = { crearContenedor };
