# Admin & staff access

There is **no sign-up page, and there never will be** — that is deliberate. Anyone who
can create their own account could scan tickets, sell at the gate and read every guest's
phone number. Accounts are created by hand, and a role is granted by hand.

Right now **there are zero accounts**, so nobody can open the scanner, Gate Mode or the
admin dashboard. That is the first thing to fix below.

---

## The two roles

| | `staff` | `admin` |
|---|---|---|
| Scanner (`/scan`) | ✅ | ✅ |
| Gate sales (`/gate`) | ✅ | ✅ |
| Reservations list & search | — | ✅ |
| Check a guest in from the desk | — | ✅ |
| Event settings, reservation types, preorder items | — | ✅ |
| Refunds, CSV export, audit log | — | ✅ |

`admin` inherits everything `staff` can do. The app shows a role badge in the top bar, and
the bottom tab bar only renders the tabs your role holds — so a `staff` phone has no Admin
tab at all.

> **That is presentation, not security.** Hiding a tab is a usability decision. Every real
> boundary is enforced twice on the server: `requireStaff()` / `requireAdmin()` on the page,
> and Postgres RLS plus `requireStaff()` inside the Edge Functions on the data. Typing
> `/admin` as a staff user gets you redirected, not in.

---

## 1. Create the first admin

**Supabase Dashboard → Authentication → Users → Add user**

- Email: a real address (password resets go there)
- Password: set one
- ✅ **Auto Confirm User** — without this the account cannot sign in

Copy the new user's UUID.

Then **SQL Editor**:

```sql
insert into admin_users (user_id, role)
values ('<paste-the-uuid>', 'admin');
```

That's it. `admin_users` is the whole authorisation model: a row here grants the role, and
deleting the row revokes it instantly.

## 2. Create the gate staff

Same steps, one account **per device** — not one shared login:

```sql
insert into admin_users (user_id, role)
values ('<uuid>', 'staff');
```

Per-device accounts matter because the redemption log records `scanned_by`. With a shared
credential you cannot tell who admitted whom, which is the one question you will actually
want answered if something goes wrong at the gate.

## 3. Sign in

Open **`/login`** and use the email and password you set. You land on `/scan`.

The tab bar now shows what your role holds:

```
staff   Event · Scan · Gate
admin   Event · Scan · Gate · Admin
```

---

## What each screen is for

### `/admin` — event list
Every event, with its status. Tap one to open it.

### `/admin/events/<id>` — the event

**Event settings** (collapsed by default — tap to open). This is where you decide what the
event *is*:

- **How this event sells** — Ticketed / Free RSVP / RSVP + optional preorder / RSVP +
  required preorder. Switching this changes what the public page renders.
- **Reservation rules** — capacity (in *people*), max party size, the `NF-` number prefix,
  and when reservations open and close.
- **Where new reservations go** — a notify email and/or WhatsApp number, per event.
- **Details** — name, tagline, venue, description, banner URL, start/end/doors.

All times are **Nairobi (EAT)** and converted explicitly, so it does not matter what
timezone your laptop is in.

> Put `|` in the description to turn it into chips on the public page:
> `Nyama Choma | Live Grills | Music | Brand Village`

**Reservations panel** — totals (reservations, expected attendance vs capacity, checked-in
headcount, preorder revenue), search by **number, name, phone or email**, status filters,
desk check-in, and CSV export of whatever the filter is showing.

**Reservation types** — Single / Group / Family. A type either *fixes* the party size or
lets the guest choose within a range. These are yours to name and change.

**Preorder items** — the platters. Name, description, price, optional stock cap, and a
per-reservation limit. Price must be above zero; a free item is not a preorder.

### `/scan` — the gate
Camera scan, or type a code by hand. Works for both ticket QRs and reservation QRs. On a
valid scan it shows the guest's name, party size, and **what they paid for**, so you can
hand over the right platter. A second scan of the same pass is rejected with the time and
station of the first.

Tap **Sync cache** before gates open. After that the scanner keeps working with no signal,
queues admissions, and syncs when it reconnects.

### `/gate` — walk-up sales
STK push at the door. Pending sales poll in the background, so one person fumbling their
PIN never blocks the queue.

---

## Going live with an event

1. Open the event → **Event settings** → set the mode and the rules → **Save**
2. Add reservation types and preorder items
3. **Go live — open reservations**

To stop taking reservations, either set a **close** time or press **Close event**. A closed
event still appears in the public line-up tagged *Closed*, and the scanner refuses it.

---

## Revoking access

```sql
delete from admin_users where user_id = '<uuid>';
```

Takes effect immediately — RLS re-checks the row on every request. Also delete the auth
user in the dashboard if the person has left.

**Rotate passwords after each event.** In practice a gate credential ends up shared around
a WhatsApp group on the day; assume it has and change it afterwards.

---

## If you cannot get in

| Symptom | Cause |
|---|---|
| Login says "Login failed" with the right password | User not confirmed — tick **Auto Confirm User**, or confirm them in the dashboard |
| Login succeeds then bounces back to `/login` | No `admin_users` row for that user |
| Signed in but no **Admin** tab | Role is `staff`. Update the row to `admin` |
| `/admin` redirects to `/scan` | Same — `staff` cannot reach admin |
| Scanner shows "unauthorized" | Session expired. Sign in again |
| Camera will not start | Needs HTTPS. It will not work over plain `http://` on a phone |
