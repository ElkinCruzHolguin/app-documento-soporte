## Qué cambia
Antes:

Después:

## Cómo probarlo
- [ ] `npm test` pasa en local
- [ ] Probado en la vista previa de Vercel del PR (enlace: )

## Checklist
- [ ] Cierra el issue #
- [ ] Sin lógica de negocio en rutas ni controladores (rutas → controladores → servicios → dominio/repositorios/infraestructura)
- [ ] Sin claves, tokens ni contraseñas en el código
- [ ] Lo que ya existía sigue funcionando (Cargar y enviar, Historial, Administración, Emitidos, Recibidos)
- [ ] Si toca archivos compartidos (`src/rutas/index.js`, `src/contenedor.js`, `public/comun.js`, `public/app.css`), el cambio es pequeño y se actualizó con `main` antes de pedir revisión
