const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;

// Set timezone to Ulaanbaatar (UTC+8)
process.env.TZ = 'Asia/Ulaanbaatar';

const app = express();
app.use(cors());
app.use(express.json());
// Prevent Safari from caching API responses
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database('barber.db');
db.pragma('journal_mode = WAL');

// ===== SCHEMA =====
db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    tagline TEXT,
    phone TEXT,
    address TEXT,
    instagram TEXT,
    facebook TEXT,
    email TEXT,
    sms_api_key TEXT,
    sms_provider TEXT DEFAULT 'smsmn',
    sms_balance INTEGER DEFAULT 0,
    primary_color TEXT DEFAULT '#1a1a1a',
    accent_color TEXT DEFAULT '#c9a84c',
    logo_url TEXT,
    password_hash TEXT NOT NULL,
    timezone TEXT DEFAULT 'Asia/Ulaanbaatar',
    created_at TEXT DEFAULT (datetime('now')),
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS barbers (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    name TEXT NOT NULL,
    title TEXT,
    specialty TEXT,
    experience TEXT,
    rating REAL DEFAULT 5,
    photo TEXT,
    description TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    description TEXT,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    barber_id TEXT NOT NULL,
    service_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    booking_date TEXT NOT NULL,
    booking_time TEXT NOT NULL,
    status TEXT DEFAULT 'confirmed',
    created_at TEXT DEFAULT (datetime('now')),
    reminded INTEGER DEFAULT 0,
    FOREIGN KEY (shop_id) REFERENCES shops(id),
    FOREIGN KEY (barber_id) REFERENCES barbers(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    name TEXT,
    total_visits INTEGER DEFAULT 1,
    last_visit TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    note TEXT DEFAULT '',
    banned INTEGER DEFAULT 0,
    FOREIGN KEY (shop_id) REFERENCES shops(id),
    UNIQUE(shop_id, phone)
  );

  CREATE TABLE IF NOT EXISTS sms_log (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at TEXT,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS sms_templates (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS queue_entries (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    barber_id TEXT,
    phone TEXT NOT NULL,
    customer_name TEXT DEFAULT '',
    service_name TEXT DEFAULT '',
    position INTEGER NOT NULL,
    status TEXT DEFAULT 'waiting',
    called_at TEXT,
    joined_at TEXT DEFAULT (datetime('now')),
    source TEXT DEFAULT 'qr',
    booking_id TEXT,
    priority INTEGER DEFAULT 0,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS barber_schedules (
    barber_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    PRIMARY KEY (barber_id, day_of_week)
  );
`);

// Migration: add priority column if missing
try { db.prepare("ALTER TABLE queue_entries ADD COLUMN priority INTEGER DEFAULT 0").run(); } catch(e) {/* already exists */}
// Migration: add theme column if missing
try { db.prepare("ALTER TABLE shops ADD COLUMN theme TEXT DEFAULT 'dark'").run(); } catch(e) {/* already exists */}
// Migration: add commission column on barbers if missing
try { db.prepare("ALTER TABLE barbers ADD COLUMN commission INTEGER DEFAULT 50").run(); } catch(e) {/* already exists */}
// Migration: add sms_provider column on shops if missing
try { db.prepare("ALTER TABLE shops ADD COLUMN sms_provider TEXT DEFAULT 'smsmn'").run(); } catch(e) {/* already exists */}
// Migration: add service_id to queue_entries (may 2026)
try { db.prepare("ALTER TABLE queue_entries ADD COLUMN service_id TEXT").run(); } catch(e) {/* already exists */}
// Migration: add avg_service_time to barbers (may 2026)
try { db.prepare("ALTER TABLE barbers ADD COLUMN avg_service_time INTEGER DEFAULT 30").run(); } catch(e) {/* already exists */}
// Migration: add subscription columns to shops (may 2026)
try { db.prepare("ALTER TABLE shops ADD COLUMN sub_status TEXT DEFAULT 'trial'").run(); } catch(e) {}
try { db.prepare("ALTER TABLE shops ADD COLUMN trial_ends_at TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE shops ADD COLUMN sub_ends_at TEXT").run(); } catch(e) {}
// Migration: add owner_name to shops (may 2026)
try { db.prepare("ALTER TABLE shops ADD COLUMN owner_name TEXT").run(); } catch(e) {}
try { db.prepare("ALTER TABLE shops ADD COLUMN sms_remind_today TEXT").run(); } catch(e) {/* already exists */}
try { db.prepare("ALTER TABLE shops ADD COLUMN sms_remind_tomorrow TEXT").run(); } catch(e) {/* already exists */}
try { db.prepare("ALTER TABLE shops ADD COLUMN sms_retention_30 TEXT").run(); } catch(e) {/* already exists */}
try { db.prepare("ALTER TABLE shops ADD COLUMN sms_retention_60 TEXT").run(); } catch(e) {/* already exists */}

// Seed default schedules for barbers without any
const unscheduledBarbers = db.prepare(`SELECT b.id FROM barbers b WHERE b.active = 1 AND NOT EXISTS (SELECT 1 FROM barber_schedules WHERE barber_id = b.id)`).all();
if (unscheduledBarbers.length > 0) {
  const insSch = db.prepare('INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time, active) VALUES (?,?,?,?,1)');
  unscheduledBarbers.forEach(b => {
    for (let d = 1; d <= 6; d++) { insSch.run(b.id, d, '10:00', '20:00'); }
  });
}

// Permanent demo session for barber-pro
const demoSid = db.prepare("SELECT id FROM shops WHERE slug = 'barber-pro'").get()?.id;
if (demoSid) {
  const hasToken = db.prepare("SELECT token FROM sessions WHERE shop_id = ? AND token = 'demo-permanent'").get(demoSid);
  if (!hasToken) {
    db.prepare("INSERT OR IGNORE INTO sessions (token, shop_id) VALUES ('demo-permanent', ?)").run(demoSid);
  }
}

// ===== HELPER =====
function todayLocal() {
  return new Date().toLocaleDateString('en-CA');
}

function requireShop(req, res, next) {
  const slug = req.params.shop || req.query.shop;
  if (!slug) return res.status(400).json({ error: 'shop slug required' });
  const shop = db.prepare("SELECT * FROM shops WHERE slug = ? AND (active = 1 OR sub_status = 'expired')").get(slug);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  req.shop = shop;
  next();
}

// Check if shop's subscription is expired (for page routes)
function isShopExpired(shop) {
  if (!shop) return false;
  if (shop.slug === 'barber-pro') return false; // demo shop never expires
  const today = todayLocal();
  if (shop.sub_status === 'expired') return true;
  if (shop.sub_status === 'trial' && shop.trial_ends_at && shop.trial_ends_at < today) return true;
  if (shop.sub_status === 'active' && shop.sub_ends_at && shop.sub_ends_at < today) return true;
  return false;
}

// Check subscription status — block expired trials/subscriptions
function requireActiveSub(req, res, next) {
  const shop = req.shop;
  if (!shop) return res.status(400).json({ error: 'Shop not loaded' });
  if (shop.slug === 'barber-pro') return next(); // demo never expires
  const today = todayLocal();
  if (shop.sub_status === 'trial' && shop.trial_ends_at && shop.trial_ends_at < today) {
    return res.status(402).json({ error: 'Туршилтын хугацаа дууссан. Үргэлжлүүлэхийн тулд төлбөр хийгээрэй.' });
  }
  if (shop.sub_status === 'expired') {
    return res.status(402).json({ error: 'Данс идэвхгүй байна. Төлбөрөө төлж идэвхжүүлнэ үү.' });
  }
  if (shop.sub_status === 'active' && shop.sub_ends_at && shop.sub_ends_at < today) {
    db.prepare("UPDATE shops SET sub_status = 'expired' WHERE id = ?").run(shop.id);
    return res.status(402).json({ error: 'Таны захиалгын хугацаа дууссан. Сунгахын тул төлбөр хийгээрэй.' });
  }
  next();
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Login required' });
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  req.shop_id = session.shop_id;
  next();
}

// ===== SHOP SIGNUP (self-service) =====
app.post('/api/shop/signup', async (req, res) => {
  const { name, slug, password, phone, plan } = req.body;
  if (!name || !slug || !password) return res.status(400).json({ error: 'Нэр, хаяг, нууц үг шаардлагатай' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Хаяг зөвхөн англи үсэг, тоо, зураас агуулна' });
  if (slug.length < 3) return res.status(400).json({ error: 'Хаяг хамгийн багадаа 3 тэмдэгт байх ёстой' });

  const existing = db.prepare('SELECT id FROM shops WHERE slug = ?').get(slug);
  if (existing) return res.status(409).json({ error: 'Энэ хаяг аль хэдийн бүртгэгдсэн байна' });

  const id = uuidv4().slice(0, 8);
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + 7);
  const trialDate = trialEnds.toLocaleDateString('en-CA');

  db.prepare('INSERT INTO shops (id,name,slug,password_hash,phone,theme,sub_status,trial_ends_at,plan) VALUES (?,?,?,?,?,?,?,?,?)').run(id, name, slug, hash, phone || '', 'dark', 'trial', trialDate, plan || 'pro');

  // Default barbers
  const insB = db.prepare('INSERT INTO barbers (id,shop_id,name,title,specialty,experience,rating,commission) VALUES (?,?,?,?,?,?,?,?)');
  const barberId = uuidv4().slice(0,8);
  insB.run(barberId, id, 'Барбер 1', 'Барбер', 'Үс, сахал', '2+ жил', 5, 50);

  // Default services
  const insS = db.prepare('INSERT INTO services (id,shop_id,name,price,duration) VALUES (?,?,?,?,?)');
  insS.run(uuidv4().slice(0,8), id, '💈 Үс засах', 25000, 30);
  insS.run(uuidv4().slice(0,8), id, '🧔 Сахал засах', 15000, 20);
  insS.run(uuidv4().slice(0,8), id, '🔥 Үс+Сахал', 35000, 45);

  // Default schedule for default barber
  const insSch = db.prepare('INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time, active) VALUES (?,?,?,?,1)');
  for (let d = 1; d <= 6; d++) { insSch.run(barberId, d, '10:00', '20:00'); }

  res.json({ success: true, shop_id: id, slug, name, login_url: `/admin-login?slug=${slug}` });
});

// ===== QUEUE SYSTEM =====

app.post('/api/shop/:shop/queue/join', requireShop, requireActiveSub, (req, res) => {
  const { phone, barber_id, customer_name, service_name, service_id } = req.body;
  if (!phone) return res.status(400).json({ error: 'Утасны дугаар шаардлагатай' });
  const cleaned = phone.replace(/[\s-]/g, '');
  if (cleaned.length < 6) return res.status(400).json({ error: 'Утасны дугаараа зөв оруулна уу' });
  const active = db.prepare("SELECT id, position, status, barber_id, service_name FROM queue_entries WHERE shop_id = ? AND phone = ? AND status IN ('waiting','called')").get(req.shop.id, cleaned);
  if (active) return res.json({ success: true, position: active.position, status: active.status, queue_id: active.id, barber_id: active.barber_id, service: active.service_name, message: 'Та аль хэдийн дараалалд байна' });
  const maxPos = db.prepare("SELECT COALESCE(MAX(position),0) as mp FROM queue_entries WHERE shop_id = ? AND status NOT IN ('done','cancelled')").get(req.shop.id);
  const position = maxPos.mp + 1;
  const id = uuidv4().slice(0, 8);
  db.prepare('INSERT INTO queue_entries (id,shop_id,barber_id,phone,customer_name,service_name,position,source,service_id) VALUES (?,?,?,?,?,?,?,?,?)').run(id, req.shop.id, barber_id || null, cleaned, customer_name || '', service_name || '', position, 'qr', service_id || null);
  wsBroadcast(req.shop.id, { type: 'queue:join', phone: cleaned, position, barber_id: barber_id || null });
  const shop = req.shop;
  res.json({ success: true, queue_id: id, position, message: `Та #${position} байранд байна` });
});

app.get('/api/shop/:shop/queue/status', requireShop, requireActiveSub, (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  const cleaned = phone.replace(/[\s-]/g, '');
  const entry = db.prepare("SELECT id, position, status, joined_at, service_name, service_id, barber_id FROM queue_entries WHERE shop_id = ? AND phone = ? AND status IN ('waiting','called','serving') ORDER BY joined_at DESC LIMIT 1").get(req.shop.id, cleaned);
  if (!entry) return res.json({ inQueue: false });
  const barber = entry.barber_id ? db.prepare("SELECT name FROM barbers WHERE id = ?").get(entry.barber_id) : null;
  const barberFilter = entry.barber_id ? '(barber_id = ? OR barber_id IS NULL)' : 'barber_id IS NULL';
  const barberParam = entry.barber_id || null;
  const ahead = db.prepare(`SELECT COUNT(*) as c FROM queue_entries WHERE shop_id = ? AND position < ? AND status IN ('waiting','called') AND ${barberFilter}`).get(req.shop.id, entry.position, barberParam).c;
  const total = db.prepare(`SELECT COUNT(*) as c FROM queue_entries WHERE shop_id = ? AND status IN ('waiting','called') AND ${barberFilter}`).get(req.shop.id, barberParam).c;
  // Estimated wait: people ahead × barber's average service time (or service duration)
  let avgDuration = 30;
  if (entry.barber_id) {
    const barberTime = db.prepare('SELECT avg_service_time FROM barbers WHERE id = ?').get(entry.barber_id);
    if (barberTime && barberTime.avg_service_time) avgDuration = barberTime.avg_service_time;
  }
  if (avgDuration === 30 && entry.service_id) {
    const svc = db.prepare('SELECT duration FROM services WHERE id = ?').get(entry.service_id);
    if (svc) avgDuration = svc.duration;
  }
  const estimatedMin = ahead * avgDuration;
  res.json({ inQueue: true, position: entry.position, ahead, total, status: entry.status, service: entry.service_name, joined: entry.joined_at, barber_name: barber?.name || null, estimated_min: estimatedMin });
});

app.get('/api/admin/queue', requireAuth, (req, res) => {
  const entries = db.prepare("SELECT q.*, b.name as barber_name, bk.booking_time, s.name as booked_service FROM queue_entries q LEFT JOIN barbers b ON q.barber_id = b.id LEFT JOIN bookings bk ON q.booking_id = bk.id LEFT JOIN services s ON bk.service_id = s.id WHERE q.shop_id = ? AND q.status IN ('waiting','called') AND (q.priority = 0 OR (bk.booking_date || ' ' || bk.booking_time) <= datetime('now','localtime','+30 minutes')) ORDER BY CASE WHEN q.priority > 0 AND (bk.booking_date || ' ' || bk.booking_time) <= datetime('now','localtime','+30 minutes') THEN 0 WHEN q.priority > 0 THEN 2 ELSE 1 END, q.position ASC").all(req.shop_id);
  const serving = db.prepare("SELECT q.*, b.name as barber_name, bk.booking_time, s.name as booked_service FROM queue_entries q LEFT JOIN barbers b ON q.barber_id = b.id LEFT JOIN bookings bk ON q.booking_id = bk.id LEFT JOIN services s ON bk.service_id = s.id WHERE q.shop_id = ? AND q.status = 'serving' ORDER BY q.barber_id").all(req.shop_id);
  const stats = db.prepare("SELECT status, COUNT(*) as c FROM queue_entries WHERE shop_id = ? AND joined_at >= date('now','localtime') GROUP BY status").all(req.shop_id);
  res.json({ queue: entries, serving, stats });
});

app.post('/api/admin/queue/next', requireAuth, (req, res) => {
  const { barber_id, service_id } = req.body;
  let entry;
  if (barber_id) {
    entry = db.prepare("SELECT q.* FROM queue_entries q LEFT JOIN bookings bk ON q.booking_id = bk.id WHERE q.shop_id = ? AND q.barber_id = ? AND q.status = 'waiting' AND (q.priority = 0 OR (bk.booking_date || ' ' || bk.booking_time) <= datetime('now','localtime','+30 minutes')) ORDER BY CASE WHEN q.priority > 0 AND (bk.booking_date || ' ' || bk.booking_time) <= datetime('now','localtime','+30 minutes') THEN 0 WHEN q.priority > 0 THEN 2 ELSE 1 END, q.position ASC LIMIT 1").get(req.shop_id, barber_id);
  }
  if (!entry) {
    entry = db.prepare("SELECT q.* FROM queue_entries q LEFT JOIN bookings bk ON q.booking_id = bk.id WHERE q.shop_id = ? AND q.barber_id IS NULL AND q.status = 'waiting' AND (q.priority = 0 OR (bk.booking_date || ' ' || bk.booking_time) <= datetime('now','localtime','+30 minutes')) ORDER BY CASE WHEN q.priority > 0 AND (bk.booking_date || ' ' || bk.booking_time) <= datetime('now','localtime','+30 minutes') THEN 0 WHEN q.priority > 0 THEN 2 ELSE 1 END, q.position ASC LIMIT 1").get(req.shop_id);
  }
  if (!entry) {
    entry = db.prepare("SELECT q.* FROM queue_entries q LEFT JOIN bookings bk ON q.booking_id = bk.id WHERE q.shop_id = ? AND q.status = 'waiting' AND (q.priority = 0 OR (bk.booking_date || ' ' || bk.booking_time) <= datetime('now','localtime','+30 minutes')) ORDER BY CASE WHEN q.priority > 0 AND (bk.booking_date || ' ' || bk.booking_time) <= datetime('now','localtime','+30 minutes') THEN 0 WHEN q.priority > 0 THEN 2 ELSE 1 END, q.position ASC LIMIT 1").get(req.shop_id);
  }
  if (!entry) {
    // Finish all serving since no one's next
    db.prepare("UPDATE queue_entries SET status = 'done' WHERE shop_id = ? AND status = 'serving' AND barber_id IS NULL").run(req.shop_id);
    if (barber_id) {
      db.prepare("UPDATE queue_entries SET status = 'done' WHERE shop_id = ? AND barber_id = ? AND status = 'serving'").run(req.shop_id, barber_id);
    }
    return res.status(404).json({ error: 'Дараалалд хүн байхгүй' });
  }

  // If service selected, create a booking for revenue tracking
  const useServiceId = service_id || entry.service_id;
  if (useServiceId && !entry.booking_id) {
    const today = todayLocal();
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const bkId = uuidv4().slice(0, 8);
    db.prepare('INSERT INTO bookings (id,shop_id,barber_id,service_id,customer_name,customer_phone,booking_date,booking_time,status) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(bkId, req.shop_id, entry.barber_id || barber_id, useServiceId, entry.customer_name || 'Харилцагч', entry.phone, today, now.slice(0,5), 'confirmed');
    // Link booking to queue entry
    db.prepare('UPDATE queue_entries SET booking_id = ?, service_name = (SELECT name FROM services WHERE id = ?) WHERE id = ?')
      .run(bkId, useServiceId, entry.id);
    // Upsert customer
    const existingC = db.prepare('SELECT id FROM customers WHERE shop_id = ? AND phone = ?').get(req.shop_id, entry.phone);
    if (existingC) {
      db.prepare('UPDATE customers SET total_visits = total_visits + 1, last_visit = ? WHERE shop_id = ? AND phone = ?').run(today, req.shop_id, entry.phone);
    } else {
      db.prepare('INSERT INTO customers (id,shop_id,phone,name,last_visit) VALUES (?,?,?,?,?)').run(uuidv4().slice(0,8), req.shop_id, entry.phone, entry.customer_name || 'Харилцагч', today);
    }
  }

  // Mark previous serving as done
  if (barber_id) {
    db.prepare("UPDATE queue_entries SET status = 'done' WHERE shop_id = ? AND barber_id = ? AND status = 'serving'").run(req.shop_id, barber_id);
  } else {
    db.prepare("UPDATE queue_entries SET status = 'done' WHERE shop_id = ? AND status = 'serving'").run(req.shop_id);
  }
  db.prepare("UPDATE queue_entries SET status = 'serving', called_at = datetime('now','localtime') WHERE id = ?").run(entry.id);
  wsBroadcast(req.shop_id, { type: 'queue:next', phone: entry.phone, name: entry.customer_name, barber_id });
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop_id);
  if (shop?.sms_api_key) {
    sendSms(shop, entry.phone, 'Таны ээлж ирлээ! 2 минутын дотор ирнэ үү.');
  }
  res.json({ success: true, phone: entry.phone, customer_name: entry.customer_name, id: entry.id });
});

app.post('/api/admin/queue/skip', requireAuth, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });
  db.prepare("UPDATE queue_entries SET status = 'skipped' WHERE id = ? AND shop_id = ?").run(id, req.shop_id);
  wsBroadcast(req.shop_id, { type: 'queue:change' });
  res.json({ success: true });
});

