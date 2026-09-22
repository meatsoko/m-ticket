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
  max_per_reservation: number; position: number; is_active: boolean;
};

export type Reservation = {
  id: string;
  reservation_number: string;
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
