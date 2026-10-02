import express from 'express';
import compression from 'compression';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import { config } from './config.js';
import { authMiddleware, requireRoles } from './middleware/auth.js';
import { initiateStkPush, handleMpesaCallback } from './services/mpesaService.js';
import { buildTicketPdf, generateTicketCode } from './services/ticketService.js';
import { query, withTransaction } from './lib/db.js';

const app = express();
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

const counties = [
  { id: 1, name: 'Mombasa', code: '001' },
  { id: 2, name: 'Kwale', code: '002' },
  { id: 3, name: 'Kilifi', code: '003' },
  { id: 4, name: 'Tana River', code: '004' },
  { id: 5, name: 'Lamu', code: '005' },
  { id: 6, name: 'Taita Taveta', code: '006' },
  { id: 7, name: 'Garissa', code: '007' },
  { id: 8, name: 'Wajir', code: '008' },
  { id: 9, name: 'Mandera', code: '009' },
  { id: 10, name: 'Marsabit', code: '010' },
  { id: 11, name: 'Isiolo', code: '011' },
  { id: 12, name: 'Meru', code: '012' },
  { id: 13, name: 'Tharaka Nithi', code: '013' },
  { id: 14, name: 'Embu', code: '014' },
  { id: 15, name: 'Kitui', code: '015' },
  { id: 16, name: 'Machakos', code: '016' },
  { id: 17, name: 'Makueni', code: '017' },
  { id: 18, name: 'Nyandarua', code: '018' },
  { id: 19, name: 'Nyeri', code: '019' },
  { id: 20, name: 'Kirinyaga', code: '020' },
  { id: 21, name: 'Murang\'a', code: '021' },
  { id: 22, name: 'Kiambu', code: '022' },
  { id: 23, name: 'Turkana', code: '023' },
  { id: 24, name: 'West Pokot', code: '024' },
  { id: 25, name: 'Samburu', code: '025' },
  { id: 26, name: 'Trans Nzoia', code: '026' },
  { id: 27, name: 'Uasin Gishu', code: '027' },
  { id: 28, name: 'Elgeyo Marakwet', code: '028' },
  { id: 29, name: 'Nandi', code: '029' },
  { id: 30, name: 'Baringo', code: '030' },
  { id: 31, name: 'Laikipia', code: '031' },
  { id: 32, name: 'Nakuru', code: '032' },
  { id: 33, name: 'Narok', code: '033' },
  { id: 34, name: 'Kajiado', code: '034' },
  { id: 35, name: 'Kericho', code: '035' },
  { id: 36, name: 'Bomet', code: '036' },
  { id: 37, name: 'Kakamega', code: '037' },
  { id: 38, name: 'Vihiga', code: '038' },
  { id: 39, name: 'Bungoma', code: '039' },
  { id: 40, name: 'Busia', code: '040' },
  { id: 41, name: 'Siaya', code: '041' },
  { id: 42, name: 'Kisumu', code: '042' },
  { id: 43, name: 'Homa Bay', code: '043' },
  { id: 44, name: 'Migori', code: '044' },
  { id: 45, name: 'Kisii', code: '045' },
  { id: 46, name: 'Nyamira', code: '046' },
  { id: 47, name: 'Nairobi', code: '047' },
];

const SUPERADMIN_EMAIL = config.superAdminEmail;
const DEFAULT_SUPERADMIN_PASSWORD = config.superAdminPassword;

const users = [
  {
    id: '8d8a1ef8-8e6d-4a02-a4f5-3503bc9ee42a',
    firstName: 'System',
    lastName: 'Admin',
    email: SUPERADMIN_EMAIL,
    phone: '+254700000001',
    passwordHash: bcrypt.hashSync(DEFAULT_SUPERADMIN_PASSWORD, 10),
    role: 'super_admin'
  }
];

const events = [];

const bookings = [];
const payments = [];

const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());

async function resolveEventOrganizerId(preferredOrganizerId = null) {
  if (preferredOrganizerId && isUuid(preferredOrganizerId)) {
    const existing = await query('SELECT id FROM users WHERE id = $1 LIMIT 1', [preferredOrganizerId]);
    if (existing.rows[0]?.id) {
      return existing.rows[0].id;
    }
  }

  const admin = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [config.superAdminEmail]);
  if (admin.rows[0]?.id) {
    return admin.rows[0].id;
  }

  const fallback = await query('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
  return fallback.rows[0]?.id || users[0].id;
}

async function ensureDefaultRoles() {
  if (!config.databaseUrl) {
    return;
  }

  const roleNames = ['super_admin', 'organizer', 'hiker'];
  for (const name of roleNames) {
    try {
      await query(`
        INSERT INTO roles (name, description)
        VALUES ($1, $2)
        ON CONFLICT (name) DO NOTHING
      `, [name, `${name} access`]);
    } catch (error) {
      const message = error.message || '';
      if (!/does not exist|permission denied|relation .*roles.* does not exist/i.test(message)) {
        throw error;
      }
    }
  }
}

async function ensureDefaultSuperAdmin() {
  if (!config.databaseUrl) {
    return;
  }

  try {
    await ensureDefaultRoles();

    const roleResult = await query('SELECT id FROM roles WHERE name = $1 LIMIT 1', ['super_admin']);
    const roleId = roleResult.rows[0]?.id;
    if (!roleId) {
      return;
    }

    await query(`
      INSERT INTO users (id, first_name, last_name, email, phone, password_hash, role_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (email) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        phone = EXCLUDED.phone,
        password_hash = EXCLUDED.password_hash,
        role_id = EXCLUDED.role_id,
        status = EXCLUDED.status
    `, [
      '8d8a1ef8-8e6d-4a02-a4f5-3503bc9ee42a',
      'System',
      'Admin',
      SUPERADMIN_EMAIL,
      '+254700000001',
      bcrypt.hashSync(DEFAULT_SUPERADMIN_PASSWORD, 10),
      roleId,
      'active'
    ]);
  } catch (error) {
    const message = error.message || '';
    if (!/does not exist|permission denied|relation .*users.* does not exist|relation .*roles.* does not exist/i.test(message)) {
      throw error;
    }
  }
}

