/* =====================================================================
   منصة السعيد لمحاكاة اختبار PMP® — الواجهة الخلفية (Vercel Serverless)
   إعداد وتصميم وبرمجة © د. محمد عطية — جميع الحقوق محفوظة
   قاعدة البيانات: Neon Postgres (متغير البيئة DATABASE_URL أو POSTGRES_URL)
   ===================================================================== */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __dir = dirname(fileURLToPath(import.meta.url));

/* ---------------- اتصال قاعدة البيانات ---------------- */
let _q = null; // (text, params) => Promise<rows[]>
async function getQ() {
  if (_q) return _q;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!url) throw new Error('no_database_url');
  if (process.env.PG_DIRECT === '1') {
    // وضع الاختبار المحلي / أو خادم Postgres تقليدي
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url });
    _q = async (text, params = []) => (await pool.query(text, params)).rows;
  } else {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    _q = async (text, params = []) => await sql.query(text, params);
  }
  return _q;
}

/* ---------------- إنشاء الجداول والبذر الأولي ---------------- */
let _ready = false;
async function ensureSchema(q) {
  if (_ready) return;
  await q(`CREATE TABLE IF NOT EXISTS users(
    id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT DEFAULT '', phone TEXT DEFAULT '',
    pass TEXT NOT NULL, role TEXT DEFAULT 'student', status TEXT DEFAULT 'pending',
    created TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS allowed_emails(
    email TEXT PRIMARY KEY, note TEXT DEFAULT '', auto_active INT DEFAULT 1,
    created TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS payments(
    id SERIAL PRIMARY KEY, user_id INT NOT NULL, amount TEXT DEFAULT '', method TEXT DEFAULT '',
    ref TEXT DEFAULT '', note TEXT DEFAULT '', status TEXT DEFAULT 'pending',
    created TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS questions(
    id SERIAL PRIMARY KEY, s INT, d TEXT, t TEXT, data TEXT, active INT DEFAULT 1,
    created TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS videos(
    id SERIAL PRIMARY KEY, ta TEXT, te TEXT DEFAULT '', url TEXT, da TEXT DEFAULT '', de TEXT DEFAULT '',
    sort INT DEFAULT 0, created TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS results(
    id SERIAL PRIMARY KEY, user_id INT DEFAULT 0, name TEXT, ch INT, mode TEXT,
    score INT, total INT, pct INT, detail TEXT DEFAULT '{}',
    created TIMESTAMPTZ DEFAULT NOW())`);

  /* أدمن افتراضي */
  const uc = await q(`SELECT COUNT(*)::int AS c FROM users WHERE role='admin'`);
  if (!uc[0].c) {
    const email = (process.env.ADMIN_EMAIL || 'admin@al-ltc.com').toLowerCase();
    const pass = process.env.ADMIN_PASSWORD || 'Saeed@2026';
    await q(`INSERT INTO users(email,name,pass,role,status) VALUES($1,$2,$3,'admin','active')
             ON CONFLICT (email) DO UPDATE SET role='admin', status='active'`,
      [email, 'د. محمد عطية', bcrypt.hashSync(pass, 10)]);
  }

  /* الإعدادات الافتراضية */
  const defaults = {
    site_ar: 'منصة السعيد لمحاكاة اختبار PMP®',
    site_en: 'Al-Saeed PMP® Exam Simulation Platform',
    phone: '+20 122 173 2898',
    whatsapp: '201221732898',
    footer_ar: 'إعداد وتصميم وبرمجة © د. محمد عطية — جميع الحقوق محفوظة | Al Saeed ETC',
    footer_en: 'Prepared, designed & developed by Dr. Mohamed Attia — All rights reserved | Al Saeed ETC',
    price: '120',
    currency: '$',
    price_note: 'اشتراك كامل في منصة المحاكاة — بنك أسئلة ECO 2026 + تقارير أداء بنمط PMI',
    bank_info: 'للدفع: تحويل بنكي أو عبر بوابة الدفع في موقع al-ltc.com — أرسل إيصال الدفع عبر واتساب ثم أدخل رقم المرجع في لوحتك.',
    pay_url: 'https://al-ltc.com',
    site_url: 'https://al-ltc.com',
    free_mode: '0'
  };
  for (const [k, v] of Object.entries(defaults)) {
    await q(`INSERT INTO settings(k,v) VALUES($1,$2) ON CONFLICT (k) DO NOTHING`, [k, v]);
  }

  /* بذر بنك الأسئلة من ملف seed عند أول تشغيل */
  const qc = await q(`SELECT COUNT(*)::int AS c FROM questions`);
  if (!qc[0].c) {
    try {
      const seed = JSON.parse(readFileSync(join(__dir, '..', 'seed', 'questions.json'), 'utf8'));
      for (const item of seed) {
        await q(`INSERT INTO questions(s,d,t,data,active) VALUES($1,$2,$3,$4,1)`,
          [item.s, item.d, item.t, JSON.stringify(item)]);
      }
    } catch (e) { /* الملف غير موجود — يمكن الإضافة من لوحة التحكم */ }
  }
  _ready = true;
}

