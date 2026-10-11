"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import {
  cacheTokens, drainOutbox, enqueueRedemption, getCachedTokens,
  markLocalRedeemed, outboxCount,
} from "@/lib/offline-db";

type Flash = { kind: "ok" | "bad"; text: string } | null;

export default function Scanner({ userId }: { userId: string }) {
  const supabase = createClient();
  const [flash, setFlash] = useState<Flash>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [station, setStation] = useState("gate-1");
  const [manual, setManual] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const scannerRef = useRef<any>(null);
  const busyRef = useRef(false);

  // Station label per device (persisted) — shows in redemption logs
  useEffect(() => {
    const s = localStorage.getItem("station") ?? `gate-1-${userId.slice(0, 4)}`;
    localStorage.setItem("station", s);
    setStation(s);
    setOnline(navigator.onLine);
    outboxCount().then(setPending);
    const goOnline = () => { setOnline(true); flushOutbox(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A reservation admits a named party; a ticket admits a holder we never named.
  // The door needs both facts large and immediately (FR-S7).
  const admitText = (r: any) => {
    if (r.kind !== "reservation") return "✓ ADMIT";
    const lines = ["✓ ADMIT", r.holder_name ?? ""];
    if (r.party_size > 1) lines.push(`Party of ${r.party_size}`);
    // Staff must be able to hand over exactly what was paid for.
    const pre = Array.isArray(r.preorder) ? r.preorder : [];
    if (pre.length) {
      lines.push(pre.map((p: any) => `${p.qty}x ${p.name}`).join(", "));
      if (r.amount_kes) lines.push(`PAID KSh ${Number(r.amount_kes).toLocaleString()}`);
    }
    return lines.filter(Boolean).join("\n");
  };

  const show = (kind: "ok" | "bad", text: string) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash(null), 2200);
  };

  // ---- Offline cache sync (FR-S4) ----
  async function syncCache() {
    const { data, errorCode, transportError } = await invokeFn(supabase, "sync-tokens");
    if (!data?.tokens) {
      show("bad", transportError ? "Sync failed — no connection" : `Sync failed (${errorCode ?? "error"})`);
      return;
    }
    await cacheTokens(data.tokens, "live");
    const active = data.tokens.filter((t: any) => t.status === "active").length;
    show("ok", `Synced ${data.tokens.length} tickets (${active} unused)`);
  }

  // ---- Outbox flush (FR-S5) ----
  const flushOutbox = useCallback(async () => {
    const items = await drainOutbox();
    if (!items.length) { setPending(0); return; }
    const { data } = await invokeFn(supabase, "redeem", {
      redemptions: items.map((i) => ({ ...i, station, scanned_at: i.scannedAt })),
    });
    // A transport failure must not swallow the queue — put every item back.
    if (!data?.results) {
      await enqueueRedemption(items);
      setPending(await outboxCount());
      return;
    }
    const results: any[] = data.results;
    const retry = items.filter((_, i) => results[i]?.result === "error");
    if (retry.length) await enqueueRedemption(retry);
    setPending(await outboxCount());

    // Cache staleness reconciliation (SRS §5.4): a ticket admitted offline that the
    // server rejects is something staff must hear about, not a silent discrepancy.
    const rejected = results.filter(
      (r) => r.result === "already_redeemed" || r.result === "refunded" || r.result === "not_found"
    ).length;
    if (rejected) show("bad", `${rejected} queued scan(s) rejected on sync — check with staff`);
    else if (results.some((r) => r.result === "admitted")) show("ok", "Offline scans synced");
  }, [station, supabase]);

  // ---- Core scan handling ----
  async function handleToken(raw: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const token = raw.replace(/.*\/t\//, "").trim(); // accept full URL or bare token
      if (!/^[a-f0-9]{32}$/.test(token)) { show("bad", "Invalid code"); return; }

      if (navigator.onLine) {
        await flushOutbox();
        const { data } = await invokeFn(supabase, "redeem", { token, station });
        const r = data?.results?.[0];
        if (!r || r.result === "error") show("bad", "Server error — try again");
        else if (r.result === "admitted") show("ok", admitText(r));
        else if (r.result === "already_redeemed")
          show("bad", `✗ Already admitted\n${r.holder_name ? r.holder_name + "\n" : ""}${new Date(r.first_scanned_at).toLocaleTimeString()} @ ${r.station}`);
        else if (r.result === "refunded") show("bad", "✗ Refunded ticket");
        else if (r.result === "cancelled") show("bad", `✗ Cancelled\n${r.holder_name ?? ""}`);
        else if (r.result === "unpaid") show("bad", `✗ Preorder unpaid\n${r.holder_name ?? ""}`);
        else if (r.result === "event_closed") show("bad", "✗ Event is closed");
        else show("bad", "✗ Pass not found");
      } else {
        // Offline path: validate against cache, queue redemption
        const cache = await getCachedTokens();
        if (!cache) { show("bad", "Offline — no cache. Sync while online first."); return; }
        const t = cache.tokens.find((x) => x.token === token);
        if (!t) show("bad", "✗ Unknown pass (not in cache)");
        else if (t.paid === false) show("bad", `✗ Preorder unpaid\n${t.holder_name ?? ""}`);
        else if (t.status === "refunded") show("bad", "✗ Refunded ticket");
        else if (t.status !== "active") {
          const at = t.redeemed_at ? new Date(t.redeemed_at).toLocaleTimeString() : "earlier";
          show("bad", `✗ Already redeemed\n${at}`);
        } else {
          const scannedAt = new Date().toISOString();
          await enqueueRedemption({ token, station, scannedAt });
          await markLocalRedeemed(token, scannedAt);
          setPending(await outboxCount());
          show("ok", `✓ ADMIT${t.holder_name ? `\n${t.holder_name}` : ""}${
            t.party_size && t.party_size > 1 ? `\nParty of ${t.party_size}` : ""
          }\n(offline — will sync)`);
        }
      }
    } finally { busyRef.current = false; }
  }

  // ---- Camera (html5-qrcode) ----
  async function toggleCamera() {
    if (cameraOn) {
      await scannerRef.current?.stop().catch(() => {});
      scannerRef.current = null;
      setCameraOn(false);
      return;
    }
    const { Html5Qrcode } = await import("html5-qrcode");
    const el = document.getElementById("qr-reader");
    if (!el) return;
    const scanner = new Html5Qrcode("qr-reader", { verbose: false });
    await scanner.start(
      { facingMode: "environment" },
      { fps: 8, qrbox: { width: 240, height: 240 } },
      (text: string) => handleToken(text),
      () => {}
    );
    scannerRef.current = scanner;
    setCameraOn(true);
  }

  return (
    <div>
      {flash && <div className={`flash ${flash.kind}`}>{flash.text}</div>}
      <div className="row" style={{ margin: "12px 0" }}>
        <h1 style={{ margin: 0 }}>Gate Scanner</h1>
        <span className={`pill ${online ? "ok" : "danger"}`}>{online ? "ONLINE" : "OFFLINE"}{pending > 0 ? ` · ${pending} queued` : ""}</span>
      </div>

      <div id="qr-reader" style={{ width: "100%", minHeight: cameraOn ? undefined : 0 }} />
      <button onClick={toggleCamera} style={{ width: "100%", margin: "8px 0" }}>
        {cameraOn ? "Stop camera" : "Start camera"}
      </button>

      <div className="card">
        <div className="row">
          <input placeholder="Or enter ticket code manually" value={manual}
            onChange={(e) => setManual(e.target.value)} style={{ margin: 0 }} />
          <button onClick={() => { handleToken(manual); setManual(""); }} disabled={!manual}>Check</button>
        </div>
      </div>

      <div className="row">
        <span className="small">Station: {station}</span>
        <button onClick={syncCache} disabled={!online}>Sync cache</button>
      </div>
      <p className="small">Sync cache before gates open. Offline admissions queue and sync automatically.</p>
    </div>
  );
}
