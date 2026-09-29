// Paystack InlineJS v2, loaded on demand. The popup opens Paystack's checkout over
// our page for a transaction the server already initialised — resumeTransaction()
// needs only that transaction's access code; no public key is involved.
// https://paystack.com/docs/developer-tools/inlinejs/

const SRC = "https://js.paystack.co/v2/inline.js";

export type PaystackSuccess = { reference: string; status?: string; trxref?: string };
type Callbacks = {
  onSuccess: (tx: PaystackSuccess) => void;
  onCancel: () => void;
  onError: (e: unknown) => void;
};

let loading: Promise<any | null> | null = null;

/** Resolves with the PaystackPop class, or null if the script can't be loaded (blocked, offline). */
export function loadPaystack(timeoutMs = 8000): Promise<any | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if ((window as any).PaystackPop) return Promise.resolve((window as any).PaystackPop);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    script.onload = () => { window.clearTimeout(timer); resolve((window as any).PaystackPop ?? null); };
    script.onerror = () => { window.clearTimeout(timer); loading = null; resolve(null); };
    document.head.appendChild(script);
  });
  return loading;
}

/** Open the popup. Returns false if Paystack's script is unavailable, so the caller can redirect instead. */
export async function openPaystackPopup(accessCode: string, callbacks: Callbacks): Promise<boolean> {
  const PaystackPop = await loadPaystack();
  if (!PaystackPop) return false;
  try {
    new PaystackPop().resumeTransaction(accessCode, callbacks);
    return true;
  } catch (e) {
    console.error("Paystack popup failed to open", e);
    return false;
  }
}
