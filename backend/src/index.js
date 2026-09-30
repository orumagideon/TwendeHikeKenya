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
app.use(express.json({ limit: '2mb' }));
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

function buildPublicEvent(event) {
  const organizer = users.find((user) => user.id === event.organizerId) || null;

  return {
    ...event,
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
    if (config.databaseUrl) {
      const result = await query(`
        SELECT e.*, c.name AS county_name
        FROM events e
        LEFT JOIN counties c ON c.id = e.county_id
        WHERE e.status IN ('published', 'approved') AND e.event_date > NOW()
      `);

      const rows = result.rows.map((row) => ({
        ...row,
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

      const filtered = rows.filter((event) => {
        const matchesCounty = countyId ? String(event.county_id) === String(countyId) : true;
        const matchesPrice = Number(event.price) >= Number(minPrice) && Number(event.price) <= Number(maxPrice);
        const term = String(search).toLowerCase();
        const matchesSearch = !term || `${event.title} ${event.summary}`.toLowerCase().includes(term);
        return matchesCounty && matchesPrice && matchesSearch;
      });

      return res.json({ success: true, data: filtered.map(buildPublicEvent) });
    }

    const filtered = events.filter((event) => {
      const matchesCounty = countyId ? String(event.countyId) === String(countyId) : true;
      const matchesPrice = Number(event.price) >= Number(minPrice) && Number(event.price) <= Number(maxPrice);
      const term = String(search).toLowerCase();
      const matchesSearch = !term || `${event.title} ${event.summary}`.toLowerCase().includes(term);
      return (event.status === 'published' || event.status === 'approved') && new Date(event.eventDate) > new Date() && matchesCounty && matchesPrice && matchesSearch;
    });

    return res.json({ success: true, data: filtered.map(buildPublicEvent) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to load events.' });
  }
});

app.post('/api/v1/public/events', async (req, res) => {
  const { title, summary, description, countyId, locationText, eventDate, startTime, endTime, price, capacity, status = 'pending_approval' } = req.body;

  if (!title || !description || !eventDate || !startTime || !capacity) {
    return res.status(400).json({ success: false, message: 'Missing required hike fields.' });
  }

  const created = {
    id: uuidv4(),
    organizerId: users[0]?.id || 'system-admin',
    countyId: Number(countyId || 30),
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    summary: summary || '',
    description,
    locationText: locationText || 'Nairobi',
    latitude: null,
    longitude: null,
    eventDate,
    startTime,
    endTime: endTime || null,
    price: Number(price || 0),
    capacity: Number(capacity),
    bookedSlots: 0,
    availableSlots: Number(capacity),
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    if (config.databaseUrl) {
      const insert = await query(
        `INSERT INTO events (
          organizer_id, county_id, title, slug, summary, description, location_text,
          event_date, start_time, end_time, price, capacity, booked_slots, available_slots, status,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()) RETURNING *`,
        [
          created.organizerId,
          created.countyId,
          created.title,
          created.slug,
          created.summary,
          created.description,
          created.locationText,
          created.eventDate,
          created.startTime,
          created.endTime,
          created.price,
          created.capacity,
          created.bookedSlots,
          created.availableSlots,
          status,
        ]
      );

      const row = insert.rows[0];
      const saved = {
        ...created,
        id: row.id,
        eventDate: row.event_date,
        startTime: row.start_time,
        endTime: row.end_time,
        price: Number(row.price || 0),
        capacity: Number(row.capacity || 0),
        bookedSlots: Number(row.booked_slots || 0),
        availableSlots: Number(row.available_slots || 0),
      };
      events.push(saved);
      return res.status(201).json({ success: true, data: saved });
    }

    events.push(created);
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    events.push(created);
    return res.status(201).json({ success: true, data: created, warning: error.message || 'Stored in local fallback mode.' });
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

app.post('/api/v1/organizer/events', authMiddleware, requireRoles('organizer'), (req, res) => {
  const { title, summary, description, countyId, locationText, eventDate, startTime, endTime, price, capacity } = req.body;

  if (!title || !description || !countyId || !eventDate || !startTime || !capacity) {
    return res.status(400).json({ success: false, message: 'Missing required hike fields.' });
  }

  const event = {
    id: uuidv4(),
    organizerId: req.user.sub,
    countyId: Number(countyId),
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    summary: summary || '',
    description,
    locationText: locationText || 'Unknown location',
    eventDate,
    startTime,
    endTime: endTime || null,
    price: Number(price || 0),
    capacity: Number(capacity),
    bookedSlots: 0,
    availableSlots: Number(capacity),
    status: 'draft'
  };

  events.push(event);

  return res.status(201).json({ success: true, data: event });
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
  const event = events.find((entry) => entry.id === req.params.id);

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
        `, [decision === 'approved' ? 'published' : 'archived', notes || '', users[0].id, req.params.id]);
        return res.json({ success: true, data: result.rows[0] || null });
      } catch (error) {
        return res.status(404).json({ success: false, message: 'Event not found.' });
      }
    }
    return res.status(404).json({ success: false, message: 'Event not found.' });
  }

  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ success: false, message: 'Decision must be approved or rejected.' });
  }

  event.status = decision === 'approved' ? 'published' : 'archived';
  event.adminNotes = notes || '';

  if (config.databaseUrl) {
    try {
      await query(`
        UPDATE events
        SET status = $1,
            admin_notes = $2,
            approved_by = $3,
            approved_at = NOW(),
            updated_at = NOW()
        WHERE id = $4
      `, [event.status, notes || '', users[0].id, event.id]);
    } catch (error) {
      // Fallback remains safe in memory if DB updates fail.
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
    eventTitle: event.title
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

app.listen(config.port, () => {
  console.log(`Twende Hike Kenya backend listening on port ${config.port}`);
});