async function ensureDatabaseSchema() {
  if (!config.databaseUrl) {
    return;
  }

  const databaseUrl = new URL(config.databaseUrl);
  const schemaUser = databaseUrl.username ? `"${databaseUrl.username}"` : 'CURRENT_USER';

  const privilegeStatements = [
    'CREATE SCHEMA IF NOT EXISTS public',
    `GRANT USAGE, CREATE ON SCHEMA public TO ${schemaUser}`,
    `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${schemaUser}`,
    `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${schemaUser}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${schemaUser}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${schemaUser}`,
  ];

  for (const statement of privilegeStatements) {
    try {
      await query(statement);
    } catch (error) {
      const message = error.message || '';
      const ignorable = /already exists|does not exist|permission denied|duplicate|not owner/i.test(message);
      if (!ignorable) {
        throw error;
      }
    }
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role_id INTEGER REFERENCES roles(id),
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(30) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS counties (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) UNIQUE NOT NULL,
      code VARCHAR(10) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      hero_image_url TEXT,
      hero_overlay_color VARCHAR(50) NOT NULL DEFAULT '#062d1f',
      hero_headline TEXT NOT NULL DEFAULT 'Conquer the Aberdares, Longonot & Mt. Kenya.',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS key VARCHAR(50)`,
    `ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS value JSONB`,
    `DROP INDEX IF EXISTS site_settings_key_unique`,
    `DELETE FROM site_settings a USING site_settings b WHERE a.key IS NOT NULL AND a.key = b.key AND a.ctid < b.ctid`,
    `CREATE UNIQUE INDEX IF NOT EXISTS site_settings_key_unique ON site_settings(key)`,
    `INSERT INTO site_settings (id, key, value)
     VALUES (1, 'hero', '{"title":"Conquer the Aberdares, Longonot & Mt. Kenya.","subtitle":"Verified trail captains, licensed KWS rangers, pickup from Nairobi CBD, and seamless booking with Lipa na M-PESA.","badge":"KENYA''S #1 TRAIL MARKETPLACE","bg_image":"","bg_color":"#064e3b"}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET key = COALESCE(site_settings.key, EXCLUDED.key), value = COALESCE(site_settings.value, EXCLUDED.value)`,
    `CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organizer_id UUID NOT NULL,
      county_id INTEGER NOT NULL,
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
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      booked_slots INTEGER NOT NULL DEFAULT 0,
      available_slots INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      submission_notes TEXT,
      admin_notes TEXT,
      approved_by UUID,
      approved_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS meeting_point TEXT`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS pickup_time VARCHAR(50)`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS google_map_url TEXT`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS inclusions JSONB DEFAULT '[]'::jsonb`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_phone VARCHAR(50)`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_email VARCHAR(120)`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_name VARCHAR(200)`,
    `CREATE TABLE IF NOT EXISTS event_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL,
      image_url TEXT NOT NULL,
      caption VARCHAR(255),
      is_cover BOOLEAN NOT NULL DEFAULT FALSE,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (event_id, display_order)
    )`,
    `CREATE TABLE IF NOT EXISTS event_likes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      anonymous_key VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (user_id IS NOT NULL OR anonymous_key IS NOT NULL)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS unique_event_like_per_user
      ON event_likes (event_id, user_id)
      WHERE user_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS unique_event_like_per_anonymous_key
      ON event_likes (event_id, anonymous_key)
      WHERE anonymous_key IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL,
      user_id UUID NOT NULL,
      ticket_code VARCHAR(40) UNIQUE NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price NUMERIC(10,2) NOT NULL,
      total_amount NUMERIC(10,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
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
    )`,
    `CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id UUID NOT NULL,
      user_id UUID NOT NULL,
      event_id UUID NOT NULL,
      provider VARCHAR(50) NOT NULL DEFAULT 'mpesa',
      amount NUMERIC(10,2) NOT NULL,
      phone_number VARCHAR(30),
      status TEXT NOT NULL DEFAULT 'initiated',
      checkout_request_id VARCHAR(120),
      merchant_request_id VARCHAR(120),
      callback_payload JSONB,
      mpesa_receipt_number VARCHAR(120),
      transaction_date TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organizer_id UUID NOT NULL,
      event_id UUID,
      payout_reference VARCHAR(120) UNIQUE NOT NULL,
      gross_amount NUMERIC(10,2) NOT NULL,
      platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(10,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)`,
    `CREATE INDEX IF NOT EXISTS idx_events_status_date ON events(status, event_date)`,
    `CREATE INDEX IF NOT EXISTS idx_events_county_id ON events(county_id)`,
    `CREATE INDEX IF NOT EXISTS idx_event_images_event_id ON event_images(event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_event_likes_event_id ON event_likes(event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id)`,
  ];

  for (const statement of statements) {
    try {
      await query(statement);
    } catch (error) {
      const message = error.message || '';
      const ignorable = /already exists|duplicate key|duplicate object|relation .* already exists/i.test(message);
      if (!ignorable) {
        throw error;
      }
    }
  }
}

async function seedKenyanCounties() {
  if (!config.databaseUrl) {
    return;
  }

  const countResult = await query('SELECT COUNT(*)::int AS count FROM counties');
  if (Number(countResult.rows[0]?.count || 0) >= counties.length) {
    return;
  }

  const values = counties
    .map((county, index) => `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`)
    .join(', ');
  const params = counties.flatMap((county) => [county.id, county.name, county.code]);

  await query(`
    INSERT INTO counties (id, name, code)
    VALUES ${values}
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      code = EXCLUDED.code
  `, params);
  await query("SELECT setval(pg_get_serial_sequence('counties', 'id'), 47, true)");
}

async function withSchemaRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    const relationMissing = /relation .* does not exist|does not exist/i.test(error.message || '');
    if (config.databaseUrl && relationMissing) {
      await ensureDatabaseSchema();
      return await operation();
    }
    throw error;
  }
}

function buildPublicEvent(event) {
  const organizer = users.find((user) => user.id === event.organizerId) || null;
  const likesCount = Number(event.likesCount ?? event.likes_count ?? event.interestCount ?? event.interest_count ?? 0);
  const photos = Array.isArray(event.photos) ? event.photos : [];
  const image = photos[0] || event.cover_image || event.coverImage || event.image || null;
  const countyName = event.county?.name || event.countyName || event.county_name || null;
  const inclusions = parseInclusions(event.inclusions);

  return {
    ...event,
    photos,
    image,
    meetingPoint: event.meetingPoint || event.meeting_point || event.locationText || event.location_text || '',
    pickupTime: event.pickupTime || event.pickup_time || event.startTime || event.start_time || '05:30 AM',
    googleMapUrl: event.googleMapUrl || event.google_map_url || '',
    inclusions,
    organizerPhone: event.organizerPhone || event.organizer_phone || '',
    organizerEmail: event.organizerEmail || event.organizer_email || '',
    likesCount,
    interestCount: likesCount,
    county: countyName
      ? { id: event.countyId, name: countyName }
      : counties.find((county) => county.id === event.countyId) || null,
    organizer: organizer
      ? {
          id: organizer.id,
          firstName: organizer.firstName,
          lastName: organizer.lastName,
          email: organizer.email,
          role: organizer.role
        }
      : null,
    organizerName: event.organizerName || event.organizer_name || (organizer ? `${organizer.firstName} ${organizer.lastName}` : 'Twende Hike Kenya')
  };
}

