import type { EventProgramItem } from "@/lib/types";

// The event's running order (Program tab). Published items only (RLS).
export default function ProgramTimeline({ items }: { items: EventProgramItem[] }) {
  if (!items.length) return <p className="small">The full program will be announced soon.</p>;
  return (
    <ol className="ev-program">
      {items.map((item) => (
        <li key={item.id} className="ev-program-item">
          <div className="ev-program-time">
            <strong>{item.time_label}</strong>
            {item.category && <span>{item.category}</span>}
          </div>
          <div className="ev-program-body">
            <strong className="ev-program-title">{item.title}</strong>
            {item.speaker_host && <span className="small">with <b>{item.speaker_host}</b></span>}
            {item.location && <span className="small">{item.location}</span>}
            {item.description && <p className="small">{item.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
