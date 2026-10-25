// Cached server entry point for the storefront catalogue (see catalogue-data.ts).
import { cache } from "react";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { fetchCatalogue } from "./catalogue-data";
import type { StoreCatalogue } from "./merchandise";

// Catalogue edits (prices, copy, new pieces) reach the shop within this many seconds.
export const CATALOGUE_REVALIDATE = 60;

// No cookies: the catalogue is the same for everyone, so it can sit in Next's data
// cache. A failed load throws — an ISR page then keeps serving its last good copy.
export const loadCatalogue = cache(async (): Promise<StoreCatalogue> => {
  const db = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, next: { revalidate: CATALOGUE_REVALIDATE, tags: ["merch-catalogue"] } } as RequestInit),
    },
  });
  return fetchCatalogue(db);
});
