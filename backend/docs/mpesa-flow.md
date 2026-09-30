# Safaricom Daraja M-PESA Flow

## Step-by-step payment flow

1. Hiker selects a hike and quantity.
2. Backend validates `available_slots` and reserves inventory in a transaction.
3. Backend inserts a `bookings` row with status `held` and `reservation_expires_at = NOW() + 10 minutes`.
4. Backend calls STK Push via the Daraja API.
5. User approves the prompt on their phone.
6. Safaricom sends a callback to `/api/v1/payments/mpesa-callback`.
7. Callback is parsed and verified.
8. Payment row is updated from `initiated` to `paid`.
9. Booking is moved from `held` to `confirmed`.
10. Inventory is finalized, ticket code is generated, and PDF pass is prepared.
11. If the STK request fails or times out, the booking is cancelled and the reservation is rolled back.

## Callback mapping logic

- `MerchantRequestID` -> `payments.merchant_request_id`
- `CheckoutRequestID` -> `payments.checkout_request_id`
- `ResultCode` -> payment lifecycle state
- `ResultDesc` -> failure description
- `MpesaReceiptNumber` -> `payments.mpesa_receipt_number`
- `Amount` -> `payments.amount`
- `PhoneNumber` -> `payments.phone_number`
- `TransactionDate` -> `payments.transaction_date`

## Transaction safety

- Use `SELECT ... FOR UPDATE` against the event row before inventory reduces.
- Store hold windows with `reservation_expires_at`.
- Only confirm booking if `ResultCode = 0`.
- Roll back on `ResultCode != 0`, cancellation, or timeout.

## Controller pseudocode

```js
POST /api/v1/payments/stk-push
  validate amount + phone + booking
  start transaction
    lock event row
    check available slots
    insert booking status='held'
    insert payment status='initiated'
  commit

  return mpesa response

POST /api/v1/payments/mpesa-callback
  parse callback
  if resultCode !== 0
    update booking status='cancelled'
    update inventory back
    return ok

  lock booking row
  update booking status='confirmed'
  insert ticket code if missing
  generate PDF ticket
  return ok
```
