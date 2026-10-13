# Cómo trabajamos en equipo

Somos dos personas sobre el mismo repositorio. `main` es producción: cada fusión a `main` se despliega sola en https://app-documento-soporte.vercel.app. Por eso nadie trabaja directo sobre `main`.

## El flujo, paso a paso
1. **Toma un issue** del tablero (pestaña *Issues*) y asígnatelo. Si no existe, créalo con la plantilla «Funcionalidad del portal». Un issue = una funcionalidad pequeña.
2. **Crea una rama desde `main` actualizado**:
   ```bash
   git checkout main && git pull
   git checkout -b feat/12-dashboard      # feat|fix/<número del issue>-<nombre corto>
   ```
3. **Trabaja y haz commits pequeños**. Corre `npm test` antes de subir.
4. **Sube la rama y abre un PR a `main` en borrador** desde el primer día (`git push -u origin feat/12-dashboard`). Así el otro ve en qué estás y Vercel crea una **vista previa** con su propio enlace para probar.
5. **Mantén la rama al día** con `main` al menos una vez al día y siempre antes de pedir revisión:
   ```bash
   git fetch origin && git merge origin/main
   ```
6. **Pide revisión** al compañero cuando el CI esté en verde y lo hayas probado en la vista previa. El otro revisa en el día.
7. **Fusiona con «Squash and merge»** cuando esté aprobado. Borra la rama. Eso despliega a producción.

## Cómo no pisarnos
- **Trabajen en carpetas distintas**. Cada funcionalidad vive en sus propios archivos: `public/<pantalla>.html`, `src/servicios/<area>.servicio.js`, `src/dominio/<area>.js`, `src/controladores/<area>.controlador.js`, `src/infraestructura/saphety/<area>.js` y `test/<area>.test.js`. Si cada uno toma un área diferente, casi no habrá conflictos.
- **Archivos compartidos** (todos los tocan): `src/rutas/index.js`, `src/contenedor.js`, `public/comun.js` (el menú `MENU`) y `public/app.css`. En ellos:
  - agrega líneas, no reorganices ni reformatees lo que ya está;
  - cambios pequeños y fusiónalos pronto;
  - si necesitas un cambio grande (por ejemplo, rediseñar estilos), avísalo en el issue antes.
- **El menú** se arma en `public/comun.js`: para una pantalla nueva basta agregar una línea a `MENU` y poner `<nav id="menu" data-activo="mi-pagina.html"></nav>` en la página. El ícono va en `public/app.css` junto a los demás.
- **La base de datos** (Supabase) es compartida por producción y las vistas previas. Un cambio de esquema se acuerda en el issue, se escribe en `supabase/esquema.sql` y debe ser compatible con lo que ya está en producción (agregar columnas o tablas, no borrar).

## Reglas del código
- Capas: **rutas → controladores → servicios → dominio / repositorios / infraestructura**. Nada de lógica de negocio en rutas ni controladores.
- Las llamadas a Saphety van en `src/infraestructura/saphety/` (una función por endpoint) y se usan desde un servicio con `saphety.<funcion>(compania.id, compania.config, clave, ...)`.
- Cada compañía ve solo lo suyo: el servicio valida el NIT antes de devolver un documento.
- Lo que sale a la DIAN y no se puede deshacer (envíos reales, eventos RADIAN) exige la compañía en modo real y confirmación explícita.
- Claves, contraseñas y tokens solo en variables de entorno (`.env` en local, Vercel en la nube). Nunca en el código ni en los commits.
- Pruebas con la API de Saphety falsa (ver `test/emitidos.test.js` y `test/recibidos.test.js`).

## Correr en local
```bash
npm install
cp .env.example .env    # pide los valores al otro por un canal privado
npm run dev             # http://localhost:3000
npm test
```
Sin `SUPABASE_URL` la app guarda en `data/` (archivos locales), útil para probar sin tocar la base compartida.

## Configuración de GitHub (la hace el dueño del repositorio)
1. **Invitar al compañero**: *Settings → Collaborators → Add people* con su usuario de GitHub (rol *Write*).
2. **Proteger `main`**: *Settings → Rules → Rulesets → New branch ruleset*, objetivo `main`, y activar: *Require a pull request before merging* (1 aprobación), *Require status checks to pass* (`pruebas`) y *Block force pushes*. En repositorios privados con plan gratuito GitHub puede no aplicar estas reglas; en ese caso las seguimos por acuerdo.
3. **Fusiones**: *Settings → General → Pull Requests*: dejar solo *Allow squash merging* y activar *Automatically delete head branches*.
4. **Vercel**: el compañero no necesita cuenta; cada PR muestra el enlace de su vista previa. Si las vistas previas piden inicio de sesión de Vercel, desactivar *Vercel Authentication* en *Project → Settings → Deployment Protection* o invitarlo al equipo.