app.post('/api/admin/queue/add', requireAuth, (req, res) => {
  const { phone, customer_name, barber_id, service_name } = req.body;
  if (!phone) return res.status(400).json({ error: 'Утасны дугаар шаардлагатай' });
  const cleaned = phone.replace(/[\s-]/g, '');
  const maxPos = db.prepare("SELECT COALESCE(MAX(position),0) as mp FROM queue_entries WHERE shop_id = ? AND status NOT IN ('done','cancelled')").get(req.shop_id);
  const position = maxPos.mp + 1;
  const id = uuidv4().slice(0, 8);
  db.prepare('INSERT INTO queue_entries (id,shop_id,barber_id,phone,customer_name,service_name,position,source) VALUES (?,?,?,?,?,?,?,?)').run(id, req.shop_id, barber_id || null, cleaned, customer_name || '', service_name || '', position, 'manual');
  wsBroadcast(req.shop_id, { type: 'queue:change' });
  res.json({ success: true, id, position });
});

app.post('/api/admin/queue/remove', requireAuth, (req, res) => {
  const { id, status } = req.body;
  db.prepare("UPDATE queue_entries SET status = ? WHERE id = ? AND shop_id = ?").run(status || 'cancelled', id, req.shop_id);
  wsBroadcast(req.shop_id, { type: 'queue:change' });
  res.json({ success: true });
});

