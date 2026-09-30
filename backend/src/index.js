import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import { config } from './config.js';
import { authMiddleware, requireRoles } from './middleware/auth.js';
import { initiateStkPush, handleMpesaCallback } from './services/mpesaService.js';
import { buildTicketPdf, generateTicketCode } from './services/ticketService.js';
import { query } from './lib/db.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
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
  { id: 1, name: 'Baringo', code: 'BRG' },
  { id: 2, name: 'Bomet', code: 'BMT' },
  { id: 3, name: 'Bungoma', code: 'BNG' },
  { id: 4, name: 'Busia', code: 'BSA' },
  { id: 5, name: 'Elgeyo-Marakwet', code: 'EMK' },
  { id: 6, name: 'Embu', code: 'EMB' },
  { id: 7, name: 'Garissa', code: 'GRS' },
  { id: 8, name: 'Homa Bay', code: 'HBY' },
  { id: 9, name: 'Isiolo', code: 'ISL' },
  { id: 10, name: 'Kajiado', code: 'KJD' },
  { id: 11, name: 'Kakamega', code: 'KKG' },
  { id: 12, name: 'Kericho', code: 'KRC' },
  { id: 13, name: 'Kiambu', code: 'KBU' },
  { id: 14, name: 'Kilifi', code: 'KLF' },
  { id: 15, name: 'Kirinyaga', code: 'KRG' },
  { id: 16, name: 'Kisii', code: 'KSI' },
  { id: 17, name: 'Kisumu', code: 'KSM' },
  { id: 18, name: 'Kitui', code: 'KTI' },
  { id: 19, name: 'Kwale', code: 'KWA' },
  { id: 20, name: 'Laikipia', code: 'LKP' },
  { id: 21, name: 'Lamu', code: 'LAM' },
  { id: 22, name: 'Machakos', code: 'MCK' },
  { id: 23, name: 'Makueni', code: 'MKN' },
  { id: 24, name: 'Mandera', code: 'MDR' },
  { id: 25, name: 'Marsabit', code: 'MSB' },
  { id: 26, name: 'Meru', code: 'MRU' },
  { id: 27, name: 'Migori', code: 'MGR' },
  { id: 28, name: 'Mombasa', code: 'MSA' },
  { id: 29, name: 'Murang\'a', code: 'MRG' },
  { id: 30, name: 'Nairobi', code: 'NBO' },
  { id: 31, name: 'Nakuru', code: 'NKR' },
  { id: 32, name: 'Nandi', code: 'NDI' },
  { id: 33, name: 'Narok', code: 'NRK' },
  { id: 34, name: 'Nyamira', code: 'NYM' },
  { id: 35, name: 'Nyandarua', code: 'NYD' },
  { id: 36, name: 'Nyeri', code: 'NYR' },
  { id: 37, name: 'Samburu', code: 'SMB' },
  { id: 38, name: 'Siaya', code: 'SYA' },
  { id: 39, name: 'Taita-Taveta', code: 'TTV' },
  { id: 40, name: 'Tana River', code: 'TNR' },
  { id: 41, name: 'Tharaka-Nithi', code: 'TNH' },
  { id: 42, name: 'Trans Nzoia', code: 'TNZ' },
  { id: 43, name: 'Turkana', code: 'TRK' },
  { id: 44, name: 'Uasin Gishu', code: 'UGS' },
  { id: 45, name: 'Vihiga', code: 'VHG' },
  { id: 46, name: 'Wajir', code: 'WJR' },
  { id: 47, name: 'West Pokot', code: 'WPK' }
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

  return {
    ...event,
    likesCount,
    interestCount: likesCount,
    county: counties.find((county) => county.id === event.countyId) || null,
    organizer: organizer
      ? {
          id: organizer.id,
          firstName: organizer.firstName,
          lastName: organizer.lastName,
          email: organizer.email,
          role: organizer.role
        }
      : null,
    organizerName: organizer ? `${organizer.firstName} ${organizer.lastName}` : 'Twende Hike Kenya'
  };
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
  res.json({ success: true, data: { status: 'ok', service: 'twendehike-backend' } });
});

app.get('/api/v1/public/counties', (_req, res) => {
  res.json({ success: true, data: counties });
});

