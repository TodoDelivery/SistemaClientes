-- Notificaciones push (Web Push): una fila por celular que activó los avisos
create table public."Push_suscripciones" (
  endpoint    text primary key,  -- dirección del celular en el servicio push
  claves      jsonb not null,    -- { p256dh, auth } que entrega el navegador
  id_cad      bigint references public."Cadetes"(id_cad) on delete cascade,
  id_cliente  uuid   references public."Clientes"(id_cliente) on delete cascade,
  creada_en   timestamptz not null default now(),
  check ((id_cad is null) <> (id_cliente is null))  -- es de un cadete o de un cliente
);
create index on public."Push_suscripciones" (id_cad) where id_cad is not null;
create index on public."Push_suscripciones" (id_cliente) where id_cliente is not null;
-- Cerrada a la clave pública: solo la usan las Edge Functions con la service_role
alter table public."Push_suscripciones" enable row level security;
revoke all on public."Push_suscripciones" from anon, authenticated;

-- Claves de push guardadas en Vault (push_vapid_publica, push_vapid_privada, push_secreto_disparador).
-- Solo la service_role (Edge Functions) puede leerlas.
create or replace function public.push_config()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_object_agg(name, decrypted_secret)
  from vault.decrypted_secrets
  where name in ('push_vapid_publica', 'push_vapid_privada', 'push_secreto_disparador');
$$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

-- Avisa a la Edge Function enviar-push cuando cambia el estado, el cadete o el chat de un pedido.
-- pg_net es asíncrono: no demora el UPDATE de las apps.
create or replace function public.notificar_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  secreto text;
begin
  select decrypted_secret into secreto from vault.decrypted_secrets where name = 'push_secreto_disparador';
  if secreto is null then
    return new;
  end if;
  perform net.http_post(
    url := 'https://zngfzdcipqbddmyuqaht.supabase.co/functions/v1/enviar-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secreto', secreto),
    body := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
  );
  return new;
exception when others then
  -- Un problema con los avisos nunca puede frenar un pedido
  raise warning 'notificar_push: %', sqlerrm;
  return new;
end;
$$;
revoke all on function public.notificar_push() from public, anon, authenticated;

create trigger push_pedidos
  after update on public."Pedidos"
  for each row
  when (old.estado_pedido is distinct from new.estado_pedido
     or old.id_cadete     is distinct from new.id_cadete
     or old."Chat_pedido" is distinct from new."Chat_pedido")
  execute function public.notificar_push();
