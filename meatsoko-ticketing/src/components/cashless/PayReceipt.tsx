"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import SaleReceipt, { type ReceiptData } from "@/components/cashless/SaleReceipt";

export default function PayReceipt({ token }: { token: string }) {
  const [data, setData] = useState<(ReceiptData & { status: string }) | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    invokeFn<ReceiptData & { status: string }>(createClient(), "vendor-pay", { action: "status", status_token: token }).then((r) => {
      if (r.data?.status) setData(r.data);
      else setError(r.transportError ? "No connection. Check your internet and reload." : "This receipt link isn't valid.");
    });
  }, [token]);
  return (
    <div className="receipt-page">
      {error ? <p>{error}</p> : !data ? <p>Loading…</p> : data.status !== "success" ? (
        <p>{data.status === "pending" ? "This payment is still waiting for M-Pesa. Refresh in a moment." : "This payment wasn't completed, so there is no receipt."}</p>
      ) : (
        <>
          <ReceiptPaper />
          <SaleReceipt r={data} />
          <PrintBar />
        </>
      )}
    </div>
  );
}

/** Receipt paper size, for the page that renders it only (not site-wide). */
export function ReceiptPaper() {
  return <style>{"@media print { @page { size: 80mm auto; margin: 3mm; } }"}</style>;
}

export function PrintBar() {
  return (
    <div className="receipt-actions">
      <button type="button" onClick={() => window.print()}>Print receipt</button>
      <span>Receipt printer: paper 80 mm, scale 100%, headers and footers off.</span>
    </div>
  );
}