// ===== PUBLIC QUEUE OVERVIEW (no auth, no phone, read-only) =====
app.get('/api/shop/:shop/queue-overview', requireShop, requireActiveSub, (req, res) => {
  const today = todayLocal();
  const barbers = db.prepare('SELECT id, name, title FROM barbers WHERE shop_id = ? AND active = 1').all(req.shop.id);

  const overview = barbers.map(b => {
    const waiting = db.prepare("SELECT COUNT(*) as c FROM queue_entries WHERE shop_id = ? AND barber_id = ? AND status = 'waiting'").get(req.shop.id, b.id).c;
    const serving = db.prepare("SELECT q.customer_name FROM queue_entries q WHERE q.shop_id = ? AND q.barber_id = ? AND q.status = 'serving' LIMIT 1").get(req.shop.id, b.id);
    // Include unassigned (barber_id IS NULL) waiting customers for shops where barber picks up any
    const unassigned = db.prepare("SELECT COUNT(*) as c FROM queue_entries WHERE shop_id = ? AND barber_id IS NULL AND status = 'waiting'").get(req.shop.id).c;

    // Average service duration for wait estimation
    const avgDuration = db.prepare('SELECT COALESCE(ROUND(AVG(duration)), 30) as d FROM services WHERE shop_id = ?').get(req.shop.id).d;
    const estMin = (waiting + (barbers.length === 1 ? unassigned : 0)) * avgDuration;

    return {
      id: b.id,
      name: b.name,
      title: b.title || '',
      waiting,
      serving: serving?.customer_name || null,
      estimated_min: estMin
    };
  });

  // Calculate totals
  const totalWaiting = overview.reduce((s, b) => s + b.waiting, 0);
  const totalServing = overview.filter(b => b.serving).length;
  const shop = req.shop;

  res.json({
    shop_name: shop.name,
    shop_slug: shop.slug,
    total_waiting: totalWaiting,
    total_serving: totalServing,
    barbers: overview,
    updated_at: new Date().toLocaleTimeString('mn-MN', { hour: '2-digit', minute: '2-digit' })
  });
});

// ===== SHOP PUBLIC API =====
app.get('/api/shop/:shop', requireShop, requireActiveSub, (req, res) => {
  const { password_hash, sms_api_key, sms_provider, sms_balance, ...safe } = req.shop;
  res.json(safe);
});

// Public live stats for landing page
app.get('/api/stats/live', (req, res) => {
  const shops = db.prepare('SELECT COUNT(*) as c FROM shops WHERE active = 1').get().c;
  const inQueue = db.prepare("SELECT COUNT(*) as c FROM queue_entries WHERE status IN ('waiting','called','serving')").get().c;
  const todayBookings = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE booking_date = date('now','localtime') AND status = 'confirmed'").get().c;
  res.json({ shops, inQueue, todayBookings });
});

// Get barbers for a shop
app.get('/api/shop/:shop/barbers', requireShop, requireActiveSub, (req, res) => {
  const barbers = db.prepare('SELECT id,name,title,specialty,experience,rating,description FROM barbers WHERE shop_id = ? AND active = 1').all(req.shop.id);
  res.json(barbers);
});

