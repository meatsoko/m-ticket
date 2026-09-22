import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Call an Edge Function and always get the parsed JSON body back.
 *
 * `supabase.functions.invoke()` sets `data: null` whenever the response is non-2xx and
 * puts the Response on `error.context`. Reading only `data` therefore throws away the
 * server's own error code — so a throttle (429), a sold-out type (409) and a Daraja
 * rejection (502) all arrive indistinguishable from a network failure, which is how
 * every checkout problem ended up rendering as one generic message.
 */
export async function invokeFn<T = any>(
  supabase: SupabaseClient,
  name: string,
  body?: Record<string, unknown>
): Promise<{ data: T | null; status: number | null; errorCode: string | null; transportError: boolean }> {
  const { data, error } = await supabase.functions.invoke(name, body ? { body } : {});

  if (!error) {
    return { data: data as T, status: 200, errorCode: null, transportError: false };
  }

  // FunctionsHttpError carries the Response; FunctionsFetchError (CORS, offline, DNS)
  // does not — that distinction is what tells a user "retry" from "we rejected this".
  const res: Response | undefined = (error as any)?.context instanceof Response
    ? (error as any).context
    : undefined;

  if (!res) {
    return { data: null, status: null, errorCode: null, transportError: true };
  }

  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* non-JSON error body */ }

  return {
    data: parsed as T,
    status: res.status,
    errorCode: parsed?.error ?? null,
    transportError: false,
  };
}
