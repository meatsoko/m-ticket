"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Icon from "@/components/Icon";
import { formatKes } from "@/lib/celebrations";
import type { CelebrationOccasion, CelebrationPackage, CelebrationAddon } from "@/lib/types";

type Step = "details" | "package" | "addons" | "confirm";

export default function CelebrationWizard({ 
  occasions, packages, addons, initialOccasionId 
}: { 
  occasions: CelebrationOccasion[]; 
  packages: CelebrationPackage[]; 
  addons: CelebrationAddon[];
  initialOccasionId: string;
}) {
  const [step, setStep] = useState<Step>("details");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Form State
  const [occasionId, setOccasionId] = useState(initialOccasionId);
  const [celebratedName, setCelebratedName] = useState("");
  const [celebrationDate, setCelebrationDate] = useState("");
  const [guestCount, setGuestCount] = useState(10);
  const [styleVibe, setStyleVibe] = useState("");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [packageId, setPackageId] = useState<string | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<Record<string, number>>({});

  const selectedPackage = useMemo(() => packages.find(p => p.id === packageId), [packages, packageId]);
  const currentOccasion = useMemo(() => occasions.find(o => o.id === occasionId), [occasions, occasionId]);

  const totalKes = useMemo(() => {
    let total = selectedPackage?.base_price_kes ?? 0;
    Object.entries(selectedAddons).forEach(([id, qty]) => {
      const addon = addons.find(a => a.id === id);
      if (addon) total += Number(addon.price_kes) * qty;
    });
    return total;
  }, [selectedPackage, selectedAddons, addons]);

  const depositKes = totalKes * 0.25;

  const handleNext = () => {
    if (step === "details") setStep("package");
    else if (step === "package") setStep("addons");
    else if (step === "addons") setStep("confirm");
  };

  const handleBack = () => {
    if (step === "package") setStep("details");
    else if (step === "addons") setStep("package");
    else if (step === "confirm") setStep("addons");
  };

  const toggleAddon = (id: string) => {
    setSelectedAddons(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = 1;
      return next;
    });
  };

  const updateAddonQty = (id: string, delta: number) => {
    setSelectedAddons(prev => {
      const next = { ...prev };
      next[id] = Math.max(1, (next[id] || 1) + delta);
      return next;
    });
  };

  const handleSubmit = async () => {
    setLoading(true);
    // Implementation: Save to DB via edge function or server action
    // For now, redirecting to a success placeholder or the tracker
    setTimeout(() => {
      setLoading(false);
      router.push("/celebrations/success");
    }, 1500);
  };

  return (
    <div className="wizard-container">
      <div className="wizard-steps">
        <div className={`wizard-step ${step === "details" ? "active" : ""}`}>1. Details</div>
        <div className={`wizard-step ${step === "package" ? "active" : ""}`}>2. Package</div>
        <div className={`wizard-step ${step === "addons" ? "active" : ""}`}>3. Add-ons</div>
        <div className={`wizard-step ${step === "confirm" ? "active" : ""}`}>4. Confirm</div>
      </div>

      <div className="wizard-content card">
        {step === "details" && (
          <div className="stack">
            <h2>Let&apos;s start with the basics</h2>
            <div className="grid">
              <div className="input-group">
                <label>Occasion</label>
                <select value={occasionId} onChange={e => setOccasionId(e.target.value)}>
                  {occasions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div className="input-group">
                <label>Who are we celebrating?</label>
                <input type="text" placeholder="Name" value={celebratedName} onChange={e => setCelebratedName(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Celebration Date</label>
                <input type="date" value={celebrationDate} onChange={e => setCelebrationDate(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Number of Guests</label>
                <input type="number" min="1" value={guestCount} onChange={e => setGuestCount(Number(e.target.value))} />
              </div>
            </div>
            <div className="input-group">
              <label>Style / Vibe</label>
              <input type="text" placeholder="e.g. Garden Party, Elegant Dinner, BBQ Chill" value={styleVibe} onChange={e => setStyleVibe(e.target.value)} />
            </div>
            <div className="grid">
              <div className="input-group">
                <label>Your Phone (M-Pesa)</label>
                <input type="tel" placeholder="07XXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Your Email</label>
                <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {step === "package" && (
          <div className="stack">
            <h2>Choose your main feast</h2>
            <div className="package-grid">
              {packages.map(p => (
                <button key={p.id} className={`package-card ${packageId === p.id ? "selected" : ""}`} onClick={() => setPackageId(p.id)}>
                  <h3>{p.name}</h3>
                  <p className="small">{p.description}</p>
                  <strong className="price">{formatKes(p.base_price_kes)}</strong>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "addons" && (
          <div className="stack">
            <h2>Add some extra magic</h2>
            <div className="addon-list">
              {addons.map(a => (
                <div key={a.id} className={`addon-row ${selectedAddons[a.id] ? "selected" : ""}`}>
                  <div className="addon-info">
                    <strong>{a.name}</strong>
                    <span>{formatKes(a.price_kes)}</span>
                  </div>
                  <div className="addon-actions">
                    {selectedAddons[a.id] ? (
                      <div className="qty-stepper">
                        <button onClick={() => updateAddonQty(a.id, -1)}>−</button>
                        <span>{selectedAddons[a.id]}</span>
                        <button onClick={() => updateAddonQty(a.id, 1)}>+</button>
                      </div>
                    ) : (
                      <button className="btn-add" onClick={() => toggleAddon(a.id)}>Add +</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="stack">
            <h2>Review & Secure</h2>
            <div className="summary-box">
              <div className="summary-row"><span>Occasion</span><strong>{currentOccasion?.name}</strong></div>
              <div className="summary-row"><span>Celebrating</span><strong>{celebratedName}</strong></div>
              <div className="summary-row"><span>Date</span><strong>{celebrationDate}</strong></div>
              <div className="summary-row"><span>Main Package</span><strong>{selectedPackage?.name}</strong></div>
              <hr />
              <div className="summary-row total"><span>Total Budget</span><strong>{formatKes(totalKes)}</strong></div>
              <div className="summary-row deposit"><span>Min. Deposit (25%)</span><strong>{formatKes(depositKes)}</strong></div>
            </div>
            <p className="small text-center opacity-70">Securing your date requires an initial deposit. You can clear the remaining {formatKes(totalKes - depositKes)} via Lipa Mdogo Mdogo installments.</p>
          </div>
        )}

        <div className="wizard-footer">
          {step !== "details" && <button className="btn-ghost" onClick={handleBack}>Back</button>}
          <div className="flex-grow" />
          {step === "confirm" ? (
            <button className="btn-primary" onClick={handleSubmit} disabled={loading}>{loading ? "Processing..." : `Pay Deposit ${formatKes(depositKes)}`}</button>
          ) : (
            <button className="btn-primary" onClick={handleNext} disabled={step === "package" && !packageId}>Continue <span>→</span></button>
          )}
        </div>
      </div>

      <style jsx>{`
        .wizard-container { max-width: 800px; margin: 2rem auto 6rem; }
        .wizard-steps { display: flex; gap: 1rem; margin-bottom: 2rem; justify-content: center; }
        .wizard-step { font-size: 0.85rem; font-weight: 700; opacity: 0.3; padding: 4px 12px; border-radius: 20px; background: rgba(0,0,0,0.05); }
        .wizard-step.active { opacity: 1; background: var(--brand-red, #c62a33); color: white; }

        .wizard-content { padding: 3rem; }
        h2 { font-size: 1.75rem; margin-bottom: 2rem; text-align: center; }
        
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        .input-group { margin-bottom: 1.5rem; }
        .input-group label { display: block; font-size: 0.85rem; font-weight: 700; margin-bottom: 8px; opacity: 0.6; }
        .input-group input, .input-group select { width: 100%; padding: 12px; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; font-size: 1rem; }

        .package-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .package-card { padding: 1.5rem; border: 2px solid rgba(0,0,0,0.05); border-radius: 12px; background: white; text-align: left; cursor: pointer; transition: all 0.2s; }
        .package-card.selected { border-color: var(--brand-red, #c62a33); background: rgba(198, 42, 51, 0.02); }
        .package-card h3 { font-size: 1rem; margin-bottom: 8px; }
        .package-card .price { display: block; margin-top: 1rem; color: var(--brand-red, #c62a33); }

        .addon-list { border-top: 1px solid rgba(0,0,0,0.05); }
        .addon-row { display: flex; align-items: center; padding: 1.25rem 0; border-bottom: 1px solid rgba(0,0,0,0.05); }
        .addon-info { flex: 1; display: flex; flex-direction: column; }
        .addon-info span { opacity: 0.5; font-size: 0.9rem; }
        
        .qty-stepper { display: flex; align-items: center; gap: 12px; background: #f5f5f5; padding: 4px 12px; border-radius: 8px; }
        .qty-stepper button { border: none; background: none; font-size: 1.25rem; cursor: pointer; padding: 0 4px; }
        .qty-stepper span { font-weight: 700; min-width: 20px; text-align: center; }
        
        .btn-add { background: none; border: 1px solid var(--brand-red, #c62a33); color: var(--brand-red, #c62a33); padding: 6px 16px; border-radius: 6px; font-size: 0.85rem; font-weight: 700; cursor: pointer; }

        .summary-box { background: #fafafa; padding: 2rem; border-radius: 12px; margin-bottom: 1.5rem; }
        .summary-row { display: flex; justify-content: space-between; margin-bottom: 1rem; font-size: 0.95rem; }
        .summary-row span { opacity: 0.6; }
        .summary-row.total { font-size: 1.25rem; margin-top: 1rem; }
        .summary-row.deposit { color: var(--brand-green, #1f6b3a); font-weight: 700; }

        .wizard-footer { display: flex; align-items: center; margin-top: 3rem; padding-top: 2rem; border-top: 1px solid rgba(0,0,0,0.05); }
        .btn-primary { background: var(--brand-red, #c62a33); color: white; border: none; padding: 14px 32px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 8px; }
        .btn-ghost { background: none; border: none; color: black; opacity: 0.5; font-weight: 700; cursor: pointer; }

        @media (max-width: 600px) {
          .wizard-content { padding: 1.5rem; }
          .grid, .package-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