// Public barber queue — no admin auth needed
app.get('/api/shop/:shop/barber/queue', requireShop, requireActiveSub, (req, res) => {
  const { barber_id } = req.query;
  if (!barber_id) return res.status(400).json({ error: 'barber_id required' });
  const queue = db.prepare("SELECT q.*, b.name as barber_name, bk.booking_time, s.name as booked_service FROM queue_entries q LEFT JOIN barbers b ON q.barber_id = b.id LEFT JOIN bookings bk ON q.booking_id = bk.id LEFT JOIN services s ON bk.service_id = s.id WHERE q.shop_id = ? AND (q.barber_id = ? OR q.barber_id IS NULL) AND q.status IN ('waiting','called') ORDER BY q.position ASC").all(req.shop.id, barber_id);
  const serving = db.prepare("SELECT q.*, b.name as barber_name, bk.booking_time, s.name as booked_service FROM queue_entries q LEFT JOIN barbers b ON q.barber_id = b.id LEFT JOIN bookings bk ON q.booking_id = bk.id LEFT JOIN services s ON bk.service_id = s.id WHERE q.shop_id = ? AND (q.barber_id = ? OR q.barber_id IS NULL) AND q.status = 'serving' ORDER BY q.barber_id").all(req.shop.id, barber_id);
  res.json({ queue, serving });
});

app.post('/api/shop/:shop/barber/queue/next', requireShop, requireActiveSub, (req, res) => {
  const { barber_id, service_id } = req.body;
  if (!barber_id) return res.status(400).json({ error: 'barber_id required' });
  let entry = db.prepare("SELECT q.* FROM queue_entries q WHERE q.shop_id = ? AND q.barber_id = ? AND q.status = 'waiting' ORDER BY q.position ASC LIMIT 1").get(req.shop.id, barber_id);
  if (!entry) entry = db.prepare("SELECT q.* FROM queue_entries q WHERE q.shop_id = ? AND q.barber_id IS NULL AND q.status = 'waiting' ORDER BY q.position ASC LIMIT 1").get(req.shop.id);
  if (!entry) return res.status(404).json({ error: 'Дараалалд хүн байхгүй' });
  const useServiceId = service_id || entry.service_id;
  if (useServiceId && !entry.booking_id) {
    const today = todayLocal();
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const bkId = uuidv4().slice(0, 8);
    db.prepare('INSERT INTO bookings (id,shop_id,barber_id,service_id,customer_name,customer_phone,booking_date,booking_time,status) VALUES (?,?,?,?,?,?,?,?,?)').run(bkId, req.shop.id, barber_id, useServiceId, entry.customer_name || 'Харилцагч', entry.phone, today, now, 'confirmed');
    db.prepare('UPDATE queue_entries SET booking_id = ?, service_name = (SELECT name FROM services WHERE id = ?) WHERE id = ?').run(bkId, useServiceId, entry.id);
  }
  db.prepare("UPDATE queue_entries SET status = 'done' WHERE shop_id = ? AND barber_id = ? AND status = 'serving'").run(req.shop.id, barber_id);
  db.prepare("UPDATE queue_entries SET status = 'serving', called_at = datetime('now','localtime') WHERE id = ?").run(entry.id);
  wsBroadcast(req.shop.id, { type: 'queue:next', phone: entry.phone, name: entry.customer_name, barber_id });
  wsBroadcast(req.shop.id, { type: 'queue:change' });
  res.json({ success: true, phone: entry.phone, customer_name: entry.customer_name, id: entry.id });
});

// Get services for a shop
app.get('/api/shop/:shop/services', requireShop, requireActiveSub, (req, res) => {
  const services = db.prepare('SELECT id,name,price,duration FROM services WHERE shop_id = ?').all(req.shop.id);
  res.json(services);
});

// Get available slots for a shop
app.get('/api/shop/:shop/slots', requireShop, requireActiveSub, (req, res) => {
  const { date, barber_id } = req.query;
  if (!date || !barber_id) return res.status(400).json({ error: 'date and barber_id required' });
  const dayOfWeek = new Date(date + 'T00:00:00').getDay();
  const schedule = db.prepare('SELECT start_time, end_time FROM barber_schedules WHERE barber_id = ? AND day_of_week = ? AND active = 1').get(barber_id, dayOfWeek);
  if (!schedule) return res.json({ slots: [], message: 'Амарна' });

  const booked = db.prepare("SELECT booking_time FROM bookings WHERE shop_id = ? AND barber_id = ? AND booking_date = ? AND status = 'confirmed'").all(req.shop.id, barber_id, date).map(b => b.booking_time);

  const slots = [];
  const [sh, sm] = schedule.start_time.split(':').map(Number);
  const [eh, em] = schedule.end_time.split(':').map(Number);
  let h = sh, m = sm;
  while (h < eh || (h === eh && m < em)) {
    const t = String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
    if (!booked.includes(t)) slots.push(t);
    m += 30;
    if (m >= 60) { h++; m -= 60; }
  }
  res.json({ slots, workingHours: schedule.start_time + ' - ' + schedule.end_time });
});

// Create booking
app.post('/api/shop/:shop/book', requireShop, requireActiveSub, (req, res) => {
  const { barber_id, service_id, customer_name, customer_phone, booking_date, booking_time } = req.body;
  if (!barber_id || !service_id || !customer_name || !customer_phone || !booking_date || !booking_time) {
    return res.status(400).json({ error: 'Бүх талбарыг бөглөнө үү' });
  }

  const existing = db.prepare('SELECT id FROM bookings WHERE shop_id = ? AND booking_date = ? AND booking_time = ? AND barber_id = ? AND status = ?')
    .get(req.shop.id, booking_date, booking_time, barber_id, 'confirmed');
  if (existing) return res.status(409).json({ error: 'Энэ цаг аль хэдийн захиалсан' });

  // Reject past bookings
  const bookingDT = new Date(booking_date + 'T' + booking_time);
  const now = new Date();
  if (bookingDT < now) return res.status(400).json({ error: 'Энэ цаг аль хэдийн өнгөрсөн. Өөр цаг сонгоно уу.' });

  // Same phone, same date — only block if existing booking hasn't passed yet
  const dupPhone = db.prepare("SELECT id, booking_time FROM bookings WHERE shop_id = ? AND customer_phone = ? AND booking_date = ? AND status = 'confirmed'").get(req.shop.id, customer_phone, booking_date);
  if (dupPhone) {
    const dupDT = new Date(booking_date + 'T' + dupPhone.booking_time);
    if (dupDT > now) return res.status(409).json({ error: `Та ${booking_date} өдөр ${dupPhone.booking_time} цагт захиалгатай байна. Давхар захиалга хийх боломжгүй.` });
  }

  // Check if banned
  const banned = db.prepare('SELECT id FROM customers WHERE shop_id = ? AND phone = ? AND banned = 1').get(req.shop.id, customer_phone);
  if (banned) return res.status(403).json({ error: 'Таны дугаар хаагдсан байна. Дэлгүүртэй холбогдоно уу' });

  const id = uuidv4().slice(0, 8);
  db.prepare('INSERT INTO bookings (id,shop_id,barber_id,service_id,customer_name,customer_phone,booking_date,booking_time,status) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.shop.id, barber_id, service_id, customer_name, customer_phone, booking_date, booking_time, 'confirmed');

  const existingC = db.prepare('SELECT id FROM customers WHERE shop_id = ? AND phone = ?').get(req.shop.id, customer_phone);
  if (existingC) {
    db.prepare('UPDATE customers SET total_visits = total_visits + 1, last_visit = ? WHERE shop_id = ? AND phone = ?').run(booking_date, req.shop.id, customer_phone);
  } else {
    db.prepare('INSERT INTO customers (id,shop_id,phone,name,last_visit) VALUES (?,?,?,?,?)').run(uuidv4().slice(0,8), req.shop.id, customer_phone, customer_name, booking_date);
  }

  // Auto-join queue with priority
  const maxQ = db.prepare("SELECT COALESCE(MAX(position),0) as mp FROM queue_entries WHERE shop_id = ? AND status NOT IN ('done','cancelled')").get(req.shop.id);
  const qid = uuidv4().slice(0, 8);
  db.prepare('INSERT INTO queue_entries (id,shop_id,barber_id,phone,customer_name,service_name,position,source,booking_id,priority) VALUES (?,?,?,?,?,?,?,?,?,1)')
    .run(qid, req.shop.id, barber_id, customer_phone, customer_name, '', maxQ.mp + 1, 'booking', id);

  wsBroadcast(req.shop.id, { type: 'booking:new', booking_id: id, barber_id, customer_name, time: booking_time });
  wsBroadcast(req.shop.id, { type: 'queue:change' });
  res.json({ success: true, booking_id: id, message: 'Захиалга амжилттай!', shop_slug: req.shop.slug });
});

// Public cancel — verify by phone
app.post('/api/shop/:shop/cancel', requireShop, requireActiveSub, (req, res) => {
  const { booking_id, phone } = req.body;
  if (!booking_id || !phone) return res.status(400).json({ error: 'Захиалгын ID болон утасны дугаар шаардлагатай' });
  const cleaned = phone.replace(/[\s-]/g, '');
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ? AND shop_id = ? AND customer_phone = ? AND status = 'confirmed'").get(booking_id, req.shop.id, cleaned);
  if (!booking) return res.status(404).json({ error: 'Захиалга олдсонгүй эсвэл аль хэдийн цуцлагдсан' });
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking_id);
  // Also cancel the queue entry
  db.prepare("UPDATE queue_entries SET status = 'cancelled' WHERE booking_id = ?").run(booking_id);
  wsBroadcast(req.shop.id, { type: 'queue:change' });
  res.json({ success: true, message: 'Захиалга цуцлагдлаа' });
});

