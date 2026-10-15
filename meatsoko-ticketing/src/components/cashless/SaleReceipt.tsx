// One cashless sale as a receipt: on screen, and on 80 mm receipt paper or A4
// (print CSS in globals.css, "Cashless receipts"). Shown only for a sale the
// server says is paid; the M-Pesa SMS stays the payer's official proof.
export type ReceiptData = {
  vendor_name: string; vendor_phone_end?: string | null; event_name: string; venue?: string | null;
  amount_kes: number; reference: string; mpesa_receipt: string | null; paid_at: string | null; channel?: string | null;
};

const kes = (n: number) => `KSh ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

export default function SaleReceipt({ r }: { r: ReceiptData }) {
  return (
    <section className="sale-receipt" aria-label="Payment receipt">
      <img className="sale-receipt-logo" src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} />
      <p className="sale-receipt-event">{r.event_name}{r.venue ? ` · ${r.venue}` : ""}</p>
      <h1 className="sale-receipt-vendor">{r.vendor_name}</h1>
      {r.vendor_phone_end && <p className="sale-receipt-small">Vendor phone ends {r.vendor_phone_end}</p>}
      <p className="sale-receipt-amount">{kes(r.amount_kes)}</p>
      <p className="sale-receipt-paid">PAID · M-Pesa</p>
      <dl className="sale-receipt-facts">
        <div><dt>Receipt no.</dt><dd>{r.reference}</dd></div>
        {r.mpesa_receipt && <div><dt>M-Pesa code</dt><dd>{r.mpesa_receipt}</dd></div>}
        <div><dt>Date</dt><dd>{when(r.paid_at)}</dd></div>
      </dl>
      <p className="sale-receipt-small">Paid to MeatSoko&apos;s collection account for {r.vendor_name}. Keep your M-Pesa message as proof of payment.</p>
      <p className="sale-receipt-thanks">Thank you</p>
    </section>
  );
}
