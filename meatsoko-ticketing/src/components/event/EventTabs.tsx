"use client";
import { useState, type ReactNode } from "react";

// Overview / Lineup / Venue / Table plan. Lineup and Table plan only appear when
// the event has them (events.lineup, events.table_plan_url).
export default function EventTabs({ overview, lineup, venue, tablePlanUrl, eventName }: {
  overview: ReactNode; lineup?: string | null; venue?: string | null; tablePlanUrl?: string | null; eventName: string;
}) {
  const acts = (lineup ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const tabs = [
    { id: "overview", label: "Overview" },
    ...(acts.length ? [{ id: "lineup", label: "Lineup" }] : []),
    ...(venue ? [{ id: "venue", label: "Venue" }] : []),
    ...(tablePlanUrl ? [{ id: "plan", label: "Table plan" }] : []),
  ];
  const [tab, setTab] = useState("overview");
  return (
    <div className="event-tabs">
      {tabs.length > 1 && (
        <div className="event-tab-list" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
      )}
      <div role="tabpanel">
        {tab === "overview" && overview}
        {tab === "lineup" && (
          <ul className="event-lineup">{acts.map((a) => <li key={a}>{a}</li>)}</ul>
        )}
        {tab === "venue" && venue && (
          <div className="event-venue">
            <strong>{venue}</strong>
            <a className="btn-ghost btn-block" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
          </div>
        )}
        {tab === "plan" && tablePlanUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="event-table-plan" src={tablePlanUrl} alt={`${eventName} table plan`} loading="lazy" />
        )}
      </div>
    </div>
  );
}