// ===== AUTH API =====

// Login
app.post('/api/auth/login', (req, res) => {
  const { slug, password } = req.body;
  const shop = db.prepare('SELECT * FROM shops WHERE slug = ?').get(slug);
  if (!shop) return res.status(401).json({ error: 'Буруу холбоос эсвэл нууц үг' });

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== shop.password_hash) return res.status(401).json({ error: 'Буруу нууц үг' });

  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, shop_id) VALUES (?,?)').run(token, shop.id);
  res.json({ token, shop_id: shop.id, shop_name: shop.name, slug: shop.slug, sub_status: shop.sub_status, plan: shop.plan || 'pro' });
});

// ===== ADMIN API (authenticated) =====

// Dashboard stats
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const today = todayLocal();
  const sid = req.shop_id;

  const todayConfirmed = db.prepare('SELECT COUNT(*) as c FROM bookings WHERE shop_id = ? AND booking_date = ? AND status = ?').get(sid, today, 'confirmed').c;
  const totalConfirmed = db.prepare('SELECT COUNT(*) as c FROM bookings WHERE shop_id = ? AND status = ?').get(sid, 'confirmed').c;
  const customerCount = db.prepare('SELECT COUNT(*) as c FROM customers WHERE shop_id = ?').get(sid).c;
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(s.price),0) as t FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.status = ?').get(sid, 'confirmed').t;

  res.json({ todayBookings: todayConfirmed, totalBookings: totalConfirmed, customers: customerCount, revenue: totalRevenue });
});

// Get bookings
app.get('/api/admin/bookings', requireAuth, (req, res) => {
  const { date } = req.query;
  const sql = date
    ? `SELECT b.*, br.name as barber_name, s.name as service_name, s.price FROM bookings b JOIN barbers br ON b.barber_id = br.id JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.booking_date = ? ORDER BY b.booking_time DESC`
    : `SELECT b.*, br.name as barber_name, s.name as service_name, s.price FROM bookings b JOIN barbers br ON b.barber_id = br.id JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? ORDER BY b.booking_date DESC, b.booking_time`;
  const params = date ? [req.shop_id, date] : [req.shop_id];
  res.json(db.prepare(sql).all(...params));
});

// Get customers
app.get('/api/admin/customers', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM customers WHERE shop_id = ? ORDER BY last_visit DESC').all(req.shop_id));
});

// SMS — Get status (API key + provider)
app.get('/api/admin/sms/status', requireAuth, (req, res) => {
  const shop = db.prepare('SELECT sms_api_key, sms_provider, sms_balance FROM shops WHERE id = ?').get(req.shop_id);
  res.json({ 
    connected: !!shop?.sms_api_key,
    provider: shop?.sms_provider || 'smsmn',
    balance: shop?.sms_balance || 0,
    masking: shop?.sms_api_key ? shop.sms_api_key.slice(0,8) + '****' : null
  });
});

// SMS — Save API key + provider
app.post('/api/admin/sms/update-key', requireAuth, (req, res) => {
  const { api_key, provider } = req.body;
  if (!api_key) return res.status(400).json({ error: 'API түлхүүрээ оруулна уу' });
  db.prepare('UPDATE shops SET sms_api_key = ?, sms_provider = ? WHERE id = ?').run(api_key, provider || 'smsmn', req.shop_id);
  res.json({ success: true, message: 'API түлхүүр хадгалагдлаа' });
});

// SMS — Send to all customers
app.post('/api/admin/sms/send', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Мессежээ оруулна уу' });

  const shop = db.prepare('SELECT sms_api_key, sms_provider FROM shops WHERE id = ?').get(req.shop_id);
  if (!shop?.sms_api_key) return res.status(400).json({ error: 'Эхлээд API түлхүүрээ оруулна уу' });

  const customers = db.prepare('SELECT phone, name FROM customers WHERE shop_id = ?').all(req.shop_id);
  if (customers.length === 0) return res.status(400).json({ error: 'Харилцагч байхгүй байна' });

  const results = [];
  const ins = db.prepare('INSERT INTO sms_log (id,shop_id,customer_phone,message,status) VALUES (?,?,?,?,?)');

  for (const c of customers) {
    try {
      const ok = await sendSms(shop, c.phone, message);
      ins.run(uuidv4().slice(0,8), req.shop_id, c.phone, message, ok ? 'sent' : 'failed');
      results.push({ phone: c.phone, ok });
    } catch(e) {
      ins.run(uuidv4().slice(0,8), req.shop_id, c.phone, message, 'failed');
      results.push({ phone: c.phone, ok: false });
    }
  }

  const sent = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  res.json({ success: true, sent, failed, total: results.length, message: `${sent} амжилттай, ${failed} амжилтгүй` });
});

// SMS — Send test to own number
app.post('/api/admin/sms/test', requireAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Утасны дугаараа оруулна уу' });

  const shop = db.prepare('SELECT sms_api_key, sms_provider FROM shops WHERE id = ?').get(req.shop_id);
  if (!shop?.sms_api_key) return res.status(400).json({ error: 'Эхлээд API түлхүүрээ оруулна уу' });

  const ok = await sendSms(shop, phone, 'Barber Pro систем амжилттай холбогдлоо! Таны харилцагчид SMS хүлээн авах боломжтой боллоо.');
  if (ok) return res.json({ success: true, message: 'Тест SMS амжилттай илгээгдлээ!' });
  res.status(400).json({ error: 'SMS илгээхэд алдаа гарлаа. API түлхүүрээ шалгана уу.' });
});

// ===== SMS HELPER =====
// Unified SMS sender — supports sms.mn (SMS Gateway MN) and MoceanSMS
async function sendSms(shop, phone, message) {
  const provider = shop.sms_provider || 'smsmn';
  const key = shop.sms_api_key || '';
  const cleanedPhone = phone.toString().replace(/[\s-]/g, '');
  
  try {
    if (provider === 'smsmn') {
      // SMS Gateway MN (sms.mn) — local Mongolian provider
      const resp = await fetch('https://api.sms.mn/v1/send', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: cleanedPhone.startsWith('+') ? cleanedPhone : '+976' + cleanedPhone, message })
      });
      const data = await resp.json();
      return data.success === true || data.status === 'sent';
    } else {
      // MoceanSMS (legacy) — key stored as "api_key:api_secret"
      const params = new URLSearchParams({
        'mocean-api-key': key.split(':')[0] || key,
        'mocean-api-secret': key.split(':')[1] || '',
        'mocean-from': 'BarberPro',
        'mocean-to': cleanedPhone,
        'mocean-text': message
      });
      const resp = await fetch('https://rest.moceanapi.com/rest/1/sms', { method: 'POST', body: params });
      const data = await resp.json();
      return data.status === 0;
    }
  } catch(e) { return false; }
}

