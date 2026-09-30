export type Event = {
  id: string; name: string; slug: string;
  format: "festival" | "conference_expo";
  description: string; venue: string;
  starts_at: string; ends_at: string; banner_url: string | null; status: string;
  // Reservation configuration — absent on events created before that feature.
  reservation_mode?: "off" | "free" | "optional_preorder" | "required_preorder";
  reservation_prefix?: string;
  capacity?: number | null;
  max_party_size?: number;
  tagline?: string | null;
  doors_open_at?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  /** One act per line; the event page shows a Lineup tab when set. */
  lineup?: string | null;
  /** Venue/table layout image; the event page shows a Table plan tab when set. */
  table_plan_url?: string | null;
  /** False while M-Pesa provisioning is pending: preorders show but can't be bought. */
  payments_enabled?: boolean;
};

export type TicketType = {
  id: string; event_id: string; name: string; price_kes: number;
  quantity_cap: number | null; bundle_qty: number; position: number; is_active: boolean;
};

export type OrderTicket = {
  qr_token: string; status: string;
  ticket_types?: { name: string; bundle_qty: number } | null;
};

export type ReservationMode = "off" | "free" | "optional_preorder" | "required_preorder";

export type PreorderItem = {
  id: string; event_id: string; name: string; description: string;
  price_kes: number; quantity_cap: number | null;
  image_url?: string | null;
  compare_at_price_kes?: number | null;
  early_bird_ends_at?: string | null;
  max_per_reservation: number; position: number; is_active: boolean;
};

export type Reservation = {
  id: string;
  reservation_number: string;
  /** 32-hex pass token — the only identifier resolve_pass() accepts. */
  access_token: string;
  guest_name: string;
  phone: string;
  email: string | null;
  party_size: number;
  accompanying_guests: number;
  expected_arrival: string | null;
  status: "pending_payment" | "confirmed" | "checked_in" | "cancelled";
  order_id: string | null;
  created_at: string;
  checked_in_at: string | null;
  arrived_party_size: number | null;
};

export type ReservationType = {
  id: string; event_id: string; name: string; description: string;
  /** null means the guest enters the number (a "group"). */
  fixed_party_size: number | null;
  min_party_size: number; max_party_size: number | null;
  position: number; is_active: boolean;
  included_preorder_item_id?: string | null;
  included_preorder_item?: PreorderItem | null;
  /** The free one-person ticket that tables upgrade (migration 20260929180000). */
  is_general_admission?: boolean;
};
