CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE role_name AS ENUM ('super_admin', 'organizer', 'hiker');
CREATE TYPE event_status AS ENUM (
  'draft',
  'pending_approval',
  'approved',
  'published',
  'sold_out',
  'completed',
  'archived'
);
CREATE TYPE booking_status AS ENUM (
  'pending',
  'held',
  'confirmed',
  'cancelled',
  'expired',
  'refunded'
);
CREATE TYPE payment_status AS ENUM (
  'initiated',
  'pending',
  'paid',
  'failed',
  'cancelled',
  'timed_out'
);
CREATE TYPE payout_status AS ENUM ('pending', 'processing', 'paid', 'failed');
CREATE TYPE approval_decision AS ENUM ('approved', 'rejected');

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  name role_name UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(30) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE counties (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) UNIQUE NOT NULL,
  code VARCHAR(10) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  county_id INT NOT NULL REFERENCES counties(id) ON DELETE RESTRICT,
  title VARCHAR(200) NOT NULL,
  slug VARCHAR(220) UNIQUE NOT NULL,
  summary TEXT,
  description TEXT NOT NULL,
  location_text VARCHAR(255) NOT NULL,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  event_date TIMESTAMPTZ NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  capacity INT NOT NULL CHECK (capacity > 0),
  booked_slots INT NOT NULL DEFAULT 0 CHECK (booked_slots >= 0),
  available_slots INT NOT NULL DEFAULT 0 CHECK (available_slots >= 0),
  status event_status NOT NULL DEFAULT 'draft',
  submission_notes TEXT,
  admin_notes TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((booked_slots + available_slots) <= capacity),
  CHECK (available_slots = capacity - booked_slots OR status IN ('draft', 'pending_approval'))
);

CREATE TABLE event_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption VARCHAR(255),
  is_cover BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, display_order)
);

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ticket_code VARCHAR(40) UNIQUE NOT NULL,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),
  status booking_status NOT NULL DEFAULT 'pending',
  reservation_expires_at TIMESTAMPTZ,
  payment_reference VARCHAR(100),
  mpesa_receipt_number VARCHAR(100),
  checked_in BOOLEAN NOT NULL DEFAULT FALSE,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  provider VARCHAR(50) NOT NULL DEFAULT 'mpesa',
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  phone_number VARCHAR(30),
  status payment_status NOT NULL DEFAULT 'initiated',
  checkout_request_id VARCHAR(120),
  merchant_request_id VARCHAR(120),
  callback_payload JSONB,
  mpesa_receipt_number VARCHAR(120),
  transaction_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_id UUID REFERENCES events(id) ON DELETE RESTRICT,
  payout_reference VARCHAR(120) UNIQUE NOT NULL,
  gross_amount NUMERIC(10,2) NOT NULL CHECK (gross_amount >= 0),
  platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  net_amount NUMERIC(10,2) NOT NULL CHECK (net_amount >= 0),
  status payout_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER bookings_updated_at
BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER payouts_updated_at
BEFORE UPDATE ON payouts
FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE VIEW public_active_events AS
SELECT *
FROM events
WHERE status = 'published'
  AND event_date > NOW();

CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_events_organizer_id ON events(organizer_id);
CREATE INDEX idx_events_county_id ON events(county_id);
CREATE INDEX idx_events_status_date ON events(status, event_date);
CREATE INDEX idx_events_published_index ON events(status, event_date) WHERE status = 'published';
CREATE INDEX idx_event_images_event_id ON event_images(event_id);
CREATE INDEX idx_bookings_event_id ON bookings(event_id);
CREATE INDEX idx_bookings_user_id ON bookings(user_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_payments_booking_id ON payments(booking_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payouts_organizer_id ON payouts(organizer_id);