// ===== ANALYTICS =====
app.get('/api/admin/analytics', requireAuth, (req, res) => {
  const today = todayLocal();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartStr = weekStart.toLocaleDateString('en-CA');

  const todayBookings = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(s.price),0) as rev FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.booking_date = ? AND b.status = ?').get(req.shop_id, today, 'confirmed');
  const todayQueueServed = db.prepare("SELECT COUNT(*) as c FROM queue_entries WHERE shop_id = ? AND joined_at >= date('now','localtime') AND status IN ('serving','done')").get(req.shop_id).c;

  const weekly = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toLocaleDateString('en-CA');
    const r = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(s.price),0) as rev FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.booking_date = ? AND b.status = ?').get(req.shop_id, ds, 'confirmed');
    weekly.push({ date: ds, bookings: r.c, revenue: r.rev });
  }

  const topServices = db.prepare('SELECT s.name, COUNT(*) as c, COALESCE(SUM(s.price),0) as rev FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.booking_date >= ? AND b.status = ? GROUP BY s.name ORDER BY c DESC LIMIT 5').all(req.shop_id, weekStartStr, 'confirmed');

  const peakHours = db.prepare("SELECT booking_time, COUNT(*) as c FROM bookings WHERE shop_id = ? AND booking_date >= ? AND status = ? GROUP BY booking_time ORDER BY c DESC LIMIT 8").all(req.shop_id, weekStartStr, 'confirmed');

  const barberPerf = db.prepare('SELECT br.name, COUNT(*) as bookings, COALESCE(SUM(s.price),0) as revenue, COALESCE(ROUND(SUM(s.price) * br.commission / 100),0) as earnings FROM bookings b JOIN barbers br ON b.barber_id = br.id JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.booking_date >= ? AND b.status = ? GROUP BY br.name ORDER BY bookings DESC').all(req.shop_id, weekStartStr, 'confirmed');

  const totalBookings = db.prepare('SELECT COUNT(*) as c FROM bookings WHERE shop_id = ? AND status = ?').get(req.shop_id, 'confirmed').c;
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(s.price),0) as rev FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.status = ?').get(req.shop_id, 'confirmed').rev;
  const totalCustomers = db.prepare('SELECT COUNT(DISTINCT phone) as c FROM customers WHERE shop_id = ?').get(req.shop_id).c;

  res.json({
    today: { bookings: todayBookings.c, revenue: todayBookings.rev, avgTicket: todayBookings.c > 0 ? Math.round(todayBookings.rev / todayBookings.c) : 0, queueServed: todayQueueServed },
    weekly, topServices, peakHours, barberPerf,
    totals: { bookings: totalBookings, revenue: totalRevenue, customers: totalCustomers }
  });
});

// ===== AUTO SMS — Send reminders for tomorrow's bookings =====
app.post('/api/admin/sms/remind-tomorrow', requireAuth, async (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop_id);
  if (!shop?.sms_api_key) return res.status(400).json({ error: 'Эхлээд SMS тохиргоогоо хийнэ үү' });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toLocaleDateString('en-CA');

  const bookings = db.prepare(`SELECT b.*, br.name as barber_name, s.name as service_name FROM bookings b JOIN barbers br ON b.barber_id = br.id JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.booking_date = ? AND b.status = ? AND b.reminded = 0`).all(req.shop_id, dateStr, 'confirmed');

  if (bookings.length === 0) return res.json({ success: true, sent: 0, message: 'Маргааш захиалга байхгүй эсвэл бүгд сануулсан' });

  let sent = 0;
  const upd = db.prepare('UPDATE bookings SET reminded = 1 WHERE id = ?');
  const log = db.prepare('INSERT INTO sms_log (id,shop_id,customer_phone,message,status) VALUES (?,?,?,?,?)');
  const template = shop.sms_remind_tomorrow || 'Сайн уу {name}? Маргааш {time} цагт "{service}" үйлчилгээнд {barber} таныг хүлээж байна.';

  for (const b of bookings) {
    const msg = template.replace('{name}', b.customer_name).replace('{time}', b.booking_time).replace('{service}', b.service_name).replace('{barber}', b.barber_name).replace('{shop}', shop.name);
    const ok = await sendSms(shop, b.customer_phone, msg);
    log.run(uuidv4().slice(0,8), req.shop_id, b.customer_phone, msg, ok ? 'sent' : 'failed');
    if (ok) { upd.run(b.id); sent++; }
  }

  res.json({ success: true, sent, total: bookings.length, message: `${sent}/${bookings.length} сануулага илгээгдлээ` });
});

// ===== AUTO SMS — Manually remind today's remaining unreminded bookings =====
app.post('/api/admin/sms/remind-today', requireAuth, async (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop_id);
  if (!shop?.sms_api_key) return res.status(400).json({ error: 'Эхлээд SMS тохиргоогоо хийнэ үү' });

  const today = todayLocal();
  const bookings = db.prepare(`SELECT b.*, br.name as barber_name, s.name as service_name FROM bookings b JOIN barbers br ON b.barber_id = br.id JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.booking_date = ? AND b.status = ? AND b.reminded = 0`).all(req.shop_id, today, 'confirmed');

  if (bookings.length === 0) return res.json({ success: true, sent: 0, message: 'Өнөөдөр сануулаагүй захиалга байхгүй' });

  let sent = 0;
  const upd = db.prepare('UPDATE bookings SET reminded = 1 WHERE id = ?');
  const log = db.prepare('INSERT INTO sms_log (id,shop_id,customer_phone,message,status) VALUES (?,?,?,?,?)');
  const template = shop.sms_remind_today || 'Сайн уу {name}? Таны {time} цагийн "{service}" захиалга баталгаажсан. {barber} таныг хүлээж байна.';

  for (const b of bookings) {
    const msg = template.replace('{name}', b.customer_name).replace('{time}', b.booking_time).replace('{service}', b.service_name).replace('{barber}', b.barber_name).replace('{shop}', shop.name);
    const ok = await sendSms(shop, b.customer_phone, msg);
    log.run(uuidv4().slice(0,8), req.shop_id, b.customer_phone, msg, ok ? 'sent' : 'failed');
    if (ok) { upd.run(b.id); sent++; }
  }

  res.json({ success: true, sent, total: bookings.length, message: `${sent}/${bookings.length} сануулага илгээгдлээ` });
});

// ===== AUTO SMS — Retention: nudge customers who haven't visited in 30+ days =====
app.post('/api/admin/sms/retention', requireAuth, async (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop_id);
  if (!shop?.sms_api_key) return res.status(400).json({ error: 'Эхлээд SMS тохиргоогоо хийнэ үү' });

  const days = req.body.days || 30;
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - days);
  const dateStr = threshold.toLocaleDateString('en-CA');

  // Only send to customers who have NEVER received a retention SMS, or haven't received one in 60+ days
  const staleCustomers = db.prepare(`SELECT * FROM customers WHERE shop_id = ? AND last_visit IS NOT NULL AND last_visit < ? AND banned = 0 AND (retention_sent_at IS NULL OR retention_sent_at < ?) ORDER BY last_visit ASC LIMIT 50`).all(req.shop_id, dateStr, dateStr);

  if (staleCustomers.length === 0) return res.json({ success: true, sent: 0, message: `${days} хоногоос дээш ирээгүй шинэ харилцагч байхгүй` });

  let sent = 0;
  const log = db.prepare('INSERT INTO sms_log (id,shop_id,customer_phone,message,status) VALUES (?,?,?,?,?)');
  const upd = db.prepare('UPDATE customers SET retention_sent_at = ? WHERE id = ?');
  const templateKey = days >= 60 ? 'sms_retention_60' : 'sms_retention_30';
  const defaultTemplate = days >= 60
    ? 'Сайн уу {name}? Танд {shop}-д 60 гаруй хоног болж байна. Таны дуртай барберууд таныг хүлээж байна. Цагаа захиалах: {link}'
    : 'Сайн уу {name}? Танд {shop}-д 30 хоног болж байна. Цагаа захиалах уу? {link}';
  const template = shop[templateKey] || defaultTemplate;
  const today = todayLocal();
  const link = `${req.protocol}://${req.get('host')}/shop/${shop.slug}`;

  for (const c of staleCustomers) {
    const name = c.name || 'Харилцагч';
    const msg = template.replace(/{name}/g, name).replace(/{shop}/g, shop.name).replace(/{link}/g, link);
    const ok = await sendSms(shop, c.phone, msg);
    log.run(uuidv4().slice(0,8), req.shop_id, c.phone, msg, ok ? 'sent' : 'failed');
    if (ok) { upd.run(today, c.id); sent++; }
  }

  res.json({ success: true, sent, total: staleCustomers.length, message: `${sent}/${staleCustomers.length} харилцагчид сануулга илгээгдлээ` });
});

// ===== SMS TEMPLATES =====
app.get('/api/admin/sms/templates', requireAuth, (req, res) => {
  const row = db.prepare('SELECT sms_remind_today, sms_remind_tomorrow, sms_retention_30, sms_retention_60 FROM shops WHERE id = ?').get(req.shop_id);
  res.json(row || {});
});

