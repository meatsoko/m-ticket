"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { localWhen, nairobiDate, nairobiTime, visitorZone } from "@/lib/event-time";
import { SUPPORT } from "@/lib/support";

// The online attendee's private page. online-access validates the code and
// decides the state from the event's own timestamps; the stream ID only comes
// back while the event is live.

type Access = {
  state: "before" | "live" | "ended"; name: string; registration_number: string;
  event: { name: string; tagline: string | null; starts_at: string; ends_at: string | null; contact_phone: string | null };
  stream_youtube_id: string | null; server_time: string;
};

export default function WatchView({ code }: { code: string }) {
  const [a, setA] = useState<Access | null>(null);
  const [err, setErr] = useState<"invalid" | "revoked" | "offline" | null>(null);
  const [skew, setSkew] = useState(0);              // server clock minus device clock
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await invokeFn(createClient(), "online-access", { code });
    if (res.transportError) { setErr("offline"); return; }
    if (res.errorCode === "revoked") { setErr("revoked"); return; }
    if (!res.data || res.errorCode) { setErr("invalid"); return; }
    setErr(null);
    setA(res.data as Access);
    setSkew(new Date((res.data as Access).server_time).getTime() - Date.now());
  }, [code]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);

  // Countdown runs on the real event timestamp (corrected for a wrong device clock).
  const startMs = a ? new Date(a.event.starts_at).getTime() - 15 * 60 * 1000 : 0;
  const endMs = a ? new Date(a.event.ends_at ?? a.event.starts_at).getTime() : 0;
  const serverNow = now + skew;
  // Ask again exactly when the state should change (doors open / event ends).
  useEffect(() => {
    if (!a) return;
    const due = a.state === "before" ? startMs : a.state === "live" ? endMs : null;
    if (due == null) return;
    const ms = Math.max(1000, due - serverNow + 1500);
    const t = window.setTimeout(load, Math.min(ms, 2 ** 31 - 1));
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.state, startMs, endMs]);

  if (err === "invalid") return <Note pill="Not found" tone="danger" title="This watch link isn't valid" body="Check the link in your registration email, or register again from the event page." />;
  if (err === "revoked") return <Note pill="Access removed" tone="danger" title="This watch link has been turned off" body={<>If you think this is a mistake, call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a>.</>} />;
  if (err === "offline") return <Note pill="Offline" tone="warn" title="Couldn't load your watch page" body={<>Check your connection. <button type="button" className="btn-ghost" onClick={load}>Try again</button></>} />;
  if (!a) return <div className="empty"><span className="small">Loading…</span></div>;

  const tz = visitorZone(a.event.starts_at);
  const when = (
    <p className="small watch-when">
      {nairobiDate(a.event.starts_at)} · {nairobiTime(a.event.starts_at)} <strong>Nairobi time (EAT)</strong>
      {tz && <><br />That&apos;s {localWhen(a.event.starts_at, tz)}</>}
    </p>
  );

  if (a.state === "ended") {
    return <Note pill="Event ended" tone="" title={`${a.event.name} has ended`} body="Thanks for watching online. Look out for the next MeatSoko event." />;
  }

  if (a.state === "live") {
    return (
      <div className="stack watch-live">
        <div className="watch-head"><span className="pill ok">● Live</span><h1>{a.event.name}</h1></div>
        {a.stream_youtube_id ? (
          <div className="watch-player">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.stream_youtube_id)}?autoplay=1&rel=0&modestbranding=1`}
              title={`${a.event.name} live stream`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center" }}><strong>The stream is about to start.</strong><p className="small">Stay on this page — it will appear here. <button type="button" className="btn-ghost" onClick={load}>Refresh</button></p></div>
        )}
        <div className="card">
          {a.event.tagline && <p className="small">{a.event.tagline}</p>}
          {when}
          <p className="small">Watching as <strong>{a.name}</strong> · {a.registration_number}. This link is personal — please don&apos;t share it.</p>
        </div>
      </div>
    );
  }

  // before
  const left = Math.max(0, startMs - serverNow);
  const parts = [Math.floor(left / 864e5), Math.floor(left / 36e5) % 24, Math.floor(left / 6e4) % 60, Math.floor(left / 1e3) % 60];
  return (
    <div className="card watch-before" style={{ alignItems: "center", textAlign: "center" }}>
      <span className="pill ember">Online attendance</span>
      <h1>{a.event.name}</h1>
      {a.event.tagline && <p className="small">{a.event.tagline}</p>}
      {when}
      <div className="watch-countdown" aria-label="Time until the stream opens">
        {["Days", "Hours", "Min", "Sec"].map((l, i) => <span key={l}><b>{String(parts[i]).padStart(2, "0")}</b><small>{l}</small></span>)}
      </div>
      <p className="small">The live stream appears right here when the event starts — keep this page or the link in your email.</p>
      <p className="small">Registered as <strong>{a.name}</strong> · {a.registration_number}</p>
    </div>
  );
}

function Note({ pill, tone, title, body }: { pill: string; tone: string; title: string; body: React.ReactNode }) {
  return (
    <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
      <span className={`pill ${tone}`}>{pill}</span>
      <h2>{title}</h2>
      <p className="small">{body}</p>
    </div>
  );
}
