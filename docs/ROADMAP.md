# Plan del portal

Meta: llevar la app al portal del diseño en Lovable (DIAN Connect Hub), un portal tipo Saphety o Gosocket pero mejorado. Cada fila es un issue en GitHub; el estado vivo está allí. El cliente de Saphety (`src/infraestructura/saphety/`) ya tiene una función por endpoint del kit de Postman, así que cada funcionalidad es sobre todo servicio + dominio + pantalla + pruebas.

Responsable sugerido: **A** = Elkin, **B** = compañero. La división es por área para que cada uno toque carpetas distintas.

## Hecho
| Funcionalidad | Vista del Lovable | Endpoints | Estado |
|---|---|---|---|
| Cargar Excel y enviar documento soporte | Emitir | `supportDocument` | En producción |
| Historial de envíos | — | (Supabase) | En producción |
| Administración: compañías y usuarios | Configuración | `auth/gettoken` | En producción |
| Diseño DIAN Connect Hub | Todas | — | En producción |
| Emitidos y detalle (PDF, XML, respuestas DIAN) | Documentos emitidos | `outbounddocuments/search`, `count`, `{id}`, `status`, `applicationresponses`, `{formato}/content` | En producción, falta validar contra QA real |
| Recibidos y eventos RADIAN (030, 032, 033, 031) | Documentos recibidos | `inbounddocuments/search`, `count`, `{id}`, `pdf`, `ubl`, `attacheddocument`, `applicationresponses`, `receive`, `goodsreceived`, `accept`, `reject` | En este PR, falta validar contra QA real |

## Siguiente
| # | Funcionalidad | Vista del Lovable | Funciones del cliente (`saphety.*`) | Resp. |
|---|---|---|---|---|
| 1 | Validar Emitidos y Recibidos contra QA real (paginación `Offset`, forma de `ResultData`) | — | `buscarEmitidos`, `buscarRecibidos` | A |
| 2 | Dashboard: totales del mes, por estado, emitidos vs recibidos, pendientes por gestionar | Dashboard | `contarEmitidos`, `contarRecibidos`, `buscar*` | B |
| 3 | Series y numeración desde Saphety (consultar, crear, editar) | Configuración → Series | `listarSeries`, `seriesPorTipo`, `serie`, `crearSerie`, `actualizarSerie` | A |
| 4 | Trazabilidad: línea de tiempo de cada documento (creado, validado DIAN, correo, eventos) | Trazabilidad | `estadoEmitido`, `respuestasEmitido`, `respuestasRecibido`, `sincronizarRecibido` | B |
| 5 | Reenviar correo del documento | Detalle de emitido | `enviarCorreo` | B |
| 6 | Catálogos DIAN en Administración (municipios, unidades, impuestos) | Configuración | `catalogo` (`/v2/dataelements/{nombre}`) | B |
| 7 | Nota de ajuste al documento soporte | Emitir | `crearDocumento('notaAjusteSoporte')`, `generarCodigo('cuds')` | A |
| 8 | Factura de venta, nota crédito y nota débito | Emitir | `crearDocumento('facturaVenta' / 'notaCredito' / 'notaDebito')`, `generarCodigo('cufe')` | A |
| 9 | Nómina electrónica y nota de ajuste de nómina | Nómina | `crearDocumento('nomina' / 'ajusteNomina')`, `generarCodigo('cune')` | B |
| 10 | Documento equivalente POS | POS | `crearDocumento('documentoEquivalentePos')`, `generarCodigo('cudePos')` | A |

Orden recomendado: 1 primero (confirma que lo construido funciona con datos reales), luego 2 a 6 en paralelo (A y B en áreas distintas), y al final la emisión de otros documentos (7 a 10), que comparte el mapeo Excel → JSON y conviene hacer de a uno.
