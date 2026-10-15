import QrImage from "@/components/QrImage";

// One A4 booth poster (migration 20261015100000 adds the vendor's phone ending and
// the line for customers without a smartphone). The QR holds only the pay-page URL.
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://event.meatsokogroup.com").replace(/\/+$/, "");

export default function BoothPoster({ vendorName, vendorPhone, eventName, code }: { vendorName: string; vendorPhone: string | null; eventName: string; code: string }) {
  return (
    <section className="cl-poster">
      <img className="cl-poster-logo" src="/images/brand/meatsoko-logo.png" alt="MeatSoko" width={720} height={325} />
      <p className="cl-poster-event">{eventName}</p>
      <h2 className="cl-poster-vendor">{vendorName}</h2>
      {vendorPhone && <p className="cl-poster-small">Vendor phone ends {vendorPhone.slice(-3)}</p>}
      <QrImage value={`${APP_URL}/pay/${code}`} size={420} />
      <p className="cl-poster-cta">Scan to pay with M-Pesa</p>
      <p className="cl-poster-alt">No smartphone? Ask us to send an M-Pesa prompt to your phone.</p>
      <p className="cl-poster-small">Paid to MeatSoko&apos;s collection account for {vendorName}. Check the vendor name on your phone before you pay. Never share your PIN.</p>
      <p className="cl-poster-url">{APP_URL.replace(/^https?:\/\//, "")}/pay/{code}</p>
    </section>
  );
}
