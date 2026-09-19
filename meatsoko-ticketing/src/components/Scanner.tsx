"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

  const show = (kind: "ok" | "bad", text: string) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash(null), 2200);
  };

  // ---- Offline cache sync (FR-S4) ----
  async function syncCache() {
    const { data, error } = await supabase.functions.invoke("sync-tokens");
    if (error || !data?.tokens) { show("bad", "Sync failed"); return; }
    await cacheTokens(data.tokens, "live");
    show("ok", `Synced ${data.tokens.length} tickets`);
  }

  // ---- Outbox flush (FR-S5) ----
  const flushOutbox = useCallback(async () => {
    const items = await drainOutbox();
    if (!items.length) { setPending(0); return; }
    const { data } = await supabase.functions.invoke("redeem", {
      body: { redemptions: items.map((i) => ({ ...i, station })) },
    });
    const failed = (data?.results ?? []).filter((r: any) => r.result === "error");
    if (failed.length) await enqueueRedemption(items.filter((_, i) => data.results[i]?.result === "error"));
    setPending(await outboxCount());
    if ((data?.results ?? []).some((r: any) => r.result === "admitted")) show("ok", "Offline scans synced");
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
        const { data } = await supabase.functions.invoke("redeem", { body: { token, station } });
        const r = data?.results?.[0];
        if (!r || r.result === "error") show("bad", "Server error — try again");
        else if (r.result === "admitted") show("ok", "✓ ADMIT");
        else if (r.result === "already_redeemed")
          show("bad", `✗ Already redeemed\n${new Date(r.first_scanned_at).toLocaleTimeString()} @ ${r.station}`);
        else if (r.result === "refunded") show("bad", "✗ Refunded ticket");
        else show("bad", "✗ Ticket not found");
      } else {
        // Offline path: validate against cache, queue redemption
        const cache = await getCachedTokens();
        if (!cache) { show("bad", "Offline — no cache. Sync while online first."); return; }
        const t = cache.tokens.find((x) => x.token === token);
        if (!t) show("bad", "✗ Not in cache");
        else if (t.status !== "active") show("bad", "✗ Already redeemed (cached)");
        else {
          await enqueueRedemption({ token, station, scannedAt: new Date().toISOString() });
          await markLocalRedeemed(token);
          setPending(await outboxCount());
          show("ok", "✓ ADMIT (offline — will sync)");
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
        <span className={`badge ${online ? "ok" : "bad"}`}>{online ? "ONLINE" : "OFFLINE"}{pending > 0 ? ` · ${pending} queued` : ""}</span>
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
