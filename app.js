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
  await q(`CREATE TABLE IF NOT EXISTS courses(
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
    name_ar TEXT NOT NULL, name_en TEXT DEFAULT '',
    desc_ar TEXT DEFAULT '', desc_en TEXT DEFAULT '',
    icon TEXT DEFAULT '📘', color TEXT DEFAULT '#2f6fb2',
    chapters TEXT DEFAULT '[]',
    sec_per_q INT DEFAULT 78, passing_score INT DEFAULT 70,
    price TEXT DEFAULT '', currency TEXT DEFAULT '$',
    active INT DEFAULT 1, sort INT DEFAULT 0,
    created TIMESTAMPTZ DEFAULT NOW())`);
  await q(`CREATE TABLE IF NOT EXISTS enrollments(
    id SERIAL PRIMARY KEY, user_id INT NOT NULL, course_id INT NOT NULL,
    status TEXT DEFAULT 'pending', created TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, course_id))`);
  await q(`CREATE TABLE IF NOT EXISTS results(
    id SERIAL PRIMARY KEY, user_id INT DEFAULT 0, name TEXT, ch INT, mode TEXT,
    score INT, total INT, pct INT, detail TEXT DEFAULT '{}',
    created TIMESTAMPTZ DEFAULT NOW())`);

  /* ترحيل صامت: أعمدة course_id للجداول القائمة */
  await q(`ALTER TABLE questions ADD COLUMN IF NOT EXISTS course_id INT DEFAULT 1`);
  await q(`ALTER TABLE results   ADD COLUMN IF NOT EXISTS course_id INT DEFAULT 1`);
  await q(`ALTER TABLE payments  ADD COLUMN IF NOT EXISTS course_id INT DEFAULT 1`);
  await q(`ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS course_code TEXT DEFAULT ''`);

  /* بذر كتالوج الدورات (مرة واحدة) */
  const cc = await q(`SELECT COUNT(*)::int AS c FROM courses`);
  if (!cc[0].c) {
    const pmpChapters = JSON.stringify([
      { s: 1, ar: 'إطار عمل إدارة المشاريع', en: 'Project Management Framework', sub_ar: 'المفاهيم والمبادئ والحوكمة', sub_en: 'Concepts, principles & governance', icon: '📘' },
      { s: 2, ar: 'النهج الرشيق Agile', en: 'Agile Approach', sub_ar: 'سكرم وكانبان والممارسات الرشيقة', sub_en: 'Scrum, Kanban & agile practices', icon: '🔄' },
      { s: 3, ar: 'النهج التنبؤي Predictive', en: 'Predictive Approach', sub_ar: 'النطاق والجدول والقيمة المكتسبة والمخاطر', sub_en: 'Scope, schedule, EVM & risk', icon: '📐' },
      { s: 4, ar: 'النهج المختلط Hybrid', en: 'Hybrid Approach', sub_ar: 'دمج النهجين والتكييف والحوكمة', sub_en: 'Blending approaches, tailoring & governance', icon: '🧩' }
    ]);
    const catalog = [
      ['pmp',  'محاكاة PMP® — ECO 2026', 'PMP® Simulation — ECO 2026', 'بنك سيناريوهات موائم لـ PMBOK® 8 وECO يوليو 2026 بكل أنماط الأسئلة الجديدة.', 'Scenario bank aligned to PMBOK® 8 and the July 2026 ECO with all new question types.', '🏆', '#c9a13b', pmpChapters, 78, 70, '120', '$', 1, 1],
      ['rmp',  'محاكاة PMI-RMP® — إدارة المخاطر', 'PMI-RMP® Simulation — Risk Management', 'التحليل الكمي والنوعي والاستجابات وفق أحدث مخطط محتوى.', 'Quantitative & qualitative analysis and responses per the latest ECO.', '🛡️', '#b3261e', '[]', 75, 70, '99', '$', 0, 2],
      ['acp',  'محاكاة PMI-ACP® — الرشاقة', 'PMI-ACP® Simulation — Agile', 'الممارسات الرشيقة المتقدمة عبر الأطر المتعددة.', 'Advanced agile practice across frameworks.', '🔄', '#1e8e4e', '[]', 75, 70, '99', '$', 0, 3],
      ['grcp', 'محاكاة GRCP™ — الحوكمة والمخاطر والامتثال', 'GRCP™ Simulation — Governance, Risk & Compliance', 'شهادة OCEG الدولية بمنهج LAPR.', 'The international OCEG certification (LAPR model).', '⚖️', '#2f6fb2', '[]', 75, 70, '99', '$', 0, 4],
      ['p3o',  'محاكاة P3O® — مكاتب المحافظ والبرامج والمشاريع', 'P3O® Simulation — Portfolio, Programme & Project Offices', 'تصميم وتشغيل مكاتب إدارة المشاريع.', 'Designing and operating P3O structures.', '🏛️', '#6b4fa1', '[]', 75, 70, '99', '$', 0, 5],
      ['cphm', 'محاكاة CPHM — إدارة المرافق الصحية', 'CPHM Simulation — Healthcare Management', 'إدارة المنشآت الصحية والجودة والاعتماد.', 'Healthcare facility management, quality & accreditation.', '🏥', '#0f8b8d', '[]', 75, 70, '99', '$', 0, 6],
      ['lss',  'محاكاة Lean Six Sigma', 'Lean Six Sigma Simulation', 'التحسين المستمر ومنهجية DMAIC.', 'Continuous improvement and DMAIC.', '📊', '#e67e22', '[]', 75, 70, '99', '$', 0, 7],
      ['comp', 'محاكاة الامتثال Compliance', 'Compliance Simulation', 'الامتثال التنظيمي وإدارة الرقابة.', 'Regulatory compliance and controls.', '📋', '#5c6a78', '[]', 75, 70, '99', '$', 0, 8]
    ];
    for (const c of catalog) {
      await q(`INSERT INTO courses(code,name_ar,name_en,desc_ar,desc_en,icon,color,chapters,sec_per_q,passing_score,price,currency,active,sort)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (code) DO NOTHING`, c);
    }
  }
  /* ترحيل: الطلاب المفعّلون عالميًا → اشتراك نشط في PMP */
  await q(`INSERT INTO enrollments(user_id,course_id,status)
           SELECT id, 1, 'active' FROM users WHERE role='student' AND status='active'
           ON CONFLICT (user_id,course_id) DO NOTHING`);

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
async function courseByParam(q, p) {
  const v = String(p || '').trim().toLowerCase();
  if (!v) return null;
  const rows = /^\d+$/.test(v)
    ? await q(`SELECT * FROM courses WHERE id=$1`, [+v])
    : await q(`SELECT * FROM courses WHERE code=$1`, [v]);
  return rows[0] || null;
}
async function enrollmentOf(q, userId, courseId) {
  const rows = await q(`SELECT status FROM enrollments WHERE user_id=$1 AND course_id=$2`, [userId, courseId]);
  return rows[0] ? rows[0].status : null;
}
async function canTakeCourse(q, user, courseId, set) {
  if (set.free_mode === '1') return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.status === 'blocked') return false;
  return (await enrollmentOf(q, user.id, courseId)) === 'active';
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
        (await q(`SELECT s, COUNT(*)::int AS c FROM questions WHERE active=1 AND course_id=1 GROUP BY s`))
          .forEach(r => counts[r.s] = r.c);
        /* كتالوج الدورات مع عدد الأسئلة واشتراك المستخدم */
        const crs = await q(`SELECT c.id,c.code,c.name_ar,c.name_en,c.desc_ar,c.desc_en,c.icon,c.color,
                                    c.sec_per_q,c.passing_score,c.price,c.currency,c.active,c.sort,
                                    COALESCE(qq.qc,0)::int AS qcount
                             FROM courses c
                             LEFT JOIN (SELECT course_id, COUNT(*) qc FROM questions WHERE active=1 GROUP BY course_id) qq
                               ON qq.course_id=c.id
                             ORDER BY c.sort,c.id`);
        let myEnroll = {};
        if (user) (await q(`SELECT course_id,status FROM enrollments WHERE user_id=$1`, [user.id]))
          .forEach(r => myEnroll[r.course_id] = r.status);
        const pub = {};
        ['site_ar','site_en','phone','whatsapp','footer_ar','footer_en','price','currency',
         'price_note','bank_info','pay_url','site_url','free_mode'].forEach(k => pub[k] = set[k] || '');
        return out({
          ok: true, settings: pub, videos: vids, counts,
          courses: crs, my_enrollments: myEnroll,
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
        const allowed = await q(`SELECT auto_active,course_code FROM allowed_emails WHERE email=$1`, [email]);
        const status = allowed.length && allowed[0].auto_active ? 'active' : 'pending';
        const rows = await q(
          `INSERT INTO users(email,name,phone,pass,role,status) VALUES($1,$2,$3,$4,'student',$5) RETURNING id,role,status`,
          [email, name, phone, bcrypt.hashSync(pass, 10), status]);
        if (status === 'active') {
          const ccode = (allowed[0].course_code || '').toLowerCase();
          if (ccode) {
            const c2 = await courseByParam(q, ccode);
            if (c2) await q(`INSERT INTO enrollments(user_id,course_id,status) VALUES($1,$2,'active')
                             ON CONFLICT (user_id,course_id) DO NOTHING`, [rows[0].id, c2.id]);
          } else {
            await q(`INSERT INTO enrollments(user_id,course_id,status)
                     SELECT $1, id, 'active' FROM courses WHERE active=1
                     ON CONFLICT (user_id,course_id) DO NOTHING`, [rows[0].id]);
          }
        }
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
        const course = await courseByParam(q, (req.query && req.query.course) || body.course || 'pmp');
        if (!course) return out({ ok: false, err: 'course' }, 404);
        if (!course.active && (!user || user.role !== 'admin')) return out({ ok: false, err: 'soon' }, 403);
        if (!(await canTakeCourse(q, user, course.id, set)))
          return out({ ok: false, err: user ? 'inactive' : 'auth' }, 403);
        const rows = await q(`SELECT id,data FROM questions WHERE active=1 AND course_id=$1 ORDER BY s,id`, [course.id]);
        const qs = rows.map(r => { const j = JSON.parse(r.data); j.id = r.id; return j; });
        let chapters = []; try { chapters = JSON.parse(course.chapters || '[]'); } catch {}
        return out({ ok: true, questions: qs,
          course: { id: course.id, code: course.code, name_ar: course.name_ar, name_en: course.name_en,
                    icon: course.icon, color: course.color, chapters,
                    sec_per_q: course.sec_per_q, passing_score: course.passing_score } });
      }
      case 'save_result': {
        if (needUser()) return;
        const name = S(body.name || user.name, 80) || user.email;
        await q(`INSERT INTO results(user_id,name,ch,mode,score,total,pct,detail,course_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [user.id, name, +body.ch || 0, body.mode === 'e' ? 'e' : 'p',
           +body.score || 0, +body.total || 0, +body.pct || 0,
           JSON.stringify(body.detail || {}), +body.course_id || 1]);
        return out({ ok: true });
      }
      case 'my_results': {
        if (needUser()) return;
        const rows = await q(
          `SELECT r.id,r.ch,r.mode,r.score,r.total,r.pct,r.created,r.course_id,c.name_ar AS course_ar,c.name_en AS course_en,c.code AS course_code,c.passing_score
           FROM results r LEFT JOIN courses c ON c.id=r.course_id
           WHERE r.user_id=$1 ORDER BY r.id DESC LIMIT 100`, [user.id]);
        return out({ ok: true, results: rows });
      }

      case 'enroll': {
        if (needUser()) return;
        const course = await courseByParam(q, body.course);
        if (!course || !course.active) return out({ ok: false, err: 'course' }, 404);
        await q(`INSERT INTO enrollments(user_id,course_id,status) VALUES($1,$2,'pending')
                 ON CONFLICT (user_id,course_id) DO NOTHING`, [user.id, course.id]);
        const st = await enrollmentOf(q, user.id, course.id);
        return out({ ok: true, status: st });
      }

      /* ================= الدفع (من المتدرب) ================= */
      case 'submit_payment': {
        if (needUser()) return;
        const ref = S(body.ref, 120);
        if (ref.length < 3) return out({ ok: false, err: 'ref' });
        const pc = await courseByParam(q, body.course || 'pmp');
        const cid = pc ? pc.id : 1;
        await q(`INSERT INTO payments(user_id,amount,method,ref,note,course_id) VALUES($1,$2,$3,$4,$5,$6)`,
          [user.id, S(body.amount, 30), S(body.method, 40), ref, S(body.note, 300), cid]);
        await q(`INSERT INTO enrollments(user_id,course_id,status) VALUES($1,$2,'pending')
                 ON CONFLICT (user_id,course_id) DO NOTHING`, [user.id, cid]);
        return out({ ok: true });
      }
      case 'my_payments': {
        if (needUser()) return;
        const rows = await q(
          `SELECT p.id,p.amount,p.method,p.ref,p.status,p.created,c.name_ar AS course_ar,c.code AS course_code
           FROM payments p LEFT JOIN courses c ON c.id=p.course_id
           WHERE p.user_id=$1 ORDER BY p.id DESC LIMIT 50`, [user.id]);
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
        const ccode = S(body.course_code, 20).toLowerCase(); /* '' = كل الدورات المتاحة */
        let added = 0, activated = 0, bad = [];
        for (const email of list) {
          if (!emailOk(email)) { bad.push(email); continue; }
          await q(`INSERT INTO allowed_emails(email,note,auto_active,course_code) VALUES($1,$2,$3,$4)
                   ON CONFLICT (email) DO UPDATE SET note=$2, auto_active=$3, course_code=$4`, [email, note, auto, ccode]);
          added++;
          if (auto) { /* لو الحساب مسجَّل مسبقًا فعّله فورًا */
            const r = await q(`UPDATE users SET status='active' WHERE email=$1 AND role='student' AND status='pending' RETURNING id`, [email]);
            activated += r.length;
            const u2 = await q(`SELECT id FROM users WHERE email=$1 AND role='student'`, [email]);
            if (u2.length) {
              if (ccode) {
                const c2 = await courseByParam(q, ccode);
                if (c2) await q(`INSERT INTO enrollments(user_id,course_id,status) VALUES($1,$2,'active')
                                 ON CONFLICT (user_id,course_id) DO UPDATE SET status='active'`, [u2[0].id, c2.id]);
              } else {
                await q(`INSERT INTO enrollments(user_id,course_id,status)
                         SELECT $1, id, 'active' FROM courses WHERE active=1
                         ON CONFLICT (user_id,course_id) DO UPDATE SET status='active'`, [u2[0].id]);
              }
            }
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
          `SELECT p.id,p.user_id,p.amount,p.method,p.ref,p.note,p.status,p.created,u.email,u.name,u.status AS ustatus,
                  c.name_ar AS course_ar, c.code AS course_code
           FROM payments p
           LEFT JOIN users u ON u.id=p.user_id
           LEFT JOIN courses c ON c.id=p.course_id
           ORDER BY p.id DESC LIMIT 2000`);
        return out({ ok: true, payments: rows });
      }
      case 'set_payment_status': {
        if (needAdmin()) return;
        const st = ['approved', 'rejected', 'pending'].includes(body.status) ? body.status : 'pending';
        const rows = await q(`UPDATE payments SET status=$1 WHERE id=$2 RETURNING user_id, course_id`, [st, +body.id || 0]);
        if (st === 'approved' && rows.length) {
          const { user_id, course_id } = rows[0];
          await q(`INSERT INTO enrollments(user_id,course_id,status) VALUES($1,$2,'active')
                   ON CONFLICT (user_id,course_id) DO UPDATE SET status='active'`, [user_id, course_id || 1]);
          /* توافق رجعي: تفعيل عام لو الدورة الأساسية */
          await q(`UPDATE users SET status='active' WHERE id=$1 AND role='student' AND status='pending'`, [user_id]);
        }
        return out({ ok: true });
      }

      /* ================= الإدارة — الدورات والاشتراكات ================= */
      case 'courses_admin': {
        if (needAdmin()) return;
        const rows = await q(`SELECT c.*, COALESCE(qq.qc,0)::int AS qcount, COALESCE(ee.ec,0)::int AS enrolled
          FROM courses c
          LEFT JOIN (SELECT course_id, COUNT(*) qc FROM questions GROUP BY course_id) qq ON qq.course_id=c.id
          LEFT JOIN (SELECT course_id, COUNT(*) ec FROM enrollments WHERE status='active' GROUP BY course_id) ee ON ee.course_id=c.id
          ORDER BY c.sort,c.id`);
        return out({ ok: true, courses: rows });
      }
      case 'save_course': {
        if (needAdmin()) return;
        const code = S(body.code, 20).toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const name_ar = S(body.name_ar, 120);
        if (!code || name_ar.length < 3) return out({ ok: false, err: 'invalid' });
        let chapters = '[]';
        try {
          const parsed = typeof body.chapters === 'string' ? JSON.parse(body.chapters || '[]') : (body.chapters || []);
          if (!Array.isArray(parsed)) throw 0;
          chapters = JSON.stringify(parsed);
        } catch { return out({ ok: false, err: 'chapters' }); }
        const vals = [code, name_ar, S(body.name_en, 120), S(body.desc_ar, 400), S(body.desc_en, 400),
          S(body.icon, 8) || '📘', S(body.color, 12) || '#2f6fb2', chapters,
          Math.max(10, +body.sec_per_q || 78), Math.min(100, Math.max(1, +body.passing_score || 70)),
          S(body.price, 30), S(body.currency, 8) || '$', body.active === 0 || body.active === false ? 0 : 1, +body.sort || 0];
        if (body.id) {
          await q(`UPDATE courses SET code=$1,name_ar=$2,name_en=$3,desc_ar=$4,desc_en=$5,icon=$6,color=$7,
                   chapters=$8,sec_per_q=$9,passing_score=$10,price=$11,currency=$12,active=$13,sort=$14 WHERE id=$15`,
            [...vals, +body.id]);
          return out({ ok: true, id: +body.id });
        }
        const rows = await q(`INSERT INTO courses(code,name_ar,name_en,desc_ar,desc_en,icon,color,chapters,sec_per_q,passing_score,price,currency,active,sort)
                              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                              ON CONFLICT (code) DO NOTHING RETURNING id`, vals);
        if (!rows.length) return out({ ok: false, err: 'exists' });
        return out({ ok: true, id: rows[0].id });
      }
      case 'delete_course': {
        if (needAdmin()) return;
        const cid = +body.id || 0;
        if (cid === 1) return out({ ok: false, err: 'core' }); /* حماية الدورة الأساسية */
        const qc = await q(`SELECT COUNT(*)::int c FROM questions WHERE course_id=$1`, [cid]);
        if (qc[0].c && !body.force) return out({ ok: false, err: 'has_questions', count: qc[0].c });
        await q(`DELETE FROM questions WHERE course_id=$1`, [cid]);
        await q(`DELETE FROM enrollments WHERE course_id=$1`, [cid]);
        await q(`DELETE FROM courses WHERE id=$1`, [cid]);
        return out({ ok: true });
      }
      case 'enrollments_list': {
        if (needAdmin()) return;
        const rows = await q(`SELECT e.id,e.user_id,e.course_id,e.status,e.created,
                                     u.email,u.name,c.name_ar AS course_ar,c.code AS course_code
                              FROM enrollments e
                              JOIN users u ON u.id=e.user_id
                              JOIN courses c ON c.id=e.course_id
                              ORDER BY e.id DESC LIMIT 3000`);
        return out({ ok: true, enrollments: rows });
      }
      case 'set_enrollment': {
        if (needAdmin()) return;
        const st = ['active', 'pending', 'blocked'].includes(body.status) ? body.status : 'pending';
        if (body.id) {
          await q(`UPDATE enrollments SET status=$1 WHERE id=$2`, [st, +body.id]);
        } else {
          const c2 = await courseByParam(q, body.course);
          if (!c2 || !+body.user_id) return out({ ok: false, err: 'invalid' });
          await q(`INSERT INTO enrollments(user_id,course_id,status) VALUES($1,$2,$3)
                   ON CONFLICT (user_id,course_id) DO UPDATE SET status=$3`, [+body.user_id, c2.id, st]);
        }
        return out({ ok: true });
      }
      case 'delete_enrollment': {
        if (needAdmin()) return;
        await q(`DELETE FROM enrollments WHERE id=$1`, [+body.id || 0]);
        return out({ ok: true });
      }

      /* ================= الإدارة — الأسئلة والفيديو والنتائج والإعدادات ================= */
      case 'admin_questions': {
        if (needAdmin()) return;
        const course = await courseByParam(q, (req.query && req.query.course) || body.course || 'pmp');
        const cid = course ? course.id : 1;
        const rows = await q(`SELECT id,s,d,t,active,data,course_id FROM questions WHERE course_id=$1 ORDER BY s,id`, [cid]);
        return out({ ok: true, questions: rows, course_id: cid });
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
        const cid = +body.course_id || 1;
        if (body.id) {
          await q(`UPDATE questions SET s=$1,d=$2,t=$3,data=$4,active=$5,course_id=$6 WHERE id=$7`,
            [Q.s, Q.d, t, json, body.active === 0 ? 0 : 1, cid, +body.id]);
          return out({ ok: true, id: +body.id });
        }
        const rows = await q(`INSERT INTO questions(s,d,t,data,active,course_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
          [Q.s, Q.d, t, json, body.active === 0 ? 0 : 1, cid]);
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
          `SELECT r.id,r.name,r.ch,r.mode,r.score,r.total,r.pct,r.created,u.email,
                  c.name_ar AS course_ar, c.code AS course_code
           FROM results r
           LEFT JOIN users u ON u.id=r.user_id
           LEFT JOIN courses c ON c.id=r.course_id
           ORDER BY r.id DESC LIMIT 2000`);
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
        /* لوحة لكل دورة: أسئلة، مشتركون نشطون، طلبات معلقة، محاولات، متوسط النتيجة */
        st.per_course = await q(`SELECT c.id, c.code, c.name_ar, c.active,
            COALESCE(qq.qc,0)::int AS questions,
            COALESCE(ea.ac,0)::int AS active_enroll,
            COALESCE(ep.pc,0)::int AS pending_enroll,
            COALESCE(rr.rc,0)::int AS attempts,
            COALESCE(rr.avgp,0)::int AS avg_pct
          FROM courses c
          LEFT JOIN (SELECT course_id, COUNT(*) qc FROM questions WHERE active=1 GROUP BY course_id) qq ON qq.course_id=c.id
          LEFT JOIN (SELECT course_id, COUNT(*) ac FROM enrollments WHERE status='active' GROUP BY course_id) ea ON ea.course_id=c.id
          LEFT JOIN (SELECT course_id, COUNT(*) pc FROM enrollments WHERE status='pending' GROUP BY course_id) ep ON ep.course_id=c.id
          LEFT JOIN (SELECT course_id, COUNT(*) rc, ROUND(AVG(pct)) avgp FROM results GROUP BY course_id) rr ON rr.course_id=c.id
          ORDER BY c.sort, c.id`);
        return out({ ok: true, stats: st });
      }

      default: return out({ ok: false, err: 'unknown_action' }, 404);
    }
  } catch (e) {
    return out({ ok: false, err: 'server', msg: String(e.message || e) }, 500);
  }
}
