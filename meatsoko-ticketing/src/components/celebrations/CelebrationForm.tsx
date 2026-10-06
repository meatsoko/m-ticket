"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { looksLikeEmail, normalizePhone, PHONE_HINT } from "@/lib/phone";
import { BUDGETS, MIN_NOTICE_DAYS, OCCASIONS, SETTINGS } from "@/lib/celebrations";

// Occasion booking -> celebration-request (create). On success the guest lands
// on their private page (/celebrations/<token>), which is also emailed.

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(d);

export default function CelebrationForm({ initialOccasion }: { initialOccasion?: string }) {
  const router = useRouter();
  const [occasion, setOccasion] = useState(OCCASIONS.some((o) => o.value === initialOccasion) ? initialOccasion! : "");
  const [other, setOther] = useState("");
  const [honoree, setHonoree] = useState("");
  const [date, setDate] = useState("");
  const [guests, setGuests] = useState("");
  const [setting, setSetting] = useState("");
  const [area, setArea] = useState("");
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const minDate = useMemo(() => ymd(new Date(Date.now() + MIN_NOTICE_DAYS * 86_400_000)), []);

  function validate() {
    const e: Record<string, string> = {};
    if (!occasion) e.occasion = "Choose the occasion.";
    if (occasion === "other" && other.trim().length < 2) e.other = "Tell us what you're celebrating.";
    if (!date) e.date = "Choose the date.";
    else if (date < minDate) e.date = `We need at least ${MIN_NOTICE_DAYS} days' notice.`;
    const g = Number(guests);
    if (!Number.isInteger(g) || g < 1 || g > 2000) e.guests = "How many people, roughly? (1–2000)";
    if (!setting) e.setting = "Choose where it will be.";
    if (setting === "own_venue" && area.trim().length < 2) e.area = "Tell us the area or venue.";
    if (name.trim().length < 2) e.name = "Enter your name.";
    if (!normalizePhone(phone)) e.phone = PHONE_HINT;
    if (!looksLikeEmail(email)) e.email = "Enter a valid email — your confirmation goes there.";
    setFieldErr(e);
    if (Object.keys(e).length) document.querySelector(`[data-field="${Object.keys(e)[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    return !Object.keys(e).length;
  }

  async function submit() {
    setErr("");
    if (!validate()) return;
    setBusy(true);
    const res = await invokeFn(createClient(), "celebration-request", {
      action: "create", occasion, occasion_other: occasion === "other" ? other.trim() : null, honoree: honoree.trim() || null,
      event_date: date, guests: Number(guests), setting, area: area.trim() || null, budget: budget || null,
      notes: notes.trim() || null, name: name.trim(), phone: phone.trim(), email: email.trim(),
    });
    const d: any = res.data;
    if (!res.errorCode && d?.token) { router.push(`/celebrations/${d.token}?sent=${d.emailed ? 1 : 0}`); return; }
    setBusy(false);
    setErr(({
      rate_limited: "Too many requests from here. Wait a few minutes and try again.",
      date_too_soon: `We need at least ${MIN_NOTICE_DAYS} days' notice — for anything sooner, call us.`,
      date_too_far: "That's a little far ahead — choose a date within the next 18 months.",
      invalid_phone: PHONE_HINT,
      invalid_email: "That email doesn't look right.",
      area_required: "Tell us the area or venue.",
    } as Record<string, string>)[res.errorCode ?? ""]
      ?? (res.transportError ? "Couldn't reach us — check your connection and try again." : "Something went wrong. Please try again."));
  }

  const err1 = (k: string) => fieldErr[k] && <small className="field-error">{fieldErr[k]}</small>;
  const pills = (list: readonly { value: string; label: string }[], value: string, set: (v: string) => void, labelId: string, optional = false) => (
    <div className="cel-pills" role="radiogroup" aria-labelledby={labelId}>
      {list.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : undefined}
          onClick={() => set(optional && value === o.value ? "" : o.value)}>{o.label}</button>
      ))}
    </div>
  );

  return (
    <form className="cel-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>
      <fieldset className="cel-step" data-field="occasion">
        <legend><span>1</span> What are you celebrating?</legend>
        <div className="cel-occasions" role="radiogroup" aria-label="Occasion">
          {OCCASIONS.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={occasion === o.value} className={occasion === o.value ? "on" : undefined} onClick={() => setOccasion(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        {err1("occasion")}
        {occasion === "other" && (
          <label className="store-field" data-field="other"><span>What&apos;s the occasion? *</span>
            <input value={other} onChange={(e) => setOther(e.target.value)} maxLength={60} placeholder="e.g. Retirement party" />{err1("other")}</label>
        )}
        <label className="store-field"><span>Who&apos;s it for? <em>(optional)</em></span>
          <input value={honoree} onChange={(e) => setHonoree(e.target.value)} maxLength={80} placeholder="e.g. Grandma Wanjiku's 70th" /></label>
      </fieldset>

      <fieldset className="cel-step">
        <legend><span>2</span> When, how many, where?</legend>
        <div className="cel-grid">
          <label className="store-field" data-field="date"><span>Date *</span>
            <input type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!fieldErr.date} />{err1("date")}</label>
          <label className="store-field" data-field="guests"><span>Guests *</span>
            <input type="number" inputMode="numeric" min={1} max={2000} value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="e.g. 40" aria-invalid={!!fieldErr.guests} />{err1("guests")}</label>
        </div>
        <div className="store-field" data-field="setting"><span id="cel-where">Where *</span>
          {pills(SETTINGS, setting, setSetting, "cel-where")}{err1("setting")}</div>
        <label className="store-field" data-field="area"><span>Area or venue {setting === "own_venue" ? "*" : <em>(optional)</em>}</span>
          <input value={area} onChange={(e) => setArea(e.target.value)} maxLength={120} placeholder="e.g. Ruiru, Kiambu Road" aria-invalid={!!fieldErr.area} />{err1("area")}</label>
        <div className="store-field"><span id="cel-budget">Your budget <em>(optional — helps us suggest the right spread)</em></span>
          {pills(BUDGETS, budget, setBudget, "cel-budget", true)}</div>
        <label className="store-field"><span>Anything else? <em>(optional)</em></span>
          <textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Favourite cuts, a theme, dietary needs, a surprise…" /></label>
      </fieldset>

      <fieldset className="cel-step">
        <legend><span>3</span> Your details</legend>
        <label className="store-field" data-field="name"><span>Your name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} aria-invalid={!!fieldErr.name} />{err1("name")}</label>
        <div className="cel-grid">
          <label className="store-field" data-field="phone"><span>Phone *</span>
            <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="07XX XXX XXX" aria-invalid={!!fieldErr.phone} />{err1("phone")}</label>
          <label className="store-field" data-field="email"><span>Email *</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={!!fieldErr.email} />{err1("email")}</label>
        </div>
      </fieldset>

      {err && <p className="field-error" role="alert">{err}</p>}
      <button type="submit" className="store-button cel-submit" disabled={busy}>{busy ? "Sending…" : "Send my request"}</button>
      <p className="cel-muted">No payment now. Our team calls you to plan the food and the setup and sends you a quote.</p>
    </form>
  );
}
