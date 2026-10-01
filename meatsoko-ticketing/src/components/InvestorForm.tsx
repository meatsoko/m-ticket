"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { looksLikeEmail } from "@/lib/phone";
import { SUPPORT } from "@/lib/support";
import { INVESTOR_DAY, INVESTOR_VENUE, MAX_GUESTS, SALUTATIONS } from "@/lib/investors";

// Investors' visit registration (migration 20261001150000) -> investor-register.
// Guests are entered by name so the organiser knows who is coming. Every field
// is required, including at least one guest.

type Done = { reference_number: string; emailed: boolean; existing: boolean };

export default function InvestorForm() {
  const [salutation, setSalutation] = useState("");
  const [name, setName] = useState("");
  const [occupation, setOccupation] = useState("");
  const [email, setEmail] = useState("");
  const [guests, setGuests] = useState<string[]>([""]);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  const named = guests.map((g) => g.trim()).filter(Boolean);
  const setGuest = (i: number, v: string) => setGuests((gs) => gs.map((g, j) => (j === i ? v : g)));

  function validate() {
    const e: Record<string, string> = {};
    if (!salutation) e.salutation = "Choose a title.";
    if (name.trim().length < 2) e.name = "Enter your full name.";
    if (occupation.trim().length < 2) e.occupation = "Enter your occupation.";
    if (!looksLikeEmail(email)) e.email = "Enter a valid email — your confirmation goes there.";
    guests.forEach((g, i) => { if (g.trim().length < 2) e[`guest${i}`] = "Enter this person's full name."; });
    setFieldErr(e);
    return !Object.keys(e).length;
  }

  async function submit() {
    setErr("");
    if (!validate()) return;
    setBusy(true);
    const res = await invokeFn(createClient(), "investor-register", {
      salutation, name: name.trim(), occupation: occupation.trim(), email: email.trim(), guests: named,
    });
    setBusy(false);
    const d: any = res.data;
    if (d?.reference_number && (!res.errorCode || res.errorCode === "already_registered")) {
      setDone({ reference_number: d.reference_number, emailed: !!d.emailed, existing: res.errorCode === "already_registered" });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setErr(({
      rate_limited: "Too many attempts. Wait a few minutes and try again.",
      invalid_email: "That email doesn't look right.",
      too_many_guests: `You can register up to ${MAX_GUESTS} people coming with you.`,
      guests_required: "Add at least one person coming with you.",
      invalid_guest_name: "Check the names of the people coming with you.",
    } as Record<string, string>)[res.errorCode ?? ""]
      ?? (res.transportError ? "Could not reach the server. Check your connection." : "Could not register you just now. Please try again."));
  }

  if (done) return (
    <section className="investor-card investor-done" aria-live="polite">
      <span className="investor-kicker">{done.existing ? "Already registered" : "You're registered"}</span>
      <div className="investor-ref">{done.reference_number}</div>
      {done.existing ? (
        <p>This email is already registered for the investors&apos; visit. {done.emailed ? <>We&apos;ve emailed the confirmation to <strong>{email.trim()}</strong> again.</> : null} To change your details or guest list, call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a> and quote your reference.</p>
      ) : (
        <>
          <p>Thank you, {salutation} {name.trim()}. We look forward to seeing you on {INVESTOR_DAY} at {INVESTOR_VENUE}.{done.emailed ? <> A confirmation is on its way to <strong>{email.trim()}</strong>.</> : null}</p>
          <dl className="investor-summary">
            <div><dt>Occupation</dt><dd>{occupation.trim()}</dd></div>
            <div><dt>Coming with you</dt><dd>{named.join(", ")}</dd></div>
            <div><dt>Venue</dt><dd>{INVESTOR_VENUE}</dd></div>
          </dl>
          <p className="investor-muted">We&apos;ll confirm the time by email. Need a change? Call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a>.</p>
        </>
      )}
    </section>
  );

  return (
    <form className="investor-card investor-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>
      <div className="store-field">
        <span id="inv-title">Title *</span>
        <div className="investor-salutations" role="radiogroup" aria-labelledby="inv-title">
          {SALUTATIONS.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={salutation === s} className={salutation === s ? "on" : undefined} onClick={() => setSalutation(s)}>{s}</button>
          ))}
        </div>
        {fieldErr.salutation && <small className="field-error">{fieldErr.salutation}</small>}
      </div>
      <div className="investor-grid">
        <label className="store-field"><span>Full name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} aria-invalid={!!fieldErr.name} />
          {fieldErr.name && <small className="field-error">{fieldErr.name}</small>}</label>
        <label className="store-field"><span>Occupation *</span>
          <input value={occupation} onChange={(e) => setOccupation(e.target.value)} autoComplete="organization-title" maxLength={120} placeholder="e.g. Managing Director" aria-invalid={!!fieldErr.occupation} />
          {fieldErr.occupation && <small className="field-error">{fieldErr.occupation}</small>}</label>
      </div>
      <label className="store-field"><span>Email *</span>
        <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" aria-invalid={!!fieldErr.email} />
        {fieldErr.email ? <small className="field-error">{fieldErr.email}</small> : <small className="investor-muted">We&apos;ll send your confirmation here.</small>}</label>

      <fieldset className="investor-guests">
        <legend>People coming with you * <small>({named.length})</small></legend>
        {guests.map((g, i) => (
          <div key={i} className="investor-guest-row">
            <label className="store-field"><span className="sr-only">Person {i + 1}</span>
              <input value={g} onChange={(e) => setGuest(i, e.target.value)} placeholder={`Person ${i + 1} — full name`} maxLength={120} aria-invalid={!!fieldErr[`guest${i}`]} />
              {fieldErr[`guest${i}`] && <small className="field-error">{fieldErr[`guest${i}`]}</small>}</label>
            <button type="button" className="investor-remove" aria-label={`Remove person ${i + 1}`} disabled={guests.length === 1}
              onClick={() => { setGuests((gs) => gs.filter((_, j) => j !== i)); setFieldErr({}); }}>×</button>
          </div>
        ))}
        {guests.length < MAX_GUESTS && (
          <button type="button" className="investor-add" onClick={() => setGuests((gs) => [...gs, ""])}>+ Add a person</button>
        )}
      </fieldset>

      {err && <p className="field-error" role="alert">{err}</p>}
      <button type="submit" className="store-button investor-submit" disabled={busy}>{busy ? "Registering…" : "Register"}</button>
    </form>
  );
}
