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
| Dashboard: indicadores del mes, volumen de 7 días, estado DIAN, emisión reciente, centro de atención | Dashboard | `contarEmitidos`, `buscarEmitidos`, `contarRecibidos`, `buscarRecibidos`, historial | En PR |
| Recibidos y eventos RADIAN (030, 032, 033, 031) | Documentos recibidos | `inbounddocuments/search`, `count`, `{id}`, `pdf`, `ubl`, `attacheddocument`, `applicationresponses`, `receive`, `goodsreceived`, `accept`, `reject` | En este PR, falta validar contra QA real |

## Siguiente
| Issue | Funcionalidad | Vista del Lovable | Funciones del cliente (`saphety.*`) | Resp. |
|---|---|---|---|---|
| [#6](https://github.com/ElkinCruzHolguin/app-documento-soporte/issues/6) | Validar Emitidos y Recibidos contra QA real (paginación `Offset`, forma de `ResultData`) | — | `buscarEmitidos`, `buscarRecibidos` | A |
| [#8](https://github.com/ElkinCruzHolguin/app-documento-soporte/issues/8) | Series y numeración desde Saphety (consultar, crear, editar) | Configuración → Series | `listarSeries`, `seriesPorTipo`, `serie`, `crearSerie`, `actualizarSerie` | A |
| [#9](https://github.com/ElkinCruzHolguin/app-documento-soporte/issues/9) | Trazabilidad: línea de tiempo de cada documento (creado, validado DIAN, correo, eventos) | Trazabilidad | `estadoEmitido`, `respuestasEmitido`, `respuestasRecibido`, `sincronizarRecibido` | B |
| [#10](https://github.com/ElkinCruzHolguin/app-documento-soporte/issues/10) | Reenviar correo del documento | Detalle de emitido | `enviarCorreo` | B |
| [#11](https://github.com/ElkinCruzHolguin/app-documento-soporte/issues/11) | Catálogos DIAN en Administración (municipios, unidades, impuestos) | Configuración | `catalogo` (`/v2/dataelements/{nombre}`) | B |
| [#12](https://github.com/ElkinCruzHolguin/app-documento-soporte/issues/12) | Nota de ajuste al documento soporte | Emitir | `crearDocumento('notaAjusteSoporte')`, `generarCodigo('cuds')` | A |
| [#13](https://github.com/ElkinCruzHolguin/app-documento-soporte/issues/13) | Factura de venta, nota crédito y nota débito | Emitir | `crearDocumento('facturaVenta' / 'notaCredito' / 'notaDebito')`, `generarCodigo('cufe')` | A |
| [#14](https://github.com/ElkinCruzHolguin/app-documento-soporte/issues/14) | Nómina electrónica y nota de ajuste de nómina | Nómina | `crearDocumento('nomina' / 'ajusteNomina')`, `generarCodigo('cune')` | B |
| [#15](https://github.com/ElkinCruzHolguin/app-documento-soporte/issues/15) | Documento equivalente POS | POS | `crearDocumento('documentoEquivalentePos')`, `generarCodigo('cudePos')` | A |

Orden recomendado: #6 primero (confirma que lo construido funciona con datos reales), luego #7 a #11 en paralelo (A y B en áreas distintas), y al final la emisión de otros documentos (#12 a #15), que comparte el mapeo Excel → JSON y conviene hacer de a uno.
