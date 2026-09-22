import type { IconName } from "@/lib/rbac";

/**
 * Inline strokes only — no icon dependency, and nothing extra to fetch on the
 * 3G budget the event page has to hit (NFR-2).
 */
const PATHS: Record<IconName | "pin" | "clock" | "back" | "logout" | "share", React.ReactNode> = {
  ticket: <><path d="M3 9.5V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.5a2.5 2.5 0 0 0 0-5Z" /><path d="M15 5v14" strokeDasharray="2 2.5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  scan:   <><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M4 12h16" /></>,
  sell:   <><path d="M3 10.5 12 4l9 6.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 21v-6h6v6" /></>,
  grid:   <><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></>,
  chart:  <><path d="M4 20h16" /><path d="M7 20v-7M12 20V7M17 20v-4" /></>,
  pin:    <><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></>,
  clock:  <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></>,
  back:   <><path d="M15 5l-7 7 7 7" /></>,
  logout: <><path d="M15 12H5" /><path d="m8 9-3 3 3 3" /><path d="M11 5h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6" /></>,
  share:  <><circle cx="17" cy="6" r="2.6" /><circle cx="7" cy="12" r="2.6" /><circle cx="17" cy="18" r="2.6" /><path d="m9.4 10.8 5.2-3.1M9.4 13.2l5.2 3.1" /></>,
};

export default function Icon({
  name, size = 22, strokeWidth = 1.8, ...rest
}: { name: keyof typeof PATHS; size?: number; strokeWidth?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
