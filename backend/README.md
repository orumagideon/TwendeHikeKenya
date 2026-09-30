# Twende Hike Kenya Backend

This backend provides the core architecture for a Kenyan hiking and outdoor marketplace. It includes:

- PostgreSQL schema with event lifecycle, user roles, inventory, booking, payment, and payout tables
- RBAC for `super_admin`, `organizer`, and `hiker`
- Public marketplace queries and organizer dashboards
- Safaricom Daraja STK integration design and callback processing
- Digital ticket generation with a unique PDF ticket code

## Quick start

1. Copy `.env.example` to `.env` and fill in your PostgreSQL and Daraja credentials.
2. Run the schema in PostgreSQL:
   ```bash
   psql -d twendehike -f backend/sql/001_schema.sql
   ```
3. Start the app:
   ```bash
   cd backend
   npm install
   npm run start
   ```
4. Use the API routes described in `backend/docs/api-spec.md`.

## Key folders

- `backend/sql` — PostgreSQL schema and concurrency examples
- `backend/docs` — API and M-PESA documentation
- `backend/src` — Express.js backend implementation
