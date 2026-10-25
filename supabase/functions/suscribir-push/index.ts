// =========================================================================
// SUSCRIBIR-PUSH: alta y baja del celular que activó los avisos
// =========================================================================
// La llaman las apps (supabase.functions.invoke) con { accion: 'alta' | 'baja', suscripcion, id_cad? }.
// Push_suscripciones está cerrada a la clave pública, así que el alta pasa por acá:
// - Cliente: el dueño sale del token de sesión de Supabase (nunca del cuerpo).
// - Cadete: todavía no tiene login de Supabase, así que se acepta su id_cad. Los avisos no llevan datos
//   sensibles; cuando los cadetes tengan login real, tomar el id del token igual que con clientes.
// La clave VAPID pública también se devuelve acá ({ accion: 'clave' }), para no repetirla en las apps.
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function idClienteDelToken(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  return data?.user?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405);

  try {
    const { accion, suscripcion, id_cad } = await req.json();

    if (accion === 'clave') {
      const { data, error } = await supabase.rpc('push_config');
      if (error || !data?.push_vapid_publica) throw new Error('Falta la clave VAPID pública');
      return responder({ clave: data.push_vapid_publica });
    }

    const endpoint = String(suscripcion?.endpoint || '');
    if (!endpoint.startsWith('https://')) return responder({ error: 'Suscripción inválida' }, 400);

    if (accion === 'baja') {
      const { error } = await supabase.from('Push_suscripciones').delete().eq('endpoint', endpoint);
      if (error) throw error;
      return responder({ ok: true });
    }

    if (accion !== 'alta') return responder({ error: 'Acción desconocida' }, 400);

    const { p256dh, auth } = suscripcion?.keys || {};
    if (!p256dh || !auth) return responder({ error: 'Faltan las claves de la suscripción' }, 400);

    const fila: Record<string, unknown> = { endpoint, claves: { p256dh, auth }, id_cad: null, id_cliente: null };
    if (id_cad != null) {
      const { data: cadete } = await supabase.from('Cadetes').select('id_cad').eq('id_cad', Number(id_cad)).maybeSingle();
      if (!cadete) return responder({ error: 'Cadete inexistente' }, 400);
      fila.id_cad = cadete.id_cad;
    } else {
      const idCliente = await idClienteDelToken(req);
      if (!idCliente) return responder({ error: 'Sesión de cliente inválida' }, 401);
      fila.id_cliente = idCliente;
    }

    // Mismo celular con otra persona (o la misma): se pisa el dueño de esa fila
    const { error } = await supabase.from('Push_suscripciones').upsert(fila, { onConflict: 'endpoint' });
    if (error) throw error;
    return responder({ ok: true });
  } catch (err: any) {
    console.error('[suscribir-push] Error:', err?.message || err);
    return responder({ error: String(err?.message || err) }, 500);
  }
});