function parseInclusions(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_error) {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

app.get('/api/v1/public/health', (_req, res) => {
  return res.json({ success: true, data: { status: 'ok', service: 'twendehike-backend' } });
});

app.get('/api/v1/public/settings', async (_req, res) => {
  const fallback = {
    heroImageUrl: null,
    heroOverlayColor: '#062d1f',
    heroHeadline: 'Conquer the Aberdares, Longonot & Mt. Kenya.',
  };

  try {
    if (!config.databaseUrl) return res.json({ success: true, data: fallback });
    const result = await query('SELECT hero_image_url, hero_overlay_color, hero_headline FROM site_settings WHERE id = 1 LIMIT 1');
    const row = result.rows[0];
    return res.json({
      success: true,
      data: row ? {
        heroImageUrl: row.hero_image_url || null,
        heroOverlayColor: row.hero_overlay_color || fallback.heroOverlayColor,
        heroHeadline: row.hero_headline || fallback.heroHeadline,
      } : fallback,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to load site settings.' });
  }
});

const autoCompletePastEvents = async () => {
  if (!config.databaseUrl) return;
  try {
    await query(`
      UPDATE events
      SET status = 'completed', updated_at = NOW()
      WHERE status IN ('approved', 'published')
        AND event_date < CURRENT_DATE
    `);
  } catch (err) {
    console.error('Auto-complete past events error:', err);
  }
};

app.get('/api/v1/public/settings/hero', async (_req, res) => {
  const fallback = {
    title: 'Conquer the Aberdares, Longonot & Mt. Kenya.',
    subtitle: 'Verified trail captains, licensed KWS rangers, pickup from Nairobi CBD, and seamless booking with Lipa na M-PESA.',
    badge: "KENYA'S #1 TRAIL MARKETPLACE",
    bg_mode: 'color',
    image_opacity: 0.5,
    bg_image: '',
    bg_color: '#064e3b',
  };

  try {
    if (!config.databaseUrl) return res.json({ success: true, data: fallback });
    const result = await query('SELECT value FROM site_settings WHERE key = $1 LIMIT 1', ['hero']);
    return res.json({ success: true, data: { ...fallback, ...(result.rows[0]?.value || {}) } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to load hero settings.' });
  }
});

app.get('/api/v1/public/counties', async (_req, res) => {
  try {
    if (config.databaseUrl) {
      const result = await query('SELECT id, name, code FROM counties ORDER BY id ASC');
      return res.json({ success: true, data: result.rows });
    }
    return res.json({ success: true, data: [...counties].sort((a, b) => a.id - b.id) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to load counties.' });
  }
});

app.get('/api/v1/public/events', async (req, res) => {
  const { countyId, minPrice = 0, maxPrice = Number.MAX_SAFE_INTEGER, search = '' } = req.query;

  try {
    let payload = [];

    if (config.databaseUrl) {
      await autoCompletePastEvents();
      await withSchemaRetry(async () => {
        const likeResult = await query(`
          SELECT event_id, COUNT(*)::int AS likes_count
          FROM event_likes
          GROUP BY event_id
        `);
        const likeMap = new Map(likeResult.rows.map((row) => [row.event_id, Number(row.likes_count || 0)]));

        const result = await query(`
          SELECT
            e.*,
            c.name AS county_name,
            COALESCE(
              CASE WHEN cover.image_url IS NULL THEN '[]'::json ELSE json_build_array(cover.image_url) END,
              '[]'::json
            ) AS photos
          FROM events e
          LEFT JOIN counties c ON c.id = e.county_id
          LEFT JOIN LATERAL (
            SELECT image_url
            FROM event_images
            WHERE event_id = e.id
            ORDER BY display_order ASC
            LIMIT 1
          ) cover ON TRUE
          WHERE e.status IN ('published', 'approved')
            AND e.status NOT IN ('completed', 'rejected', 'archived')
            AND e.event_date >= CURRENT_DATE
          GROUP BY e.id, c.name, cover.image_url
          ORDER BY e.event_date ASC
        `);

        const rows = result.rows.map((row) => ({
          ...row,
          photos: Array.isArray(row.photos) ? row.photos : [],
          image: (Array.isArray(row.photos) && row.photos[0]) || row.cover_image || null,
          likesCount: Number(likeMap.get(row.id) || 0),
          interestCount: Number(likeMap.get(row.id) || 0),
          county: row.county_name ? { id: row.county_id, name: row.county_name } : null,
          organizer: { id: row.organizer_id, firstName: 'Twende', lastName: 'Host', email: '', role: 'organizer' },
          organizerName: 'Twende Host',
          summary: row.summary || row.description || '',
          eventDate: row.event_date,
          startTime: row.start_time,
          endTime: row.end_time,
          meetingPoint: row.meeting_point || row.location_text || '',
          pickupTime: row.pickup_time || row.start_time || '05:30 AM',
          googleMapUrl: row.google_map_url || '',
          inclusions: parseInclusions(row.inclusions),
          organizerPhone: row.organizer_phone || '',
          organizerEmail: row.organizer_email || '',
          organizerName: row.organizer_name || 'Twende Host',
          price: Number(row.price || 0),
          capacity: Number(row.capacity || 0),
          bookedSlots: Number(row.booked_slots || 0),
          availableSlots: Number(row.available_slots || 0),
          status: row.status,
        }));

        payload = rows.filter((event) => {
          const matchesCounty = countyId ? String(event.county_id) === String(countyId) : true;
          const matchesPrice = Number(event.price) >= Number(minPrice) && Number(event.price) <= Number(maxPrice);
          const term = String(search).toLowerCase();
          const matchesSearch = !term || `${event.title} ${event.summary}`.toLowerCase().includes(term);
          return matchesCounty && matchesPrice && matchesSearch;
        }).map(buildPublicEvent);
      });
      return res.json({ success: true, data: payload });
    } else {
      const filtered = events.filter((event) => {
        const matchesCounty = countyId ? String(event.countyId) === String(countyId) : true;
        const matchesPrice = Number(event.price) >= Number(minPrice) && Number(event.price) <= Number(maxPrice);
        const term = String(search).toLowerCase();
        const matchesSearch = !term || `${event.title} ${event.summary}`.toLowerCase().includes(term);
        return (event.status === 'published' || event.status === 'approved') && matchesCounty && matchesPrice && matchesSearch;
      });

      payload = filtered.map(buildPublicEvent);
      return res.json({ success: true, data: payload });
    }
  } catch (error) {
    console.error('Error in GET /api/v1/public/events:', error);
    if (res.headersSent) return;
    return res.status(500).json({ success: false, message: error.message || 'Unable to load events.' });
  }
});


app.post('/api/v1/public/events/:id/like', async (req, res) => {
  const eventId = String(req.params.id || '').trim();
  if (!isUuid(eventId)) {
    return res.status(400).json({ success: false, message: 'Invalid event ID.' });
  }

  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  let userId = null;

  if (bearerToken) {
    try {
      const decoded = jwt.verify(bearerToken, config.jwtSecret);
      userId = decoded?.sub || null;
    } catch (_error) {
      userId = null;
    }
  }

  const clientKey = String(req.body?.clientKey || req.headers['x-client-id'] || req.headers['x-client-key'] || req.ip || `anon-${Date.now()}`).trim() || `anon-${Date.now()}`;

  try {
    if (config.databaseUrl) {
      await withSchemaRetry(async () => {
        if (userId) {
          const existing = await query(
            'SELECT id FROM event_likes WHERE event_id = $1 AND user_id = $2 LIMIT 1',
            [eventId, userId],
          );

          if (existing.rows[0]) {
            await query('DELETE FROM event_likes WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
            const count = await query('SELECT COUNT(*)::int AS likes_count FROM event_likes WHERE event_id = $1', [eventId]);
            return res.json({ success: true, likesCount: Number(count.rows[0].likes_count || 0), hasLiked: false });
          }

          await query('INSERT INTO event_likes (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [eventId, userId]);
        } else {
          const existing = await query(
            'SELECT id FROM event_likes WHERE event_id = $1 AND anonymous_key = $2 LIMIT 1',
            [eventId, clientKey],
          );

          if (existing.rows[0]) {
            await query('DELETE FROM event_likes WHERE event_id = $1 AND anonymous_key = $2', [eventId, clientKey]);
            const count = await query('SELECT COUNT(*)::int AS likes_count FROM event_likes WHERE event_id = $1', [eventId]);
            return res.json({ success: true, likesCount: Number(count.rows[0].likes_count || 0), hasLiked: false });
          }

          await query('INSERT INTO event_likes (event_id, anonymous_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [eventId, clientKey]);
        }

        const count = await query('SELECT COUNT(*)::int AS likes_count FROM event_likes WHERE event_id = $1', [eventId]);
        return res.json({ success: true, likesCount: Number(count.rows[0].likes_count || 0), hasLiked: true });
      });
      return;
    }

    const event = events.find((entry) => entry.id === eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    event.interestCount = Number(event.interestCount || 0);
    event.likesCount = Number(event.likesCount || 0);
    const key = userId ? `user:${userId}` : `anon:${clientKey}`;
    const hasLiked = event.likeKeys && event.likeKeys.includes(key);

    if (hasLiked) {
      event.likeKeys = (event.likeKeys || []).filter((entry) => entry !== key);
      event.likesCount = Math.max(0, event.likesCount - 1);
      event.interestCount = event.likesCount;
      return res.json({ success: true, likesCount: event.likesCount, hasLiked: false });
    }

    event.likeKeys = [...new Set([...(event.likeKeys || []), key])];
    event.likesCount = event.likesCount + 1;
    event.interestCount = event.likesCount;
    return res.json({ success: true, likesCount: event.likesCount, hasLiked: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to update event like.' });
  }
});

app.post('/api/v1/public/events', async (req, res) => {
  const {
    title,
    summary,
    description,
    countyId,
    countyName,
    locationText,
    meetingPoint,
    pickupTime,
    googleMapUrl,
    inclusions = [],
    organizerPhone,
    organizerEmail,
    organizerName,
    eventDate,
    startTime,
    endTime,
    price,
    capacity,
    status = 'pending_approval',
    images = [],
  } = req.body;

  const normalizedTitle = String(title || '').trim() || 'Untitled Hike';
  const fallbackDescription = String(description || '').trim() || String(summary || '').trim() || String(title || '').trim() || 'Exciting hike with Twende Hike Kenya';
  const normalizedDescription = String(fallbackDescription || '').trim();
  const normalizedSummary = String(summary || description || normalizedDescription || '').trim() || normalizedDescription;
  const cleanSlug = String(normalizedTitle || 'hike')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'hike';
  const uniqueSlug = `${cleanSlug}-${Date.now().toString(36)}`;

  const normalizedEventDate = eventDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const normalizedStartTime = startTime || '06:00:00';
  const normalizedEndTime = endTime || '14:00:00';
  const normalizedCapacity = Number(capacity) || 30;
  const normalizedPrice = Number(price) || 0;
  let normalizedCountyId = Number(countyId) || null;
  let resolvedCountyName = String(countyName || '').trim();
  const normalizedMeetingPoint = String(meetingPoint || locationText || '').trim();
  const normalizedPickupTime = String(pickupTime || startTime || '').trim();
  const normalizedGoogleMapUrl = String(googleMapUrl || '').trim();
  const normalizedInclusions = parseInclusions(inclusions);
  const normalizedOrganizerPhone = String(organizerPhone || '').trim();
  const normalizedOrganizerEmail = String(organizerEmail || '').trim();
  const normalizedOrganizerName = String(organizerName || '').trim();

  const created = {
    id: uuidv4(),
    organizerId: null,
    countyId: normalizedCountyId,
    title: normalizedTitle,
    slug: uniqueSlug,
    summary: normalizedSummary,
    description: normalizedDescription,
    locationText: String(locationText || '').trim() || resolvedCountyName || 'Unknown location',
    meetingPoint: normalizedMeetingPoint || String(locationText || '').trim() || resolvedCountyName || '',
    pickupTime: normalizedPickupTime,
    googleMapUrl: normalizedGoogleMapUrl,
    inclusions: normalizedInclusions,
    organizerPhone: normalizedOrganizerPhone,
    organizerEmail: normalizedOrganizerEmail,
    organizerName: normalizedOrganizerName,
    latitude: null,
    longitude: null,
    eventDate: normalizedEventDate,
    startTime: normalizedStartTime,
    endTime: normalizedEndTime,
    price: normalizedPrice,
    capacity: normalizedCapacity,
    bookedSlots: 0,
    availableSlots: normalizedCapacity,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    if (config.databaseUrl) {
      if (resolvedCountyName) {
        const countyResult = await query(
          'SELECT id, name FROM counties WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [resolvedCountyName],
        );
        if (!countyResult.rows[0]) {
          return res.status(400).json({ success: false, message: `Unknown county: ${resolvedCountyName}.` });
        }
        normalizedCountyId = Number(countyResult.rows[0].id);
        resolvedCountyName = countyResult.rows[0].name;
        created.countyId = normalizedCountyId;
        created.countyName = resolvedCountyName;
      } else {
        const countyResult = normalizedCountyId
          ? await query('SELECT id, name FROM counties WHERE id = $1 LIMIT 1', [normalizedCountyId])
          : await query('SELECT id, name FROM counties WHERE id = 47 LIMIT 1');
        if (!countyResult.rows[0]) {
          return res.status(400).json({ success: false, message: 'A valid county is required.' });
        }
        normalizedCountyId = Number(countyResult.rows[0].id);
        resolvedCountyName = countyResult.rows[0].name;
        created.countyId = normalizedCountyId;
        created.countyName = resolvedCountyName;
      }

      const organizerId = await resolveEventOrganizerId();
      created.organizerId = organizerId;

      const insert = await query(
        `INSERT INTO events (
          organizer_id, county_id, title, slug, summary, description, location_text,
          meeting_point, pickup_time, google_map_url, inclusions, organizer_phone, organizer_email, organizer_name,
          event_date, start_time, end_time, price, capacity, booked_slots, available_slots, status,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW()) RETURNING *`,
        [
          organizerId,
          normalizedCountyId,
          normalizedTitle,
          created.slug,
          normalizedSummary,
          normalizedDescription,
          created.locationText,
          created.meetingPoint,
          created.pickupTime,
          created.googleMapUrl,
          JSON.stringify(created.inclusions),
          created.organizerPhone,
          created.organizerEmail,
          created.organizerName,
          normalizedEventDate,
          normalizedStartTime,
          normalizedEndTime,
          normalizedPrice,
          normalizedCapacity,
          created.bookedSlots,
          created.availableSlots,
          status,
        ]
      );

      const row = insert.rows[0];
      const saved = {
        ...created,
        id: row.id,
        organizerId: row.organizer_id,
        countyId: Number(row.county_id || normalizedCountyId),
        countyName: resolvedCountyName || null,
          meetingPoint: row.meeting_point || created.meetingPoint,
          pickupTime: row.pickup_time || created.pickupTime,
          googleMapUrl: row.google_map_url || created.googleMapUrl,
          inclusions: parseInclusions(row.inclusions ?? created.inclusions),
          organizerPhone: row.organizer_phone || created.organizerPhone,
          organizerEmail: row.organizer_email || created.organizerEmail,
          organizerName: row.organizer_name || created.organizerName,
        eventDate: row.event_date,
        startTime: row.start_time,
        endTime: row.end_time,
        price: Number(row.price || 0),
        capacity: Number(row.capacity || 0),
        bookedSlots: Number(row.booked_slots || 0),
        availableSlots: Number(row.available_slots || 0),
      };

      const eventImages = Array.isArray(images) ? images.filter(Boolean) : [];
      saved.photos = eventImages;
      saved.image = eventImages[0] || null;
      if (eventImages.length > 0) {
        const imagePlaceholders = eventImages
          .map((_, index) => `($${index * 5 + 1}, $${index * 5 + 2}, $${index * 5 + 3}, $${index * 5 + 4}, $${index * 5 + 5})`)
          .join(', ');

        const imageParams = eventImages.flatMap((image, index) => [row.id, image, null, index === 0, index]);
        await query(`INSERT INTO event_images (event_id, image_url, caption, is_cover, display_order) VALUES ${imagePlaceholders}`, imageParams);
      }

      events.push(saved);
      return res.status(201).json({ success: true, data: saved });
    }

    events.push(created);
    created.photos = Array.isArray(images) ? images.filter(Boolean) : [];
    created.image = created.photos[0] || null;
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Failed to create event', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to create event.' });
  }
});

app.get('/api/v1/public/events/:id', async (req, res) => {
  const eventId = String(req.params.id || '').trim();

  try {
    if (config.databaseUrl && isUuid(eventId)) {
      const result = await query(`
        SELECT
          e.*,
          c.name AS county_name,
          COALESCE(
            json_agg(ei.image_url ORDER BY ei.display_order)
              FILTER (WHERE ei.image_url IS NOT NULL),
            '[]'::json
          ) AS photos,
          (SELECT COUNT(*)::int FROM event_likes el WHERE el.event_id = e.id) AS likes_count
        FROM events e
        LEFT JOIN counties c ON c.id = e.county_id
        LEFT JOIN event_images ei ON ei.event_id = e.id
        WHERE e.id = $1 AND e.status IN ('published', 'approved')
        GROUP BY e.id, c.name
      `, [eventId]);

      if (result.rows[0]) {
        const row = result.rows[0];
        return res.json({
          success: true,
          data: buildPublicEvent({
            ...row,
            organizerId: row.organizer_id,
            countyId: row.county_id,
            eventDate: row.event_date,
            locationText: row.location_text,
            photos: Array.isArray(row.photos) ? row.photos : [],
            image: (Array.isArray(row.photos) && row.photos[0]) || row.cover_image || null,
            likesCount: Number(row.likes_count || 0),
          }),
        });
      }
    }

    const event = events.find((entry) => entry.id === eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    return res.json({ success: true, data: buildPublicEvent(event) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to load event.' });
  }
});

app.delete('/api/v1/admin/events/:id', authMiddleware, requireRoles('super_admin'), async (req, res) => {
  const eventId = String(req.params.id || '').trim();
  if (!isUuid(eventId)) {
    return res.status(400).json({ success: false, message: 'Invalid event ID.' });
  }

  try {
    if (config.databaseUrl) {
      const deleteResult = await withTransaction(async (client) => {
        await client.query('DELETE FROM event_likes WHERE event_id = $1', [eventId]);
        await client.query('DELETE FROM event_images WHERE event_id = $1', [eventId]);
        await client.query('DELETE FROM payments WHERE event_id = $1', [eventId]);
        await client.query('DELETE FROM payouts WHERE event_id = $1', [eventId]);
        await client.query('DELETE FROM bookings WHERE event_id = $1', [eventId]);
        return client.query('DELETE FROM events WHERE id = $1 RETURNING id', [eventId]);
      });

      if (deleteResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Event not found.' });
      }
    } else {
      const eventIndex = events.findIndex((event) => event.id === eventId);
      if (eventIndex < 0) {
        return res.status(404).json({ success: false, message: 'Event not found.' });
      }
      events.splice(eventIndex, 1);
    }

    const eventIndex = events.findIndex((event) => event.id === eventId);
    if (eventIndex >= 0) events.splice(eventIndex, 1);
    for (let index = bookings.length - 1; index >= 0; index -= 1) {
      if (bookings[index].eventId === eventId) bookings.splice(index, 1);
    }
    for (let index = payments.length - 1; index >= 0; index -= 1) {
      if (payments[index].eventId === eventId) payments.splice(index, 1);
    }

    return res.json({ success: true, message: 'Event permanently deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to delete event.' });
  }
});

app.post('/api/v1/auth/register', async (req, res) => {
  const { firstName, lastName, email, phone, password, role = 'hiker' } = req.body;

  if (!firstName || !lastName || !email || !phone || !password) {
    return res.status(400).json({ success: false, message: 'Missing required registration fields.' });
  }

  if (config.databaseUrl) {
    try {
      const existing = await query('SELECT id FROM users WHERE email = $1 OR phone = $2 LIMIT 1', [email, phone]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'A user with that email or phone already exists.' });
      }

      const roleResult = await query('SELECT id FROM roles WHERE name = $1 LIMIT 1', [role]);
      const resolvedRoleId = roleResult.rows[0]?.id || null;

      const userResult = await query(`
        INSERT INTO users (first_name, last_name, email, phone, password_hash, role_id, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, first_name, last_name, email, phone, status
      `, [firstName, lastName, email, phone, bcrypt.hashSync(password, 10), resolvedRoleId, 'active']);

      const user = userResult.rows[0];
      const hydratedUser = {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        role,
      };

      return res.status(201).json({
        success: true,
        data: {
          user: hydratedUser,
          accessToken: signToken(hydratedUser)
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || 'Unable to register user.' });
    }
  }

  const existing = users.find((user) => user.email === email || user.phone === phone);
  if (existing) {
    return res.status(409).json({ success: false, message: 'A user with that email or phone already exists.' });
  }

  const user = {
    id: uuidv4(),
    firstName,
    lastName,
    email,
    phone,
    passwordHash: bcrypt.hashSync(password, 10),
    role
  };

  users.push(user);

  return res.status(201).json({
    success: true,
    data: {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      accessToken: signToken(user)
    }
  });
});

app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  if (config.databaseUrl) {
    try {
      const result = await query(`
        SELECT u.*, r.name AS role
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.email = $1
        LIMIT 1
      `, [email]);
      const user = result.rows[0];

      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      const isValidPassword = bcrypt.compareSync(password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      const hydratedUser = {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        role: user.role || 'super_admin',
      };

      return res.json({
        success: true,
        data: {
          user: hydratedUser,
          accessToken: signToken(hydratedUser)
        }
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || 'Unable to authenticate user.' });
    }
  }

  const user = users.find((entry) => entry.email === email);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }

  const isValidPassword = bcrypt.compareSync(password, user.passwordHash);
  if (!isValidPassword) {
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }

  return res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role
      },
      accessToken: signToken(user)
    }
  });
});

app.patch('/api/v1/admin/password/reset', authMiddleware, requireRoles('super_admin'), async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
  }

  if (config.databaseUrl) {
    try {
      const result = await query('SELECT id, email, password_hash FROM users WHERE id = $1 LIMIT 1', [req.user.sub]);
      const admin = result.rows[0];
      if (!admin) {
        return res.status(404).json({ success: false, message: 'Superadmin account not found.' });
      }
      if (!bcrypt.compareSync(currentPassword, admin.password_hash)) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
      }
      if (String(newPassword).trim().length < 6) {
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
      }
      await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [bcrypt.hashSync(String(newPassword), 10), admin.id]);
      return res.json({ success: true, data: { message: 'Superadmin password updated successfully.', email: admin.email } });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || 'Unable to update superadmin password.' });
    }
  }

  const admin = users.find((user) => user.id === req.user.sub && user.role === 'super_admin');
  if (!admin) {
    return res.status(404).json({ success: false, message: 'Superadmin account not found.' });
  }

  const isValidCurrentPassword = bcrypt.compareSync(currentPassword, admin.passwordHash);
  if (!isValidCurrentPassword) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
  }

  if (String(newPassword).trim().length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
  }

  admin.passwordHash = bcrypt.hashSync(String(newPassword), 10);

  return res.json({
    success: true,
    data: {
      message: 'Superadmin password updated successfully.',
      email: admin.email
    }
  });
});

