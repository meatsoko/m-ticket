"use client";

import { useState } from "react";
import { formatKes, calculateProgress } from "@/lib/celebrations";
import type { Celebration } from "@/lib/types";

export default function CelebrationTracker({ celebration }: { celebration: Celebration }) {
  const progress = calculateProgress(celebration.paid_kes, celebration.total_kes);
  const remaining = celebration.total_kes - celebration.paid_kes;
  const isFullyPaid = remaining <= 0;

  return (
    <div className="tracker-container">
      <div className="tracker-header">
        <span className="pill gray">{celebration.celebration_number}</span>
        <h1>{celebration.occasion?.name}: {celebration.celebrated_name}</h1>
        <p className="large">{new Date(celebration.celebration_date).toLocaleDateString("en-KE", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      <div className="grid">
        <div className="stack">
          <div className="card status-card">
            <h2>Lipa Mdogo Mdogo</h2>
            <div className="progress-section">
              <div className="progress-labels">
                <span>{formatKes(celebration.paid_kes)} paid</span>
                <span>Goal: {formatKes(celebration.total_kes)}</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-footer">
                <strong>{progress}% Complete</strong>
                {isFullyPaid ? <span className="paid-tag">FULLY PAID</span> : <span>{formatKes(remaining)} remaining</span>}
              </div>
            </div>
            
            {!isFullyPaid && (
              <button className="btn-pay">Pay an Installment <span>→</span></button>
            )}
          </div>

          <div className="card">
            <h3>Payment History</h3>
            <div className="payment-list">
              {celebration.payments?.length ? celebration.payments.map((p) => (
                <div key={p.id} className="payment-row">
                  <div className="payment-info">
                    <strong>{formatKes(p.amount_kes)}</strong>
                    <span className="small">{new Date(p.paid_at).toLocaleDateString()} · {p.channel.toUpperCase()}</span>
                  </div>
                  <span className="ref small">{p.reference}</span>
                </div>
              )) : <p className="small opacity-50">No payments recorded yet.</p>}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>Booking Details</h3>
            <div className="detail-list">
              <div className="detail-row"><span>Occasion</span><strong>{celebration.occasion?.name}</strong></div>
              <div className="detail-row"><span>Package</span><strong>{celebration.package?.name}</strong></div>
              <div className="detail-row"><span>Guests</span><strong>{celebration.guest_count}</strong></div>
              <div className="detail-row"><span>Style</span><strong>{celebration.style_vibe || "Standard"}</strong></div>
              <hr />
              <div className="detail-row"><span>Status</span><span className={`badge status-${celebration.status}`}>{celebration.status.toUpperCase()}</span></div>
              <div className="detail-row"><span>Fulfilment</span><span className={`badge status-${celebration.fulfilment_status}`}>{celebration.fulfilment_status.toUpperCase()}</span></div>
            </div>
          </div>

          <div className="card">
            <h3>Celebration Add-ons</h3>
            <div className="addon-list">
              {celebration.addons?.length ? celebration.addons.map((a) => (
                <div key={a.id} className="addon-row">
                  <span>{a.qty}x {a.name}</span>
                  <strong>{formatKes(a.price_at_booking * a.qty)}</strong>
                </div>
              )) : <p className="small opacity-50">No add-ons selected.</p>}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .tracker-container { max-width: 1000px; margin: 2rem auto 6rem; }
        .tracker-header { margin-bottom: 3rem; text-align: center; }
        .tracker-header h1 { font-size: 2.5rem; margin: 1rem 0 0.5rem; }
        
        .grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 2rem; }
        .card { padding: 2rem; background: white; border: 1px solid rgba(0,0,0,0.08); border-radius: 16px; margin-bottom: 2rem; }
        h3 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1.5rem; opacity: 0.6; }
        
        .progress-section { margin: 2rem 0; }
        .progress-labels { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 12px; opacity: 0.7; }
        .progress-bar { height: 16px; background: #f0f0f0; border-radius: 8px; overflow: hidden; margin-bottom: 12px; }
        .progress-fill { height: 100%; background: var(--brand-green, #1f6b3a); transition: width 1s ease-out; }
        .progress-footer { display: flex; justify-content: space-between; align-items: center; }
        .paid-tag { background: var(--brand-green, #1f6b3a); color: white; padding: 4px 12px; border-radius: 4px; font-size: 0.8rem; font-weight: 700; }

        .btn-pay { width: 100%; padding: 16px; background: var(--brand-red, #c62a33); color: white; border: none; border-radius: 8px; font-weight: 700; cursor: pointer; }
        
        .payment-list, .detail-list, .addon-list { display: flex; flex-direction: column; gap: 1rem; }
        .payment-row, .detail-row, .addon-row { display: flex; justify-content: space-between; align-items: center; }
        .payment-info { display: flex; flex-direction: column; }
        .ref { opacity: 0.4; }
        
        .badge { font-size: 0.75rem; font-weight: 700; padding: 4px 8px; border-radius: 4px; background: #eee; }
        .status-active { background: rgba(31, 107, 58, 0.1); color: var(--brand-green, #1f6b3a); }
        .status-ready { background: rgba(198, 42, 51, 0.1); color: var(--brand-red, #c62a33); }

        @media (max-width: 800px) {
          .grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
