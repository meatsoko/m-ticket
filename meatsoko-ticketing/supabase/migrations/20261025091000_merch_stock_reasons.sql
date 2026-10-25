-- New reasons for the merchandise stock ledger (merch_stock_movements.reason).
--
-- A file of its own because Postgres will not let a transaction use an enum value
-- it has just added; 20261025100000_merch_inventory.sql uses these.
--
--   opening           the verified opening count that starts tracking a size
--   issue             stock removed for a reason that is not a sale or damage
--                     (giveaway, sample, staff use, lost) — the batch says which
--   manual_sale       a sale recorded by an admin (event stand, office, …)
--   manual_sale_void  a voided manual sale puts its units back
--   exchange_out      the replacement item handed over in an exchange
--   reversal          a stock batch entered by mistake, undone
-- Existing values keep their meaning: restock (stock received), sale (website
-- order paid), return (goods back on the shelf after a refund, return or the
-- returned side of an exchange), adjustment (stock-take correction), damaged.

alter type public.merch_stock_reason add value if not exists 'opening';
alter type public.merch_stock_reason add value if not exists 'issue';
alter type public.merch_stock_reason add value if not exists 'manual_sale';
alter type public.merch_stock_reason add value if not exists 'manual_sale_void';
alter type public.merch_stock_reason add value if not exists 'exchange_out';
alter type public.merch_stock_reason add value if not exists 'reversal';
