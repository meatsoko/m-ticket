"use client";
import { useState, type ReactNode } from "react";
import ProgramTimeline from "./ProgramTimeline";
import EventConceptView from "./EventConceptView";
import type { EventProgramItem, EventConcept } from "@/lib/types";

// Overview / Program / Concept / Lineup / Venue / Table plan.
export default function EventTabs({ overview, lineup, venue, tablePlanUrl, eventName, program, concept }: {
  overview: ReactNode; lineup?: string | null; venue?: string | null; tablePlanUrl?: string | null; eventName: string;
  program?: EventProgramItem[]; concept?: EventConcept | null;
}) {
  const acts = (lineup ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const tabs = [
    { id: "overview", label: "Overview" },
    ...(program && program.length > 0 ? [{ id: "program", label: "Program" }] : []),
    ...(concept ? [{ id: "concept", label: "Concept" }] : []),
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
        {tab === "program" && program && <ProgramTimeline items={program} />}
        {tab === "concept" && concept && <EventConceptView concept={concept} />}
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
