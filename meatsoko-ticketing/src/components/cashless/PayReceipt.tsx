"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import SaleReceipt, { type ReceiptData } from "@/components/cashless/SaleReceipt";
import ReceiptPrint from "@/components/cashless/ReceiptPrint";

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
          <SaleReceipt r={data} />
          <ReceiptPrint />
        </>
      )}
    </div>
  );
}
