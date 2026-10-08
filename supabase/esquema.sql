-- Esquema de la app de documentos soporte en Supabase.
-- Ejecutar una vez en Supabase > SQL Editor. Se puede volver a ejecutar sin romper nada.
-- Solo el servidor (con la service_role key) accede a estas tablas: RLS activo y sin políticas,
-- así que con la anon key o desde el navegador no se puede leer ni escribir nada.

create table if not exists public.perfiles (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  clave_cifrada text, -- contraseña de Saphety cifrada con APP_SECRETO (AES-256-GCM)
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists perfiles_un_solo_activo on public.perfiles (activo) where activo;

create table if not exists public.envios (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  perfil_id bigint references public.perfiles (id) on delete set null,
  perfil_nombre text,
  modo text not null check (modo in ('real', 'simulado')),
  estado text not null,
  numero text,
  nit_adquiriente text,
  proveedor text,
  identificacion text,
  valor numeric,
  saphety_id text,
  cuds text,
  mensaje text,
  documento jsonb, -- JSON enviado a Saphety
  respuesta jsonb  -- respuesta de Saphety (incluye el XML en base64)
);
-- Número del documento en el Excel (PREFIJO + FOLIO); puede diferir de "numero" con el consecutivo de pruebas.
alter table public.envios add column if not exists numero_excel text;
create index if not exists envios_creado_en on public.envios (creado_en desc);
create index if not exists envios_numero_excel on public.envios (nit_adquiriente, numero_excel) where modo = 'real';
create index if not exists envios_aceptados on public.envios (nit_adquiriente, numero) where modo = 'real' and estado = 'aceptado';

-- Usuarios de la app. El super administrador no está aquí: es APP_USUARIO/APP_CLAVE (variables de entorno).
-- rol 'empresa' = usuario de una compañía, limitado a su perfil; rol 'admin' = ve y administra todo.
create table if not exists public.usuarios (
  id bigint generated always as identity primary key,
  usuario text not null unique,
  clave_hash text not null, -- scrypt con sal; la contraseña no se puede recuperar
  rol text not null check (rol in ('admin', 'empresa')),
  perfil_id bigint references public.perfiles (id) on delete restrict,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  ultimo_ingreso timestamptz,
  check (rol = 'admin' or perfil_id is not null)
);
create index if not exists envios_perfil on public.envios (perfil_id, id desc);

alter table public.perfiles enable row level security;
alter table public.envios enable row level security;
alter table public.usuarios enable row level security;
revoke all on public.perfiles, public.envios, public.usuarios from anon, authenticated;

-- Deja un solo perfil activo (en una transacción).
create or replace function public.activar_perfil(p_id bigint) returns void
language plpgsql set search_path = '' as $$
begin
  update public.perfiles set activo = false, actualizado_en = now() where activo and id <> p_id;
  update public.perfiles set activo = true, actualizado_en = now() where id = p_id;
end $$;

-- Reserva el siguiente consecutivo de pruebas de forma atómica y devuelve el número reservado.
create or replace function public.tomar_consecutivo(p_id bigint, p_defecto bigint) returns bigint
language plpgsql set search_path = '' as $$
declare n bigint;
begin
  update public.perfiles
     set config = jsonb_set(config, '{siguienteConsecutivo}', to_jsonb(coalesce((config ->> 'siguienteConsecutivo')::bigint, p_defecto) + 1)),
         actualizado_en = now()
   where id = p_id
  returning (config ->> 'siguienteConsecutivo')::bigint - 1 into n;
  if n is null then raise exception 'Perfil % no encontrado', p_id; end if;
  return n;
end $$;

revoke execute on function public.activar_perfil(bigint), public.tomar_consecutivo(bigint, bigint) from public, anon, authenticated;
grant execute on function public.activar_perfil(bigint), public.tomar_consecutivo(bigint, bigint) to service_role;
grant all on public.perfiles, public.envios, public.usuarios to service_role;