/* ---------------- جلسات موقعة (HMAC) ---------------- */
const SECRET = process.env.AUTH_SECRET || 'change-me-in-vercel-env-AUTH_SECRET';
const b64u = (b) => Buffer.from(b).toString('base64url');
function signToken(payload, days = 30) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + days * 864e5 }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function setSession(res, payload) {
  const t = signToken(payload);
  res.setHeader('Set-Cookie',
    `saeed_t=${t}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${30 * 86400}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', 'saeed_t=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
}

/* ---------------- أدوات مساعدة ---------------- */
const S = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
async function currentUser(req, q) {
  const p = verifyToken(getCookie(req, 'saeed_t'));
  if (!p || !p.u) return null;
  const rows = await q(`SELECT id,email,name,phone,role,status FROM users WHERE id=$1`, [p.u]);
  return rows[0] || null;
}
async function getSettings(q) {
  const rows = await q(`SELECT k,v FROM settings`);
  const set = {}; rows.forEach(r => set[r.k] = r.v); return set;
}
function canTakeExam(user, set) {
  if (set.free_mode === '1') return true;
  return !!user && (user.role === 'admin' || user.status === 'active');
}

/* ============================ المعالج الرئيسي ============================ */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const out = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };

  let q;
  try { q = await getQ(); await ensureSchema(q); }
  catch (e) { return out({ ok: false, err: 'db_unavailable', msg: String(e.message || e) }, 500); }

  const action = String((req.query && req.query.action) || '');
  let body = {};
  if (req.method === 'POST') {
    body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    if (typeof req.body === 'string') { try { body = JSON.parse(req.body); } catch { body = {}; } }
  }

  const user = await currentUser(req, q);
  const needUser = () => { if (!user) { out({ ok: false, err: 'auth' }, 401); return true; } return false; };
  const needAdmin = () => { if (!user || user.role !== 'admin') { out({ ok: false, err: 'forbidden' }, 403); return true; } return false; };

  try {
    switch (action) {

      /* ================= عام ================= */
      case 'boot': {
        const set = await getSettings(q);
        const vids = await q(`SELECT id,ta,te,url,da,de FROM videos ORDER BY sort,id`);
        const counts = {};
        (await q(`SELECT s, COUNT(*)::int AS c FROM questions WHERE active=1 GROUP BY s`))
          .forEach(r => counts[r.s] = r.c);
        const pub = {};
        ['site_ar','site_en','phone','whatsapp','footer_ar','footer_en','price','currency',
         'price_note','bank_info','pay_url','site_url','free_mode'].forEach(k => pub[k] = set[k] || '');
        return out({
          ok: true, settings: pub, videos: vids, counts,
          me: user ? { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status } : null,
          canExam: canTakeExam(user, set)
        });
      }
      case 'me': {
        const set = await getSettings(q);
        return out({ ok: true, me: user ? { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role, status: user.status } : null, canExam: canTakeExam(user, set) });
      }

      /* ================= الحسابات ================= */
      case 'register': {
        const email = S(body.email, 120).toLowerCase();
        const name = S(body.name, 80);
        const phone = S(body.phone, 30);
        const pass = String(body.pass || '');
        if (!emailOk(email)) return out({ ok: false, err: 'email' });
        if (name.length < 3) return out({ ok: false, err: 'name' });
        if (pass.length < 8) return out({ ok: false, err: 'weak' });
        const exists = await q(`SELECT id FROM users WHERE email=$1`, [email]);
        if (exists.length) return out({ ok: false, err: 'exists' });
        const allowed = await q(`SELECT auto_active FROM allowed_emails WHERE email=$1`, [email]);
        const status = allowed.length && allowed[0].auto_active ? 'active' : 'pending';
        const rows = await q(
          `INSERT INTO users(email,name,phone,pass,role,status) VALUES($1,$2,$3,$4,'student',$5) RETURNING id,role,status`,
          [email, name, phone, bcrypt.hashSync(pass, 10), status]);
        setSession(res, { u: rows[0].id });
        return out({ ok: true, status: rows[0].status });
      }
      case 'login': {
        const email = S(body.email || body.user, 120).toLowerCase();
        const rows = await q(`SELECT * FROM users WHERE email=$1`, [email]);
        const u = rows[0];
        if (!u || !bcrypt.compareSync(String(body.pass || ''), u.pass))
          return out({ ok: false, err: 'creds' });
        if (u.status === 'blocked') return out({ ok: false, err: 'blocked' });
        setSession(res, { u: u.id });
        return out({ ok: true, role: u.role, status: u.status, name: u.name });
      }
      case 'logout': { clearSession(res); return out({ ok: true }); }
      case 'change_password': {
        if (needUser()) return;
        const rows = await q(`SELECT pass FROM users WHERE id=$1`, [user.id]);
        if (!bcrypt.compareSync(String(body.old || ''), rows[0].pass))
          return out({ ok: false, err: 'old' });
        if (String(body.new || '').length < 8) return out({ ok: false, err: 'weak' });
        await q(`UPDATE users SET pass=$1 WHERE id=$2`, [bcrypt.hashSync(String(body.new), 10), user.id]);
        return out({ ok: true });
      }
      case 'update_profile': {
        if (needUser()) return;
        const name = S(body.name, 80), phone = S(body.phone, 30);
        if (name.length < 3) return out({ ok: false, err: 'name' });
        await q(`UPDATE users SET name=$1, phone=$2 WHERE id=$3`, [name, phone, user.id]);
        return out({ ok: true });
      }

      /* ================= بنك الأسئلة (للمشتركين النشطين) ================= */
      case 'questions': {
        const set = await getSettings(q);
        if (!canTakeExam(user, set)) return out({ ok: false, err: user ? 'inactive' : 'auth' }, 403);
        const rows = await q(`SELECT id,data FROM questions WHERE active=1 ORDER BY s,id`);
        const qs = rows.map(r => { const j = JSON.parse(r.data); j.id = r.id; return j; });
        return out({ ok: true, questions: qs });
      }
      case 'save_result': {
        if (needUser()) return;
        const name = S(body.name || user.name, 80) || user.email;
        await q(`INSERT INTO results(user_id,name,ch,mode,score,total,pct,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [user.id, name, +body.ch || 0, body.mode === 'e' ? 'e' : 'p',
           +body.score || 0, +body.total || 0, +body.pct || 0,
           JSON.stringify(body.detail || {})]);
        return out({ ok: true });
      }
      case 'my_results': {
        if (needUser()) return;
        const rows = await q(
          `SELECT id,ch,mode,score,total,pct,created FROM results WHERE user_id=$1 ORDER BY id DESC LIMIT 100`, [user.id]);
        return out({ ok: true, results: rows });
      }

      /* ================= الدفع (من المتدرب) ================= */
      case 'submit_payment': {
        if (needUser()) return;
        const ref = S(body.ref, 120);
        if (ref.length < 3) return out({ ok: false, err: 'ref' });
        await q(`INSERT INTO payments(user_id,amount,method,ref,note) VALUES($1,$2,$3,$4,$5)`,
          [user.id, S(body.amount, 30), S(body.method, 40), ref, S(body.note, 300)]);
        return out({ ok: true });
      }
      case 'my_payments': {
        if (needUser()) return;
        const rows = await q(
          `SELECT id,amount,method,ref,status,created FROM payments WHERE user_id=$1 ORDER BY id DESC LIMIT 50`, [user.id]);
        return out({ ok: true, payments: rows });
      }

      /* ================= الإدارة — المستخدمون والبريد المسموح ================= */
      case 'users': {
        if (needAdmin()) return;
        const rows = await q(
          `SELECT id,email,name,phone,role,status,created FROM users ORDER BY id DESC LIMIT 2000`);
        return out({ ok: true, users: rows });
      }
      case 'create_user': {
        if (needAdmin()) return;
        const email = S(body.email, 120).toLowerCase();
        if (!emailOk(email)) return out({ ok: false, err: 'email' });
        const pass = String(body.pass || '') || crypto.randomBytes(5).toString('hex');
        const exists = await q(`SELECT id FROM users WHERE email=$1`, [email]);
        if (exists.length) return out({ ok: false, err: 'exists' });
        await q(`INSERT INTO users(email,name,phone,pass,role,status) VALUES($1,$2,$3,$4,$5,$6)`,
          [email, S(body.name, 80), S(body.phone, 30), bcrypt.hashSync(pass, 10),
           body.role === 'admin' ? 'admin' : 'student', body.status === 'active' ? 'active' : 'pending']);
        return out({ ok: true, pass });
      }
      case 'set_user_status': {
        if (needAdmin()) return;
        const st = ['active', 'pending', 'blocked'].includes(body.status) ? body.status : 'pending';
        if (+body.id === user.id) return out({ ok: false, err: 'self' });
        await q(`UPDATE users SET status=$1 WHERE id=$2 AND role<>'admin'`, [st, +body.id || 0]);
        return out({ ok: true });
      }
      case 'reset_user_password': {
        if (needAdmin()) return;
        const pass = String(body.pass || '') || crypto.randomBytes(5).toString('hex');
        await q(`UPDATE users SET pass=$1 WHERE id=$2`, [bcrypt.hashSync(pass, 10), +body.id || 0]);
        return out({ ok: true, pass });
      }
      case 'delete_user': {
        if (needAdmin()) return;
        if (+body.id === user.id) return out({ ok: false, err: 'self' });
        await q(`DELETE FROM users WHERE id=$1 AND role<>'admin'`, [+body.id || 0]);
        return out({ ok: true });
      }
      case 'allowed_list': {
        if (needAdmin()) return;
        const rows = await q(`SELECT email,note,auto_active,created FROM allowed_emails ORDER BY created DESC LIMIT 2000`);
        return out({ ok: true, allowed: rows });
      }
      case 'add_allowed': {
        if (needAdmin()) return;
        const list = String(body.emails || '').split(/[\s,;\n]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
        const note = S(body.note, 120);
        const auto = body.auto_active === false ? 0 : 1;
        let added = 0, activated = 0, bad = [];
        for (const email of list) {
          if (!emailOk(email)) { bad.push(email); continue; }
          await q(`INSERT INTO allowed_emails(email,note,auto_active) VALUES($1,$2,$3)
                   ON CONFLICT (email) DO UPDATE SET note=$2, auto_active=$3`, [email, note, auto]);
          added++;
          if (auto) { /* لو الحساب مسجَّل مسبقًا فعّله فورًا */
            const r = await q(`UPDATE users SET status='active' WHERE email=$1 AND role='student' AND status='pending' RETURNING id`, [email]);
            activated += r.length;
          }
        }
        return out({ ok: true, added, activated, bad });
      }
      case 'delete_allowed': {
        if (needAdmin()) return;
        await q(`DELETE FROM allowed_emails WHERE email=$1`, [S(body.email, 120).toLowerCase()]);
        return out({ ok: true });
      }

      /* ================= الإدارة — المدفوعات ================= */
      case 'payments_list': {
        if (needAdmin()) return;
        const rows = await q(
          `SELECT p.id,p.user_id,p.amount,p.method,p.ref,p.note,p.status,p.created,u.email,u.name,u.status AS ustatus
           FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 2000`);
        return out({ ok: true, payments: rows });
      }
      case 'set_payment_status': {
        if (needAdmin()) return;
        const st = ['approved', 'rejected', 'pending'].includes(body.status) ? body.status : 'pending';
        const rows = await q(`UPDATE payments SET status=$1 WHERE id=$2 RETURNING user_id`, [st, +body.id || 0]);
        if (st === 'approved' && rows.length) {
          await q(`UPDATE users SET status='active' WHERE id=$1 AND role='student'`, [rows[0].user_id]);
        }
        return out({ ok: true });
      }

      /* ================= الإدارة — الأسئلة والفيديو والنتائج والإعدادات ================= */
      case 'admin_questions': {
        if (needAdmin()) return;
        const rows = await q(`SELECT id,s,d,t,active,data FROM questions ORDER BY s,id`);
        return out({ ok: true, questions: rows });
      }
      case 'save_question': {
        if (needAdmin()) return;
        const Q = body.q;
        if (!Q || typeof Q !== 'object' || !Q.s || !Q.d || !Q.t || !Q.q || !Q.q.a)
          return out({ ok: false, err: 'invalid' });
        const t = Q.t; let bad = false;
        if (['mc', 'gr'].includes(t)) bad = !Q.o || !Q.o.length || typeof Q.c !== 'number' || Q.c >= Q.o.length;
        else if (t === 'mr') bad = !Q.o || !Array.isArray(Q.c) || !Q.c.length || Q.c.length !== (Q.n || 0);
        else if (t === 'dd') bad = !Q.b || !Array.isArray(Q.c) || Q.b.length !== Q.c.length;
        else if (['mt', 'em'].includes(t)) bad = !Q.L || !Q.R || !Array.isArray(Q.m) || Q.m.length !== Q.L.length;
        else if (t === 'pc') bad = !Q.svg || !Q.ans;
        if (bad) return out({ ok: false, err: 'structure' });
        const json = JSON.stringify(Q);
        if (body.id) {
          await q(`UPDATE questions SET s=$1,d=$2,t=$3,data=$4,active=$5 WHERE id=$6`,
            [Q.s, Q.d, t, json, body.active === 0 ? 0 : 1, +body.id]);
          return out({ ok: true, id: +body.id });
        }
        const rows = await q(`INSERT INTO questions(s,d,t,data,active) VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [Q.s, Q.d, t, json, body.active === 0 ? 0 : 1]);
        return out({ ok: true, id: rows[0].id });
      }
      case 'delete_question': {
        if (needAdmin()) return;
        await q(`DELETE FROM questions WHERE id=$1`, [+body.id || 0]);
        return out({ ok: true });
      }
      case 'toggle_question': {
        if (needAdmin()) return;
        await q(`UPDATE questions SET active=1-active WHERE id=$1`, [+body.id || 0]);
        return out({ ok: true });
      }
      case 'save_video': {
        if (needAdmin()) return;
        if (!S(body.ta) || !S(body.url, 500)) return out({ ok: false, err: 'invalid' });
        if (body.id) {
          await q(`UPDATE videos SET ta=$1,te=$2,url=$3,da=$4,de=$5,sort=$6 WHERE id=$7`,
            [S(body.ta), S(body.te), S(body.url, 500), S(body.da, 300), S(body.de, 300), +body.sort || 0, +body.id]);
        } else {
          await q(`INSERT INTO videos(ta,te,url,da,de,sort) VALUES($1,$2,$3,$4,$5,$6)`,
            [S(body.ta), S(body.te), S(body.url, 500), S(body.da, 300), S(body.de, 300), +body.sort || 0]);
        }
        return out({ ok: true });
      }
      case 'delete_video': {
        if (needAdmin()) return;
        await q(`DELETE FROM videos WHERE id=$1`, [+body.id || 0]);
        return out({ ok: true });
      }
      case 'results': {
        if (needAdmin()) return;
        const rows = await q(
          `SELECT r.id,r.name,r.ch,r.mode,r.score,r.total,r.pct,r.created,u.email
           FROM results r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.id DESC LIMIT 2000`);
        return out({ ok: true, results: rows });
      }
      case 'delete_result': {
        if (needAdmin()) return;
        await q(`DELETE FROM results WHERE id=$1`, [+body.id || 0]);
        return out({ ok: true });
      }
      case 'save_settings': {
        if (needAdmin()) return;
        const allowed = ['site_ar', 'site_en', 'phone', 'whatsapp', 'footer_ar', 'footer_en',
          'price', 'currency', 'price_note', 'bank_info', 'pay_url', 'site_url', 'free_mode'];
        for (const k of allowed) {
          if (body[k] !== undefined) {
            await q(`INSERT INTO settings(k,v) VALUES($1,$2) ON CONFLICT (k) DO UPDATE SET v=$2`, [k, S(body[k], 800)]);
          }
        }
        return out({ ok: true });
      }
      case 'stats': {
        if (needAdmin()) return;
        const st = {};
        st.users = (await q(`SELECT COUNT(*)::int c FROM users WHERE role='student'`))[0].c;
        st.active = (await q(`SELECT COUNT(*)::int c FROM users WHERE role='student' AND status='active'`))[0].c;
        st.pending_pay = (await q(`SELECT COUNT(*)::int c FROM payments WHERE status='pending'`))[0].c;
        st.results = (await q(`SELECT COUNT(*)::int c FROM results`))[0].c;
        st.questions = (await q(`SELECT COUNT(*)::int c FROM questions WHERE active=1`))[0].c;
        return out({ ok: true, stats: st });
      }

      default: return out({ ok: false, err: 'unknown_action' }, 404);
    }
  } catch (e) {
    return out({ ok: false, err: 'server', msg: String(e.message || e) }, 500);
  }
}
