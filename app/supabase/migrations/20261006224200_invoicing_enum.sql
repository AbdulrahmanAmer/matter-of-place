-- irreversible: enum value cannot be dropped
set lock_timeout = '5s';

-- B6 (ASSUMED A3): an invoice issued in error is voided. Alone in its file: a new enum value cannot be used in the
-- transaction that adds it.
alter type public.payment_status add value if not exists 'void';