app.post('/api/admin/sms/templates', requireAuth, (req, res) => {
  const { remind_today, remind_tomorrow, retention_30, retention_60 } = req.body;
  db.prepare('UPDATE shops SET sms_remind_today=?, sms_remind_tomorrow=?, sms_retention_30=?, sms_retention_60=? WHERE id=?')
    .run(remind_today||null, remind_tomorrow||null, retention_30||null, retention_60||null, req.shop_id);
  res.json({ success: true, message: 'Загвар хадгалагдлаа' });
});

// ===== Create new shop (for adding new clients) =====
app.post('/api/admin/shop/create', requireAuth, (req, res) => {
  const { name, slug, password } = req.body;
  if (!name || !slug || !password) return res.status(400).json({ error: 'All fields required' });
  const existing = db.prepare('SELECT id FROM shops WHERE slug = ?').get(slug);
  if (existing) return res.status(409).json({ error: 'Slug already taken' });

  const id = uuidv4().slice(0, 8);
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  db.prepare('INSERT INTO shops (id,name,slug,password_hash) VALUES (?,?,?,?)').run(id, name, slug, hash);

  // Default barbers & services for new shop
  const insB = db.prepare('INSERT INTO barbers (id,shop_id,name,title,specialty,experience,rating) VALUES (?,?,?,?,?,?,?)');
  insB.run(uuidv4().slice(0,8),id,'Барбер 1','Барбер','Үс, сахал','2+ жил',5);
  insB.run(uuidv4().slice(0,8),id,'Барбер 2','Барбер','Үс, сахал','2+ жил',5);
  const insS = db.prepare('INSERT INTO services (id,shop_id,name,price,duration) VALUES (?,?,?,?,?)');
  insS.run(uuidv4().slice(0,8),id,'💈 Үс засах',25000,30);
  insS.run(uuidv4().slice(0,8),id,'🧔 Сахал засах',15000,20);
  insS.run(uuidv4().slice(0,8),id,'🔥 Үс+Сахал',35000,45);

  res.json({ success: true, shop_id: id, slug, login_url: `/admin?shop=${slug}` });
});

// Get shop info for editing
app.get('/api/admin/shop/info', requireAuth, (req, res) => {
  const shop = db.prepare('SELECT name, slug, tagline, phone, address, instagram, facebook, email, primary_color, accent_color, theme, sub_status, plan, trial_ends_at, sub_ends_at FROM shops WHERE id = ?').get(req.shop_id);
  res.json(shop);
});

// ===== ADMIN — TODAY'S SCHEDULE =====
app.get('/api/admin/schedule/today', requireAuth, (req, res) => {
  const today = todayLocal();
  const barbers = db.prepare('SELECT id, name FROM barbers WHERE shop_id = ? AND active = 1').all(req.shop_id);
  const schedule = barbers.map(b => {
    const bookings = db.prepare(`SELECT b.id, b.booking_time, b.customer_name, b.customer_phone, s.name as service_name, s.price FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.barber_id = ? AND b.booking_date = ? AND b.status = ? ORDER BY b.booking_time DESC`).all(req.shop_id, b.id, today, 'confirmed');
    return { barber: b.name, bookings };
  });
  res.json({ date: today, schedule });
});

// ===== ADMIN — MANAGE BARBERS =====
app.post('/api/admin/barbers/add', requireAuth, (req, res) => {
  const { name, title, specialty, experience, description, commission } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4().slice(0, 8);
  db.prepare('INSERT INTO barbers (id,shop_id,name,title,specialty,experience,description,rating,commission) VALUES (?,?,?,?,?,?,?,?,?)').run(id, req.shop_id, name, title||'', specialty||'', experience||'', description||'', 5, commission||50);
  res.json({ success: true, id, name });
});

app.post('/api/admin/barbers/update', requireAuth, (req, res) => {
  const { id, name, title, specialty, experience, description, commission, avg_service_time } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });
  db.prepare('UPDATE barbers SET name=COALESCE(?,name), title=COALESCE(?,title), specialty=COALESCE(?,specialty), experience=COALESCE(?,experience), description=COALESCE(?,description), commission=COALESCE(?,commission), avg_service_time=COALESCE(?,avg_service_time) WHERE id=? AND shop_id=?').run(name||null, title||null, specialty||null, experience||null, description||null, commission||null, avg_service_time||null, id, req.shop_id);
  wsBroadcast(req.shop_id, { type: 'queue:change' });
  res.json({ success: true });
});

app.post('/api/admin/barbers/remove', requireAuth, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });
  db.prepare('UPDATE barbers SET active = 0 WHERE id = ? AND shop_id = ?').run(id, req.shop_id);
  res.json({ success: true });
});

app.get('/api/admin/barbers', requireAuth, (req, res) => {
  const barbers = db.prepare('SELECT id, name, title, specialty, experience, rating, description, commission, avg_service_time FROM barbers WHERE shop_id = ? AND active = 1').all(req.shop_id);
  barbers.forEach(b => {
    b.schedule = db.prepare('SELECT day_of_week, start_time, end_time, active FROM barber_schedules WHERE barber_id = ? ORDER BY day_of_week').all(b.id);
  });
  res.json(barbers);
});

app.post('/api/admin/barbers/:id/schedule', requireAuth, (req, res) => {
  const { schedule } = req.body;
  db.prepare('DELETE FROM barber_schedules WHERE barber_id = ?').run(req.params.id);
  const ins = db.prepare('INSERT INTO barber_schedules (barber_id, day_of_week, start_time, end_time, active) VALUES (?,?,?,?,?)');
  (schedule || []).forEach(s => {
    ins.run(req.params.id, s.day_of_week, s.start_time, s.end_time, s.active ? 1 : 0);
  });
  res.json({ success: true });
});

