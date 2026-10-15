"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { normalizePhone } from "@/lib/phone";

// Dashboard → Cashless onboarding (migration 20261015100000): add vendors by phone
// number in bulk, give each a phone + password login, and hand the password over.

const localPhone = (p: string) => (p?.startsWith("254") ? `0${p.slice(3)}` : p);
const LOGIN_URL = "https://event.meatsokogroup.com/vendor/login";

type Row = { phone: string | null; raw: string; name: string };
type Result = { phone: string; name: string; vendor_id?: string; created?: boolean; qr_code?: string; has_login?: boolean; policy_accepted?: boolean; error?: string };
const ROW_ERR: Record<string, string> = {
  invalid_phone: "Not a Kenyan mobile number", duplicate_in_list: "Listed twice", invalid_name: "Name missing (2+ characters)",
  rejected_for_event: "Was rejected for this event",
};

/** "0703777706 - ally mutembei" (also tab, comma or several spaces) -> phone + name. */
function parse(text: string): Row[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([+\d][\d\s]{8,16}\d)\s*(?:[-–—,;:\t]|\s{2,}|\s)\s*(.*)$/);
    const raw = (m?.[1] ?? l).replace(/\s/g, "");
    return { raw, phone: normalizePhone(raw), name: (m?.[2] ?? "").trim() };
  });
}

export function BulkAddVendors({ eventId, eventName, knownPhones }: { eventId: string; eventName: string; knownPhones: Map<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [note, setNote] = useState("Accepted in person");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const rows = useMemo(() => parse(text), [text]);

  async function submit() {
    setBusy(true); setMsg("");
    const { data, error } = await createClient().rpc("admin_bulk_add_vendors", {
      p_event_id: eventId, p_rows: rows.map((r) => ({ phone: r.raw, name: r.name || knownPhones.get(r.phone ?? "") || "" })),
      p_policy_note: accepted ? note : null,
    });
    setBusy(false);
    const out: any = data;
    if (error || out?.error) { setMsg(error?.code === "42501" ? "Only admins can add vendors." : `Couldn't add (${out?.error ?? error?.message}).`); return; }
    setResults(out.rows);
    setText("");
    router.refresh();
  }

  if (!open) return <div><button type="button" className="dash-btn primary" onClick={() => setOpen(true)}>Add vendors by phone number</button></div>;
  return (
    <div className="dash-card">
      <strong>Add vendors to {eventName} by phone number</strong>
      <p className="dash-muted">One vendor per line: phone number, then their name (their M-Pesa name or business name). Each vendor is added, approved, and gets a booth QR code. A number already in the system keeps its existing vendor.</p>
      <textarea id="bulk-vendors" rows={6} placeholder={"0703777706 - ally mutembei\n0712997774 - peter thungutha"} value={text} onChange={(e) => { setText(e.target.value); setResults(null); }} />
      {!!rows.length && (
        <table className="dash-table"><thead><tr><th>Phone</th><th>Name</th><th>Check</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const known = r.phone ? knownPhones.get(r.phone) : undefined;
            const dup = rows.findIndex((x) => x.phone && x.phone === r.phone) !== i;
            return <tr key={i}><td>{r.phone ? localPhone(r.phone) : r.raw}</td><td>{r.name || known || <span className="dash-error">name needed</span>}</td>
              <td>{!r.phone ? <span className="dash-error">Not a Kenyan mobile number</span> : dup ? <span className="dash-error">Listed twice</span> : known ? <small>Already a vendor: {known}</small> : <small>New vendor</small>}</td></tr>;
          })}</tbody></table>
      )}
      <label className="vendor-sound"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> They accepted the commission in person (otherwise each accepts on first sign-in; their booth stays closed until then)</label>
      {accepted && <input id="bulk-policy-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="How they accepted (e.g. signed form)" />}
      {msg && <p className="dash-error">{msg}</p>}
      <div className="dash-row-actions">
        <button type="button" className="dash-btn primary" disabled={busy || !rows.length || rows.some((r) => !r.phone)} onClick={submit}>{busy ? "Adding…" : `Add & approve ${rows.length || ""}`}</button>
        <button type="button" className="dash-btn ghost" onClick={() => { setOpen(false); setResults(null); }}>Close</button>
      </div>
      {results && (
        <table className="dash-table"><thead><tr><th>Vendor</th><th>Result</th><th>Login</th></tr></thead>
          <tbody>{results.map((r, i) => (
            <tr key={i}><td><strong>{r.name}</strong><small>{localPhone(r.phone)}</small></td>
              <td>{r.error ? <span className="dash-error">{ROW_ERR[r.error] ?? r.error}</span> : <small>{r.created ? "Added" : "Already a vendor"} · approved · QR ready{r.policy_accepted ? " · commission accepted" : " · will accept on sign-in"}</small>}</td>
              <td>{r.vendor_id && <VendorLogin vendorId={r.vendor_id} name={r.name} phone={r.phone} hasLogin={!!r.has_login} method={r.has_login ? "phone_password" : null} />}</td></tr>
          ))}</tbody></table>
      )}
    </div>
  );
}

/**
 * Create a phone + password login, or reset it. The password is shown once, here,
 * with a ready-to-send message; it isn't stored anywhere it can be read again.
 */
export function VendorLogin({ vendorId, name, phone, hasLogin, method }: { vendorId: string; name: string; phone: string; hasLogin: boolean; method: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<{ login_phone: string; password: string } | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  if (hasLogin && method === "email") return <small>Signs in with email</small>;
  async function go() {
    setBusy(true); setErr("");
    const r = await invokeFn<{ login_phone: string; password: string; error?: string }>(createClient(), "vendor-invite", { vendor_id: vendorId, method: "phone_password" });
    setBusy(false);
    if (r.data?.password) { setCreds(r.data); router.refresh(); return; }
    setErr(r.errorCode === "email_is_staff" ? "That number belongs to a staff login." : r.errorCode === "forbidden" ? "Only admins can do this." : "Couldn't create the login. Try again.");
  }
  const message = creds ? `Hello ${name}, your MeatSoko vendor dashboard is ready.\nSign in: ${LOGIN_URL}\nPhone: ${creds.login_phone}\nPassword: ${creds.password}\nYou can change the password after signing in. Don't share it.` : "";
  if (creds) return (
    <div className="vendor-creds">
      <small>Phone <b className="dash-mono">{creds.login_phone}</b> · Password <b className="dash-mono">{creds.password}</b></small>
      <small>Shown once. Send it to {name} now.</small>
      <textarea readOnly rows={4} value={message} onFocus={(e) => e.currentTarget.select()} />
      <div className="dash-row-actions">
        <button type="button" className="dash-btn small primary" onClick={async () => { try { await navigator.clipboard.writeText(message); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy message"}</button>
        <a className="dash-btn small" href={`https://wa.me/${phone.replace(/^0/, "254")}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>
        <button type="button" className="dash-btn small ghost" onClick={() => setCreds(null)}>Done</button>
      </div>
    </div>
  );
  return (
    <span>
      <button type="button" className="dash-btn small" disabled={busy} onClick={go}>{busy ? "Working…" : hasLogin ? "Reset password" : "Create login"}</button>
      {err && <small className="dash-error">{err}</small>}
    </span>
  );
}
