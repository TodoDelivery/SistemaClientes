// =========================================================================
// CONEXIÓN A SUPABASE (APP CLIENTES)
// =========================================================================
// Es el mismo proyecto de Supabase que usa la app de cadetes: los dos repos comparten BD y canales.
// La versión de supabase-js está fijada a propósito: una versión "flotante" (@2) puede cambiar sola
// y romper la app sin tocar el código. Para actualizarla, ver README.md → "Actualizar dependencias".
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

// Datos públicos del proyecto (Settings → API). La clave "publishable/anon" está pensada para el
// navegador: la seguridad la dan las políticas RLS, no esconder esta clave.
const SUPABASE_URL = 'https://zngfzdcipqbddmyuqaht.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4fmNtN1o4x20cXTNuGGPow_ZG01UHIB';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export default supabase;