app.get('/api/v1/public/events', async (req, res) => {
  const { countyId, minPrice = 0, maxPrice = Number.MAX_SAFE_INTEGER, search = '' } = req.query;

  try {
    let payload = [];

    if (config.databaseUrl) {
      await withSchemaRetry(async () => {
        const likeResult = await query(`
          SELECT event_id, COUNT(*)::int AS likes_count
          FROM event_likes
          GROUP BY event_id
        `);
        const likeMap = new Map(likeResult.rows.map((row) => [row.event_id, Number(row.likes_count || 0)]));

        const result = await query(`
          SELECT e.*, c.name AS county_name
          FROM events e
          LEFT JOIN counties c ON c.id = e.county_id
          WHERE e.status IN ('published', 'approved') AND e.event_date > NOW()
        `);

        const rows = result.rows.map((row) => ({
          ...row,
          likesCount: Number(likeMap.get(row.id) || 0),
          interestCount: Number(likeMap.get(row.id) || 0),
          county: row.county_name ? { id: row.county_id, name: row.county_name } : null,
          organizer: { id: row.organizer_id, firstName: 'Twende', lastName: 'Host', email: '', role: 'organizer' },
          organizerName: 'Twende Host',
          summary: row.summary || row.description || '',
          eventDate: row.event_date,
          startTime: row.start_time,
          endTime: row.end_time,
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
    } else {
      const filtered = events.filter((event) => {
        const matchesCounty = countyId ? String(event.countyId) === String(countyId) : true;
        const matchesPrice = Number(event.price) >= Number(minPrice) && Number(event.price) <= Number(maxPrice);
        const term = String(search).toLowerCase();
        const matchesSearch = !term || `${event.title} ${event.summary}`.toLowerCase().includes(term);
        return (event.status === 'published' || event.status === 'approved') && new Date(event.eventDate) > new Date() && matchesCounty && matchesPrice && matchesSearch;
      });

      payload = filtered.map(buildPublicEvent);
    }

    return res.json({ success: true, data: payload });
  } catch (error) {
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
    locationText,
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
  const normalizedCountyId = Number(countyId) || 1;

  const created = {
    id: uuidv4(),
    organizerId: null,
    countyId: normalizedCountyId,
    title: normalizedTitle,
    slug: uniqueSlug,
    summary: normalizedSummary,
    description: normalizedDescription,
    locationText: locationText || 'Nairobi',
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
      const organizerId = await resolveEventOrganizerId();
      created.organizerId = organizerId;

      const insert = await query(
        `INSERT INTO events (
          organizer_id, county_id, title, slug, summary, description, location_text,
          event_date, start_time, end_time, price, capacity, booked_slots, available_slots, status,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()) RETURNING *`,
        [
          organizerId,
          normalizedCountyId,
          normalizedTitle,
          created.slug,
          normalizedSummary,
          normalizedDescription,
          created.locationText,
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
        eventDate: row.event_date,
        startTime: row.start_time,
        endTime: row.end_time,
        price: Number(row.price || 0),
        capacity: Number(row.capacity || 0),
        bookedSlots: Number(row.booked_slots || 0),
        availableSlots: Number(row.available_slots || 0),
      };

      const eventImages = Array.isArray(images) ? images.filter(Boolean) : [];
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
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Failed to create event', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to create event.' });
  }
});

app.get('/api/v1/public/events/:id', (req, res) => {
  const event = events.find((entry) => entry.id === req.params.id);

  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found.' });
  }

  return res.json({ success: true, data: buildPublicEvent(event) });
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

app.patch('/api/v1/admin/password/reset', authMiddleware, requireRoles('super_admin'), (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
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
  const { title, summary, description, countyId, locationText, eventDate, startTime, endTime, price, capacity } = req.body;

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
    countyId: Number(countyId) || 1,
    title: normalizedTitle,
    slug: uniqueSlug,
    summary: normalizedSummary,
    description: normalizedDescription,
    locationText: locationText || 'Unknown location',
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
      const resolvedOrganizerId = await resolveEventOrganizerId(req.user.sub);
      const insert = await query(`
        INSERT INTO events (
          organizer_id, county_id, title, slug, summary, description, location_text,
          event_date, start_time, end_time, price, capacity, booked_slots, available_slots, status,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
        RETURNING *
      `, [
        resolvedOrganizerId,
        event.countyId,
        event.title,
        event.slug,
        event.summary,
        event.description,
        event.locationText,
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
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});

app.listen(config.port, async () => {
  try {
    await ensureDatabaseSchema();
    await ensureDefaultSuperAdmin();
    console.log(`Twende Hike Kenya backend listening on port ${config.port}`);
  } catch (error) {
    console.error('Database bootstrap failed:', error.message || error);
    console.log(`Twende Hike Kenya backend listening on port ${config.port}`);
  }
});