app.patch('/api/v1/admin/profile', authMiddleware, requireRoles('super_admin'), async (req, res) => {
  const firstName = String(req.body?.firstName || '').trim();
  const lastName = String(req.body?.lastName || '').trim();
  if (!firstName || !lastName) {
    return res.status(400).json({ success: false, message: 'First name and last name are required.' });
  }

  try {
    if (config.databaseUrl) {
      const result = await query(`
        UPDATE users
        SET first_name = $1, last_name = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, first_name, last_name, email, phone
      `, [firstName, lastName, req.user.sub]);
      if (!result.rows[0]) {
        return res.status(404).json({ success: false, message: 'Superadmin account not found.' });
      }
      const row = result.rows[0];
      return res.json({
        success: true,
        data: { user: { id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, role: 'super_admin' } },
      });
    }

    const admin = users.find((user) => user.id === req.user.sub && user.role === 'super_admin');
    if (!admin) {
      return res.status(404).json({ success: false, message: 'Superadmin account not found.' });
    }
    admin.firstName = firstName;
    admin.lastName = lastName;
    return res.json({ success: true, data: { user: { id: admin.id, firstName, lastName, email: admin.email, phone: admin.phone, role: admin.role } } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to update admin profile.' });
  }
});

app.patch('/api/v1/admin/settings', authMiddleware, requireRoles('super_admin'), async (req, res) => {
  const heroImageUrl = String(req.body?.heroImageUrl || '').trim() || null;
  const heroOverlayColor = String(req.body?.heroOverlayColor || '#062d1f').trim();
  const heroHeadline = String(req.body?.heroHeadline || '').trim() || 'Conquer the Aberdares, Longonot & Mt. Kenya.';

  try {
    if (!config.databaseUrl) {
      return res.json({ success: true, data: { heroImageUrl, heroOverlayColor, heroHeadline } });
    }
    const result = await query(`
      INSERT INTO site_settings (id, hero_image_url, hero_overlay_color, hero_headline, updated_at)
      VALUES (1, $1, $2, $3, NOW())
      ON CONFLICT (id) DO UPDATE SET
        hero_image_url = EXCLUDED.hero_image_url,
        hero_overlay_color = EXCLUDED.hero_overlay_color,
        hero_headline = EXCLUDED.hero_headline,
        updated_at = NOW()
      RETURNING hero_image_url, hero_overlay_color, hero_headline
    `, [heroImageUrl, heroOverlayColor, heroHeadline]);
    const row = result.rows[0];
    return res.json({ success: true, data: { heroImageUrl: row.hero_image_url, heroOverlayColor: row.hero_overlay_color, heroHeadline: row.hero_headline } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to update site settings.' });
  }
});

app.put('/api/v1/admin/settings/hero', authMiddleware, requireRoles('super_admin'), async (req, res) => {
  const value = {
    title: String(req.body?.title || '').trim() || 'Conquer the Aberdares, Longonot & Mt. Kenya.',
    subtitle: String(req.body?.subtitle || '').trim() || 'Verified trail captains, licensed KWS rangers, pickup from Nairobi CBD, and seamless booking with Lipa na M-PESA.',
    badge: String(req.body?.badge || '').trim() || "KENYA'S #1 TRAIL MARKETPLACE",
    bg_mode: req.body?.bg_mode === 'image' ? 'image' : 'color',
    image_opacity: Number.isFinite(Number(req.body?.image_opacity)) ? Math.min(1, Math.max(0.1, Number(req.body.image_opacity))) : 0.5,
    bg_image: String(req.body?.bg_image || '').trim(),
    bg_color: String(req.body?.bg_color || '#064e3b').trim(),
  };

  try {
    if (!config.databaseUrl) return res.json({ success: true, data: value });
    const payload = JSON.stringify(value);
    const existing = await query(`SELECT 1 FROM site_settings WHERE key = 'hero'`);
    if (existing.rows.length > 0) {
      await query(`UPDATE site_settings SET value = $1::jsonb, updated_at = NOW() WHERE key = 'hero'`, [payload]);
    } else {
      await query(`INSERT INTO site_settings (key, value, updated_at) VALUES ('hero', $1::jsonb, NOW())`, [payload]);
    }
    return res.json({ success: true, message: 'Hero settings updated successfully', data: { key: 'hero', ...value } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to update hero settings.' });
  }
});

app.get('/api/v1/organizer/dashboard', authMiddleware, requireRoles('organizer'), (req, res) => {
  const organizerId = req.user.sub;
  const organizerEvents = events.filter((event) => event.organizerId === organizerId);

  const metric = organizerEvents.reduce(
    (acc, event) => {
      acc.totalSales += event.bookedSlots;
      acc.totalRevenue += event.price * event.bookedSlots;
      return acc;
    },
    { totalSales: 0, totalRevenue: 0 }
  );

  return res.json({
    success: true,
    data: {
      organizerId,
      metric,
      events: organizerEvents.map(buildPublicEvent)
    }
  });
});

app.post('/api/v1/organizer/events', authMiddleware, requireRoles('organizer'), async (req, res) => {
  const {
    title, summary, description, countyId, countyName, locationText, meetingPoint, pickupTime,
    googleMapUrl, inclusions = [], organizerPhone, organizerEmail, organizerName,
    eventDate, startTime, endTime, price, capacity,
  } = req.body;

  const normalizedTitle = String(title || '').trim() || 'Untitled Hike';
  const fallbackDescription = String(description || '').trim() || String(summary || '').trim() || String(title || '').trim() || 'Exciting hike with Twende Hike Kenya';
  const normalizedDescription = String(fallbackDescription || '').trim();
  const normalizedSummary = String(summary || description || normalizedDescription || '').trim() || normalizedDescription;
  const cleanSlug = String(normalizedTitle || 'hike')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'hike';
  const uniqueSlug = `${cleanSlug}-${Date.now().toString(36)}`;

  const event = {
    id: uuidv4(),
    organizerId: req.user.sub,
    countyId: Number(countyId) || null,
    countyName: String(countyName || '').trim() || null,
    title: normalizedTitle,
    slug: uniqueSlug,
    summary: normalizedSummary,
    description: normalizedDescription,
    locationText: String(locationText || '').trim() || String(countyName || '').trim() || 'Unknown location',
    meetingPoint: String(meetingPoint || locationText || '').trim(),
    pickupTime: String(pickupTime || startTime || '').trim(),
    googleMapUrl: String(googleMapUrl || '').trim(),
    inclusions: parseInclusions(inclusions),
    organizerPhone: String(organizerPhone || '').trim(),
    organizerEmail: String(organizerEmail || '').trim(),
    organizerName: String(organizerName || '').trim(),
    eventDate: eventDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    startTime: startTime || '06:00:00',
    endTime: endTime || '14:00:00',
    price: Number(price) || 0,
    capacity: Number(capacity) || 30,
    bookedSlots: 0,
    availableSlots: Number(capacity) || 30,
    status: 'draft'
  };

  try {
    if (config.databaseUrl) {
      if (event.countyName) {
        const countyResult = await query(
          'SELECT id, name FROM counties WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [event.countyName],
        );
        if (!countyResult.rows[0]) {
          return res.status(400).json({ success: false, message: `Unknown county: ${event.countyName}.` });
        }
        event.countyId = Number(countyResult.rows[0].id);
        event.countyName = countyResult.rows[0].name;
      }
      if (!event.countyId) {
        return res.status(400).json({ success: false, message: 'A valid county is required.' });
      }
      const resolvedOrganizerId = await resolveEventOrganizerId(req.user.sub);
      const insert = await query(`
        INSERT INTO events (
          organizer_id, county_id, title, slug, summary, description, location_text,
          meeting_point, pickup_time, google_map_url, inclusions, organizer_phone, organizer_email, organizer_name,
          event_date, start_time, end_time, price, capacity, booked_slots, available_slots, status,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW())
        RETURNING *
      `, [
        resolvedOrganizerId,
        event.countyId,
        event.title,
        event.slug,
        event.summary,
        event.description,
        event.locationText,
        event.meetingPoint,
        event.pickupTime,
        event.googleMapUrl,
        JSON.stringify(event.inclusions),
        event.organizerPhone,
        event.organizerEmail,
        event.organizerName,
        event.eventDate,
        event.startTime,
        event.endTime,
        event.price,
        event.capacity,
        event.bookedSlots,
        event.availableSlots,
        event.status,
      ]);

      const row = insert.rows[0];
      event.id = row.id;
      event.organizerId = row.organizer_id;
      event.countyId = Number(row.county_id || event.countyId);
      event.eventDate = row.event_date;
      event.startTime = row.start_time;
      event.endTime = row.end_time;
      event.price = Number(row.price || 0);
      event.capacity = Number(row.capacity || 0);
      event.bookedSlots = Number(row.booked_slots || 0);
      event.availableSlots = Number(row.available_slots || 0);
    }

    events.push(event);
    return res.status(201).json({ success: true, data: event });
  } catch (error) {
    console.error('Failed to create organizer event', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to create organizer event.' });
  }
});

app.get('/api/v1/organizer/events/:id/manifest', authMiddleware, requireRoles('organizer'), (req, res) => {
  const eventId = req.params.id;
  const event = events.find((entry) => entry.id === eventId && entry.organizerId === req.user.sub);

  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found or access denied.' });
  }

  const manifest = bookings.filter((booking) => booking.eventId === eventId).map((booking) => ({
    bookingId: booking.id,
    userName: booking.userName,
    phoneNumber: booking.phoneNumber,
    receiptNumber: booking.mpesaReceiptNumber || booking.paymentReference,
    bookedAt: booking.createdAt,
    checkedIn: booking.checkedIn
  }));

  return res.json({ success: true, data: { eventId, manifest } });
});

app.get('/api/v1/admin/events/pending', authMiddleware, requireRoles('super_admin'), (_req, res) => {
  const pending = events.filter((event) => event.status === 'pending_approval');
  return res.json({ success: true, data: pending.map(buildPublicEvent) });
});

app.get('/api/v1/admin/events', authMiddleware, requireRoles('super_admin'), async (_req, res) => {
  try {
    if (!config.databaseUrl) {
      return res.json({ success: true, data: events.map(buildPublicEvent) });
    }
    await autoCompletePastEvents();
    const result = await query(`
      SELECT e.*, c.name AS county_name
      FROM events e
      LEFT JOIN counties c ON c.id = e.county_id
      ORDER BY e.created_at DESC
    `);
    const data = result.rows.map((row) => buildPublicEvent({
      ...row,
      organizerId: row.organizer_id,
      countyId: row.county_id,
      countyName: row.county_name,
      eventDate: row.event_date,
      startTime: row.start_time,
      locationText: row.location_text,
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to load admin events.' });
  }
});

app.patch('/api/v1/admin/events/:id/complete', authMiddleware, requireRoles('super_admin'), async (req, res) => {
  const eventId = String(req.params.id || '').trim();
  if (!isUuid(eventId)) {
    return res.status(400).json({ success: false, message: 'Invalid event ID.' });
  }
  try {
    if (config.databaseUrl) {
      const result = await query(
        `UPDATE events SET status = 'completed', updated_at = NOW() WHERE id = $1 RETURNING id`,
        [eventId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Event not found.' });
      }
    }
    const event = events.find((entry) => entry.id === eventId);
    if (event) event.status = 'completed';
    return res.json({ success: true, message: 'Event marked as completed.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to complete event.' });
  }
});

app.patch('/api/v1/admin/events/:id/review', authMiddleware, requireRoles('super_admin'), async (req, res) => {
  const { decision, notes } = req.body;
  const eventId = String(req.params.id || '').trim();

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ success: false, message: 'Decision must be approved or rejected.' });
  }

  if (!isUuid(eventId)) {
    return res.status(400).json({ success: false, message: 'Invalid event ID. Approvals must use a valid database UUID.' });
  }

  const event = events.find((entry) => entry.id === eventId);

  if (!event) {
    if (config.databaseUrl) {
      try {
        const result = await query(`
          UPDATE events
          SET status = $1,
              admin_notes = $2,
              approved_by = $3,
              approved_at = NOW(),
              updated_at = NOW()
          WHERE id = $4
          RETURNING *
        `, [decision === 'approved' ? 'published' : 'archived', notes || '', users[0].id, eventId]);

        if (result.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Event not found for approval.' });
        }

        return res.json({ success: true, data: result.rows[0] });
      } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Unable to approve event.' });
      }
    }
    return res.status(404).json({ success: false, message: 'Event not found.' });
  }

  event.status = decision === 'approved' ? 'published' : 'archived';
  event.adminNotes = notes || '';

  if (config.databaseUrl) {
    try {
      const result = await query(`
        UPDATE events
        SET status = $1,
            admin_notes = $2,
            approved_by = $3,
            approved_at = NOW(),
            updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `, [event.status, notes || '', users[0].id, event.id]);

      if (result.rows[0]) {
        Object.assign(event, {
          ...event,
          status: result.rows[0].status,
          adminNotes: result.rows[0].admin_notes,
          approvedBy: result.rows[0].approved_by,
          approvedAt: result.rows[0].approved_at,
        });
      }
    } catch (error) {
      console.error('Failed to approve event in database', error);
      return res.status(500).json({ success: false, message: error.message || 'Unable to approve event.' });
    }
  }

  return res.json({ success: true, data: event });
});

app.get('/api/v1/admin/financials/summary', authMiddleware, requireRoles('super_admin'), (_req, res) => {
  const totalRevenue = bookings.reduce((sum, booking) => sum + Number(booking.amount || 0), 0);

  return res.json({
    success: true,
    data: {
      totalRevenue,
      totalBookings: bookings.length,
      totalCommission: totalRevenue * 0.1,
      payoutsPending: 0,
      paidOut: 0
    }
  });
});

app.post('/api/v1/payments/stk-push', authMiddleware, async (req, res) => {
  const { eventId, phoneNumber, amount, quantity = 1 } = req.body;

  if (!eventId || !phoneNumber || !amount) {
    return res.status(400).json({ success: false, message: 'eventId, phoneNumber, and amount are required.' });
  }

  const event = events.find((entry) => entry.id === eventId);
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found.' });
  }

  const bookingId = uuidv4();
  const ticketCode = generateTicketCode();

  const booking = {
    id: bookingId,
    eventId,
    userId: req.user.sub,
    userName: `${req.user.firstName} ${req.user.lastName}`,
    phoneNumber,
    amount: Number(amount),
    pickupLocation: req.body?.pickupLocation || null,
    paymentReference: `THK-${Date.now()}`,
    ticketCode,
    status: 'held',
    createdAt: new Date().toISOString(),
    checkedIn: false,
    mpesaReceiptNumber: null
  };

  bookings.push(booking);

  const stkResult = await initiateStkPush({
    phoneNumber,
    amount: Number(amount),
    bookingId,
    eventTitle: event.title,
    pickupLocation: req.body?.pickupLocation || event.locationText || null
  });

  const payment = {
    id: uuidv4(),
    bookingId,
    userId: req.user.sub,
    eventId,
    provider: 'mpesa',
    amount: Number(amount),
    phoneNumber,
    status: 'initiated',
    checkoutRequestId: stkResult.checkoutRequestID || `stk-${Date.now()}`,
    merchantRequestId: stkResult.merchantRequestID || `mer-${Date.now()}`,
    callbackPayload: null,
    mpesaReceiptNumber: null,
    transactionDate: null,
    createdAt: new Date().toISOString()
  };
  payments.push(payment);

  return res.json({
    success: true,
    data: {
      bookingId,
      ticketCode,
      status: 'held',
      payment: payment,
      mpesa: stkResult
    }
  });
});

app.post('/api/v1/payments/mpesa-callback', async (req, res) => {
  try {
    const callback = handleMpesaCallback(req.body);
    const booking = bookings.find((entry) => entry.paymentReference === callback.merchantRequestId || entry.id === callback.checkoutRequestId);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found for callback transaction.' });
    }

    if (Number(callback.resultCode) !== 0) {
      booking.status = 'cancelled';
      booking.mpesaReceiptNumber = callback.mpesaReceiptNumber || null;
      return res.json({ success: true, message: 'Payment failed or was cancelled. Reservation removed.' });
    }

    booking.status = 'confirmed';
    booking.mpesaReceiptNumber = callback.mpesaReceiptNumber || null;
    booking.checkedIn = false;
    booking.amount = Number(callback.amount || booking.amount);

    const payment = payments.find((entry) => entry.bookingId === booking.id);
    if (payment) {
      payment.status = 'paid';
      payment.mpesaReceiptNumber = callback.mpesaReceiptNumber || null;
      payment.transactionDate = callback.transactionDate || null;
      payment.callbackPayload = callback;
    }

    if (!booking.ticketCode) {
      booking.ticketCode = generateTicketCode();
    }

    return res.json({
      success: true,
      data: {
        bookingId: booking.id,
        ticketCode: booking.ticketCode,
        status: 'confirmed',
        receiptNumber: booking.mpesaReceiptNumber
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Payment callback failed.' });
  }
});

app.get('/api/v1/bookings/:bookingId/ticket.pdf', authMiddleware, async (req, res) => {
  const booking = bookings.find((entry) => entry.id === req.params.bookingId);

  if (!booking) {
    return res.status(404).json({ success: false, message: 'Booking not found.' });
  }

  const event = events.find((entry) => entry.id === booking.eventId);
  const user = users.find((entry) => entry.id === booking.userId) || { firstName: 'Guest', lastName: 'User' };

  const pdfBuffer = await buildTicketPdf({
    ticketCode: booking.ticketCode || generateTicketCode(),
    eventTitle: event?.title || 'Twende Hike Event',
    attendeeName: `${user.firstName} ${user.lastName}`,
    phoneNumber: booking.phoneNumber || user.phone || '+254700000000',
    amount: booking.amount || event?.price || 0,
    bookingId: booking.id,
    eventDate: event?.eventDate || new Date().toISOString()
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ticket-${booking.ticketCode || booking.id}.pdf"`);
  return res.send(pdfBuffer);
});

app.use((req, res) => {
  return res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});

app.listen(config.port, async () => {
  setInterval(autoCompletePastEvents, 60 * 60 * 1000);
  try {
    await ensureDatabaseSchema();
    await seedKenyanCounties();
    await ensureDefaultSuperAdmin();
    await autoCompletePastEvents();
    console.log(`Twende Hike Kenya backend listening on port ${config.port}`);
  } catch (error) {
    console.error('Database bootstrap failed:', error.message || error);
    console.log(`Twende Hike Kenya backend listening on port ${config.port}`);
  }
});
