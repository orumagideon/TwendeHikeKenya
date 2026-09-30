-- 1. Safe ticket reservation with row-level locking
BEGIN;

SELECT id, capacity, booked_slots, available_slots
FROM events
WHERE id = $1
FOR UPDATE;

-- Validate inventory
-- If available_slots >= requested_quantity then continue.
-- If not, abort or return an error.

UPDATE events
SET booked_slots = booked_slots + $2,
    available_slots = capacity - (booked_slots + $2),
    status = CASE
      WHEN ((booked_slots + $2) >= capacity) THEN 'sold_out'::event_status
      ELSE status
    END,
    updated_at = NOW()
WHERE id = $1;

INSERT INTO bookings (
  event_id,
  user_id,
  ticket_code,
  quantity,
  unit_price,
  total_amount,
  status,
  reservation_expires_at,
  payment_reference
)
VALUES (
  $1,
  $3,
  gen_random_uuid()::text,
  $2,
  $4,
  $5,
  'held',
  NOW() + INTERVAL '10 minutes',
  $6
);

COMMIT;

-- 2. Expire stale holds and release reservation state
UPDATE bookings
SET status = 'expired',
    cancelled_at = NOW(),
    cancellation_reason = 'Reservation expired before payment confirmation',
    updated_at = NOW()
WHERE status = 'held'
  AND reservation_expires_at < NOW();

-- 3. Confirm payment after STK callback
BEGIN;

SELECT *
FROM bookings
WHERE id = $1
FOR UPDATE;

UPDATE bookings
SET status = 'confirmed',
    paid_at = NOW(),
    mpesa_receipt_number = $2,
    payment_reference = $3,
    updated_at = NOW()
WHERE id = $1;

UPDATE payments
SET status = 'paid',
    mpesa_receipt_number = $2,
    transaction_date = NOW(),
    updated_at = NOW()
WHERE booking_id = $1;

COMMIT;

-- 4. Rollback on failed or cancelled STK flow
BEGIN;

SELECT *
FROM bookings
WHERE id = $1
FOR UPDATE;

UPDATE bookings
SET status = 'cancelled',
    cancelled_at = NOW(),
    cancellation_reason = 'STK cancelled or timed out',
    updated_at = NOW()
WHERE id = $1
  AND status = 'held';

UPDATE events e
SET booked_slots = booked_slots - b.quantity,
    available_slots = capacity - booked_slots,
    status = CASE
      WHEN booked_slots - b.quantity < capacity THEN 'published'::event_status
      ELSE e.status
    END,
    updated_at = NOW()
FROM bookings b
WHERE e.id = b.event_id
  AND b.id = $1
  AND b.status = 'cancelled';

COMMIT;

-- 5. Payment reconciliation query
SELECT b.id,
       b.ticket_code,
       e.title,
       b.total_amount,
       p.status,
       p.mpesa_receipt_number,
       b.created_at
FROM bookings b
INNER JOIN events e ON e.id = b.event_id
LEFT JOIN payments p ON p.booking_id = b.id
WHERE b.status IN ('confirmed', 'pending');
