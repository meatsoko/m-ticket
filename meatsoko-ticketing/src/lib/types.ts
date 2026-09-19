export type Event = {
  id: string; name: string; slug: string;
  format: "festival" | "conference_expo";
  description: string; venue: string;
  starts_at: string; ends_at: string; banner_url: string | null; status: string;
};

export type TicketType = {
  id: string; event_id: string; name: string; price_kes: number;
  quantity_cap: number | null; bundle_qty: number; position: number; is_active: boolean;
};

export type OrderTicket = {
  qr_token: string; status: string;
  ticket_types?: { name: string; bundle_qty: number } | null;
};
