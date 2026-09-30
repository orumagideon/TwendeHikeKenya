# Twende Hike Kenya Backend API Specification

## Public Endpoints

### GET /api/v1/public/health
- Returns backend health status.

### GET /api/v1/public/counties
- Returns all counties for the search/filter drop-down.

### GET /api/v1/public/events
- Query params: `countyId`, `minPrice`, `maxPrice`, `status`, `search`, `page`, `limit`
- Returns active public hikes only.

### GET /api/v1/public/events/:id
- Returns event details plus image gallery.

## Auth

### POST /api/v1/auth/register
Request body:
```json
{
  "firstName": "Amina",
  "lastName": "Njeri",
  "email": "amina@example.com",
  "phone": "+254712345678",
  "password": "securePass123",
  "role": "hiker"
}
```

### POST /api/v1/auth/login
Request body:
```json
{
  "email": "amina@example.com",
  "password": "securePass123"
}
```

## Organizer Endpoints

### GET /api/v1/organizer/dashboard
- Requires `organizer` role.
- Returns organizer statistics, ticket sales, and payout summary.

### POST /api/v1/organizer/events
- Creates a new hike listing in `draft` state.

### PATCH /api/v1/organizer/events/:id
- Updates hike details.

### POST /api/v1/organizer/events/:id/images
- Uploads event images and stores `event_images` rows.

### GET /api/v1/organizer/events/:id/manifest
- Returns booking manifest for the event.

## Admin Endpoints

### GET /api/v1/admin/events/pending
- Requires `super_admin` role.
- Returns events in `pending_approval` state.

### PATCH /api/v1/admin/events/:id/review
- Body: `{ "decision": "approved", "notes": "..." }`
- Moves event to `approved` or `rejected` state.

### GET /api/v1/admin/financials/summary
- Additional metrics: platform commission, payouts due, completed booking count.

## Payment Endpoints

### POST /api/v1/payments/stk-push
Request body:
```json
{
  "eventId": "c14d4c7f-b983-4276-b4d9-8e945f2d149b",
  "userId": "4d5e1600-597e-4a48-9c3f-1f42c7365f84",
  "phoneNumber": "254712345678",
  "amount": 1500,
  "quantity": 2
}
```

### POST /api/v1/payments/mpesa-callback
- Called by Safaricom with transaction details.
- Validates callback status and confirms booking.

### GET /api/v1/bookings/:bookingId/ticket.pdf
- Returns a generated PDF ticket with unique `ticketCode`.

## Response Convention

```json
{
  "success": true,
  "data": {},
  "message": "Request processed successfully."
}
```

Error response:
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": ["eventId is required"]
}
```
