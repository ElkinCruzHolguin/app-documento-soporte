# App de documentos soporte (Saphety)

Carga un Excel donde **cada fila es un documento soporte**, valida las filas, arma el JSON de Saphety y lo envía a la API: primero pide el token (`POST /v2/auth/gettoken`) y luego crea el documento (`POST /v2/{opv}/outbounddocuments/supportDocument`), igual que en Postman.

## Requisitos
- Node.js 22 o superior.
- Base de datos: Supabase en producción. En local, sin variables de Supabase, usa archivos JSON en `data/`.

## Instalar y arrancar (local)
```bash
npm install
npm run dev          # http://localhost:3000 (lee .env si existe)
npm test             # pruebas (incluye una API de Saphety falsa; no usan Supabase)
```
Las variables están documentadas en `.env.example`. Copia ese archivo como `.env` (git lo ignora). **Ningún usuario, contraseña ni llave va en el código.**

## Desplegar (GitHub + Supabase + Vercel)
1. **Supabase**: en el SQL Editor ejecuta `supabase/esquema.sql`. Crea las tablas `perfiles` y `envios` con RLS activo y sin políticas: solo el servidor, con la service_role key, puede leerlas.
2. **Vercel**: importa el repositorio de GitHub (Framework: Other) y en *Settings → Environment Variables* define:
   - `APP_USUARIO`, `APP_CLAVE`: acceso a la app. Sin ellas, la app en Vercel no atiende.
   - `APP_SECRETO`: llave larga y aleatoria para cifrar la contraseña de Saphety. No la cambies después.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: en Supabase, *Project Settings → API*.
3. Cada push a `main` despliega de nuevo. Las páginas (`public/`) las sirve Vercel y la API corre en `api/index.js` (ver `vercel.json`). Vercel limita las peticiones a 4,5 MB, así que el Excel debe pesar menos.
4. Para pasar los perfiles que ya tenías en `data/` a Supabase, pon las variables de Supabase y `APP_SECRETO` en `.env` y ejecuta `npm run migrar`.

La contraseña de Saphety se escribe en Administración, se guarda cifrada (AES-256-GCM) con `APP_SECRETO` y nunca vuelve al navegador.

## Uso
1. **Administración**: crea o edita el perfil (ambiente). Ahí se parametrizan usuario (correo), contraseña, URL, opv, companyId, NIT y DV del adquiriente, SerieExternalKey de DS, numeración, modo de envío y valores por defecto. La contraseña se guarda cifrada y nunca se muestra; si dejas el campo vacío se conserva la actual. «Probar conexión» solo pide el token.
2. **Cargar y enviar**: sube el Excel. La app lo convierte al JSON de Saphety y cada fila queda «Lista para enviar» o «Con errores» (con el motivo). Haz clic en una fila para ver o copiar el JSON. «Descargar JSON» baja el JSON de todas las filas válidas.
3. Selecciona filas y pulsa **Enviar**. En modo **simulado** (por defecto) no sale nada a internet. En modo **real** pide confirmación y envía de a uno; en pantalla se ve la respuesta de Saphety (errores DIAN, Id, CUDS y el XML descargable).

4. **Historial**: cada envío real queda guardado con el JSON enviado, la respuesta de Saphety y el XML. El Excel y los envíos simulados no se guardan.

Protecciones: números repetidos dentro del mismo archivo se marcan como error; un número que Saphety ya aceptó (según el historial, para el mismo NIT) se marca como error y no se reenvía; si falla el token se detiene el envío.

## Mapeo Excel → JSON
| Columna del Excel | Campo Saphety |
|---|---|
| Prefijo (o TIPO) / PREFIJO + FOLIO (o Folio) | `SeriePrefix` / `SerieNumber`; `CorrelationDocumentId` = prefijo+número |
| FECHA_DOC | `IssueDate`, `DueDate`, `DeliveryDate`, `PaymentMeans.DueDate`, `InvoicePeriod.From` |
| MONEDA, valor_trm, fecha_trm | `Currency`; si no es COP, `PaymentExchangeRate` |
| PRECEDENCIA (10/11) | `OperationType` |
| CEDULA O NIT, TIPO DE DOCUMENTO, PAIS | `SupplierParty.Identification` (DV calculado si es NIT) |
| TIPO PERSONA (1/2) | `LegalType` Legal / Natural |
| PROVEEDOR; NOMBRE, SEGUNDO NOMBRE, APELLIDOS | `Name`; `Person` (persona natural) |
| OBLIGACIONES FISCALES / OBLIGACIONES IMPUESTO | `ResponsabilityTypes` / `TaxScheme` |
| DIRECCION, DEPARTAMENTO, MUNICIPIO, CODIGO POSTAL | `Address`: códigos DIAN con ceros a la izquierda para residentes. Para no residentes, `CityName`/`DepartmentName` salen de la tabla «Ubicación de proveedores extranjeros» de Administración (por identificación del proveedor o, si no está, por país); si tampoco está, la capital del país (`src/capitales.js`) con un aviso |
| TELEFONO (si no es 0) | `Telephone` |
| VALOR_TOTAL ITEM | `UnitPrice`, `GrossAmount`, `NetAmount` y totales (IVA 0 %) |
| IDENTIFICACION PRODUCTO / DESCRIPCION | `Item.Gtin` / `Item.Description` |
| CONCEPTO LINEA | `InvoicePeriod.DescriptionCode` |
| base/tasa/valor reteiva y retefuente | `WithholdingTaxSubTotals` 05 (ReteIVA) y 06 (ReteRenta) en línea y total |
| NUMORDEN, OBSERVACION, FECHA_ITEM | `Notes` |
| NIT EMISOR | se valida contra el NIT configurado |

Las columnas se reconocen por el nombre del encabezado, no por la posición.

## Estructura
- `src/server.js` rutas HTTP y envío por lotes
- `src/excel.js` lectura del Excel
- `src/mapper.js` fila → JSON de Saphety y validaciones
- `src/saphety.js` token, envío, modo simulado
- `src/almacen/` perfiles e historial: `supabase.js` (producción) o `archivo.js` (local)
- `src/cifrado.js` cifrado de la contraseña de Saphety
- `supabase/esquema.sql` tablas y funciones de la base de datos
- `api/index.js`, `vercel.json` despliegue en Vercel
- `scripts/migrar-a-supabase.js` copia los perfiles locales a Supabase
- `public/` pantallas (HTML + JS sin dependencias)