// ===== ADMIN — COMMISSION REPORT =====
app.get('/api/admin/commission', requireAuth, (req, res) => {
  const { range } = req.query; // 'today', 'week', 'month'
  let dateFrom;
  const today = todayLocal();
  if (range === 'week') {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); // Sunday
    dateFrom = d.toLocaleDateString('en-CA');
  } else if (range === 'month') {
    const d = new Date(); d.setDate(1);
    dateFrom = d.toLocaleDateString('en-CA');
  } else {
    dateFrom = today;
  }

  const barbers = db.prepare('SELECT id, name, commission FROM barbers WHERE shop_id = ? AND active = 1').all(req.shop_id);
  const report = barbers.map(b => {
    const bookings = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(s.price),0) as revenue FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.shop_id = ? AND b.barber_id = ? AND b.booking_date >= ? AND b.status = ?`).get(req.shop_id, b.id, dateFrom, 'confirmed');
    const commissionPct = b.commission || 50;
    return {
      id: b.id,
      name: b.name,
      commission: commissionPct,
      bookings: bookings.count,
      revenue: bookings.revenue,
      earnings: Math.round(bookings.revenue * commissionPct / 100)
    };
  });

  const totals = report.reduce((a, r) => ({ bookings: a.bookings + r.bookings, revenue: a.revenue + r.revenue, earnings: a.earnings + r.earnings }), { bookings: 0, revenue: 0, earnings: 0 });

  res.json({ range: range || 'today', date_from: dateFrom, barbers: report, totals });
});

// ===== ADMIN — MANAGE SERVICES =====
app.get('/api/admin/services', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM services WHERE shop_id = ?').all(req.shop_id));
});
app.post('/api/admin/services/add', requireAuth, (req, res) => {
  const { name, price, duration, description } = req.body;
  if (!name || !price || !duration) return res.status(400).json({ error: 'All fields required' });
  const id = uuidv4().slice(0, 8);
  db.prepare('INSERT INTO services (id,shop_id,name,price,duration,description) VALUES (?,?,?,?,?,?)').run(id, req.shop_id, name, price, duration, description||'');
  res.json({ success: true });
});
app.post('/api/admin/services/update', requireAuth, (req, res) => {
  const { id, name, price, duration, description } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });
  db.prepare('UPDATE services SET name=?, price=?, duration=?, description=? WHERE id=? AND shop_id=?').run(name, price, duration, description||'', id, req.shop_id);
  res.json({ success: true });
});
app.post('/api/admin/services/remove', requireAuth, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });
  db.prepare('DELETE FROM services WHERE id = ? AND shop_id = ?').run(id, req.shop_id);
  res.json({ success: true });
});

// ===== ADMIN — UPDATE SHOP INFO =====
app.post('/api/admin/shop/update', requireAuth, (req, res) => {
  const { name, tagline, phone, address, instagram, facebook, email, primary_color, accent_color } = req.body;
  const stmt = db.prepare('UPDATE shops SET name=COALESCE(?,name), tagline=COALESCE(?,tagline), phone=COALESCE(?,phone), address=COALESCE(?,address), instagram=COALESCE(?,instagram), facebook=COALESCE(?,facebook), email=COALESCE(?,email), primary_color=COALESCE(?,primary_color), accent_color=COALESCE(?,accent_color) WHERE id=?');
  stmt.run(name||null, tagline||null, phone||null, address||null, instagram||null, facebook||null, email||null, primary_color||null, accent_color||null, req.shop_id);
  res.json({ success: true });
});

// ===== ADMIN — UPDATE THEME =====
app.post('/api/admin/shop/theme', requireAuth, (req, res) => {
  const { theme } = req.body;
  const valid = ['dark','light','bold','minimal'];
  if (!valid.includes(theme)) return res.status(400).json({ error: 'Буруу theme. Сонголт: ' + valid.join(', ') });
  db.prepare('UPDATE shops SET theme = ? WHERE id = ?').run(theme, req.shop_id);
  res.json({ success: true, theme });
});

// ===== ADMIN — BOOKING STATUS TOGGLE =====
app.post('/api/admin/booking/status', requireAuth, (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ error: 'ID and status required' });
  db.prepare('UPDATE bookings SET status = ? WHERE id = ? AND shop_id = ?').run(status, id, req.shop_id);
  res.json({ success: true });
});

// ===== ADMIN — CUSTOMER NOTES =====
// Customer note & ban
app.post('/api/admin/customer/note', requireAuth, (req, res) => {
  const { phone, note } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  db.prepare('UPDATE customers SET note = ? WHERE shop_id = ? AND phone = ?').run(note||'', req.shop_id, phone);
  res.json({ success: true });
});

app.post('/api/admin/customer/ban', requireAuth, (req, res) => {
  const { phone, banned } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  db.prepare('UPDATE customers SET banned = ? WHERE shop_id = ? AND phone = ?').run(banned ? 1 : 0, req.shop_id, phone);
  res.json({ success: true });
});

// ===== PAGES =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/demo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/shop/:shop/queue', requireShop, (req, res) => {
  if (isShopExpired(req.shop)) return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  res.sendFile(path.join(__dirname, 'public', 'queue.html'));
});
app.get('/shop/:shop/barber', requireShop, (req, res) => {
  if (isShopExpired(req.shop)) return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  res.sendFile(path.join(__dirname, 'public', 'barber-queue.html'));
});
app.get('/shop/:shop/queue-status', requireShop, (req, res) => {
  if (isShopExpired(req.shop)) return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  res.sendFile(path.join(__dirname, 'public', 'queue-status.html'));
});
app.get('/shop/:shop/book', requireShop, (req, res) => {
  if (isShopExpired(req.shop)) return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  res.sendFile(path.join(__dirname, 'public', 'booking3.html'));
});
app.get('/shop/:shop', requireShop, (req, res) => {
  if (isShopExpired(req.shop)) return res.sendFile(path.join(__dirname, 'public', 'expired.html'));
  const themeFile = path.join(__dirname, 'public', 'themes', req.shop.slug + '.html');
  if (fs.existsSync(themeFile)) {
    res.sendFile(themeFile);
  } else {
    res.sendFile(path.join(__dirname, 'public', 'booking3.html'));
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/expired', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'expired.html'));
});

app.get('/admin-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ===== BILLING ADMIN (master key) =====
const MASTER_KEY = process.env.MASTER_KEY || 'barberpro2026';

function requireMaster(req, res, next) {
  const key = req.headers['x-master-key'] || req.query.key;
  if (key !== MASTER_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/billing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'billing.html'));
});

app.post('/api/billing/set-plan', requireMaster, (req, res) => {
  const { shop_id, plan } = req.body;
  if (!shop_id || !plan) return res.status(400).json({ error: 'shop_id and plan required' });
  db.prepare('UPDATE shops SET plan = ? WHERE id = ?').run(plan, shop_id);
  res.json({ success: true, plan });
});

app.get('/api/billing/shops', requireMaster, (req, res) => {
  const shops = db.prepare(`
    SELECT s.id, s.name, s.slug, s.phone, s.owner_name, s.sub_status, s.plan, s.trial_ends_at, s.sub_ends_at, s.created_at,
      (SELECT COUNT(*) FROM bookings WHERE shop_id = s.id AND status = 'confirmed') as total_bookings,
      (SELECT COUNT(*) FROM customers WHERE shop_id = s.id) as total_customers
    FROM shops s WHERE s.active = 1 OR s.sub_status = 'expired' ORDER BY s.created_at DESC
  `).all();
  res.json(shops);
});

app.post('/api/billing/activate', requireMaster, (req, res) => {
  const { shop_id, months } = req.body;
  if (!shop_id) return res.status(400).json({ error: 'shop_id required' });
  const m = parseInt(months) || 1;
  
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + m);
  const endStr = endDate.toLocaleDateString('en-CA');
  
  db.prepare("UPDATE shops SET sub_status = 'active', sub_ends_at = ?, active = 1 WHERE id = ?").run(endStr, shop_id);
  res.json({ success: true, sub_ends_at: endStr, months: m });
});

app.post('/api/billing/deactivate', requireMaster, (req, res) => {
  const { shop_id } = req.body;
  if (!shop_id) return res.status(400).json({ error: 'shop_id required' });
  db.prepare("UPDATE shops SET sub_status = 'expired', active = 0 WHERE id = ?").run(shop_id);
  res.json({ success: true });
});

app.post('/api/billing/update-shop', requireMaster, (req, res) => {
  const { shop_id, owner_name, phone } = req.body;
  if (!shop_id) return res.status(400).json({ error: 'shop_id required' });
  if (owner_name !== undefined) db.prepare('UPDATE shops SET owner_name = ? WHERE id = ?').run(owner_name, shop_id);
  if (phone !== undefined) db.prepare('UPDATE shops SET phone = ? WHERE id = ?').run(phone, shop_id);
  res.json({ success: true });
});

app.post('/api/billing/delete-shop', requireMaster, (req, res) => {
  const { shop_id } = req.body;
  if (!shop_id) return res.status(400).json({ error: 'shop_id required' });
  db.prepare("UPDATE shops SET active = 0, sub_status = 'deleted' WHERE id = ?").run(shop_id);
  res.json({ success: true });
});

app.post('/api/billing/reset-password', requireMaster, (req, res) => {
  const { shop_id, new_password } = req.body;
  if (!shop_id || !new_password || new_password.length < 4) return res.status(400).json({ error: 'shop_id and new_password (min 4 chars) required' });
  const hash = crypto.createHash('sha256').update(new_password).digest('hex');
  db.prepare('UPDATE shops SET password_hash = ? WHERE id = ?').run(hash, shop_id);
  res.json({ success: true });
});

// ===== WEBSOCKET =====
const wss = new WebSocket.Server({ noServer: true });
const clients = new Map(); // shop_id -> Set<WebSocket>

function wsBroadcast(shop_id, event) {
  const set = clients.get(shop_id);
  if (!set) return;
  const msg = JSON.stringify(event);
  set.forEach(ws => { try { ws.send(msg); } catch(e) {} });
}

// Handle WebSocket upgrade
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Barber Pro running on http://0.0.0.0:${PORT}`);
  console.log(`Booking demo: http://localhost:${PORT}/shop/barber-pro`);
  console.log(`Admin login: http://localhost:${PORT}/admin-login`);
  console.log(`Admin: http://localhost:${PORT}/admin (after login)`);
  console.log(`Demo login: slug=barber-pro, password=admin123`);
});

server.on('upgrade', (request, socket, head) => {
  if (!request.url.startsWith('/ws')) { socket.destroy(); return; }
  // Extract shop_id from cookie or query
  const params = new URL(request.url, 'http://localhost').searchParams;
  const shop_id = params.get('shop') || 'unknown';
  
  wss.handleUpgrade(request, socket, head, (ws) => {
    if (!clients.has(shop_id)) clients.set(shop_id, new Set());
    clients.get(shop_id).add(ws);
    ws.on('close', () => {
      const set = clients.get(shop_id);
      if (set) { set.delete(ws); if (set.size === 0) clients.delete(shop_id); }
    });
    ws.send(JSON.stringify({ type: 'connected', shop_id }));
  });
});
