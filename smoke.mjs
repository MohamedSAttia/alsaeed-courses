/* اختبار دخاني شامل لواجهة API — يعمل محليًا على Postgres حقيقي */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://saeed:saeed@127.0.0.1:5432/saeedtest';
process.env.PG_DIRECT = '1';
process.env.AUTH_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'admin@al-ltc.com';
process.env.ADMIN_PASSWORD = 'Saeed@2026';

const { default: handler } = await import('../api/app.js');

let PASS = 0, FAIL = 0;
function assert(cond, label) {
  if (cond) { PASS++; console.log('  ✔', label); }
  else { FAIL++; console.log('  ✘ FAILED:', label); }
}

const jars = {}; // cookie jars per persona
async function call(persona, action, body, method) {
  const req = {
    method: method || (body ? 'POST' : 'GET'),
    query: { action },
    body: body || undefined,
    headers: { cookie: jars[persona] || '' }
  };
  let status = 200, data = null, setCookie = null;
  const res = {
    setHeader(k, v) { if (k.toLowerCase() === 'set-cookie') setCookie = v; },
    set statusCode(c) { status = c; }, get statusCode() { return status; },
    end(s) { data = JSON.parse(s); }
  };
  await handler(req, res);
  if (setCookie) jars[persona] = setCookie.split(';')[0];
  return { status, data };
}

console.log('— بدء الاختبار الدخاني —');

// 0) boot (guest)
let r = await call('guest', 'boot');
assert(r.data.ok && r.data.settings.price === '120', 'boot: settings seeded with price');
assert(Object.values(r.data.counts).reduce((a, b) => a + b, 0) === 198, 'boot: 198 questions seeded');
assert(r.data.me === null && r.data.canExam === false, 'boot: guest has no session, no exam access');

// 1) guest cannot fetch questions
r = await call('guest', 'questions');
assert(r.status === 403 && r.data.err === 'auth', 'questions blocked for guests');

// 2) register student (not allowed-listed) -> pending
r = await call('sara', 'register', { email: 'sara@example.com', name: 'سارة أحمد', phone: '0500000000', pass: 'Password1' });
assert(r.data.ok && r.data.status === 'pending', 'register: new student is pending');
r = await call('sara', 'me');
assert(r.data.me && r.data.me.email === 'sara@example.com' && r.data.canExam === false, 'me: pending student cannot take exam');
r = await call('sara', 'questions');
assert(r.status === 403 && r.data.err === 'inactive', 'questions blocked for pending student');

// 3) duplicate + weak password rejected
r = await call('x', 'register', { email: 'sara@example.com', name: 'أخرى', pass: 'Password1' });
assert(!r.data.ok && r.data.err === 'exists', 'register: duplicate email rejected');
r = await call('x', 'register', { email: 'weak@example.com', name: 'ضعيف كلمة', pass: '123' });
assert(!r.data.ok && r.data.err === 'weak', 'register: weak password rejected');

// 4) admin login
r = await call('admin', 'login', { email: 'admin@al-ltc.com', pass: 'Saeed@2026' });
assert(r.data.ok && r.data.role === 'admin', 'admin login');
r = await call('admin', 'login', { email: 'admin@al-ltc.com', pass: 'wrong' });
assert(!r.data.ok && r.data.err === 'creds', 'wrong password rejected');
r = await call('admin', 'login', { email: 'admin@al-ltc.com', pass: 'Saeed@2026' }); // restore session

// 5) admin adds allowed emails (bulk) with auto-activate; sara already registered -> activated
r = await call('admin', 'add_allowed', { emails: 'sara@example.com, khaled@example.com\nbad-email', note: 'دفعة يوليو', auto_active: true });
assert(r.data.ok && r.data.added === 2 && r.data.activated === 1 && r.data.bad.length === 1, 'add_allowed: bulk add, auto-activated existing user, rejected bad email');
r = await call('sara', 'me');
assert(r.data.me.status === 'active' && r.data.canExam === true, 'sara auto-activated by allowlist');

// 6) khaled registers with allow-listed email -> active immediately
r = await call('khaled', 'register', { email: 'khaled@example.com', name: 'خالد سعيد', pass: 'Password1' });
assert(r.data.ok && r.data.status === 'active', 'register: allow-listed email is active immediately');

// 7) active student can pull questions & save result
r = await call('sara', 'questions');
assert(r.data.ok && r.data.questions.length === 198 && r.data.questions[0].q.a, 'questions: active student receives full bank');
r = await call('sara', 'save_result', { ch: 0, mode: 'e', score: 150, total: 185, pct: 81, detail: { P: 80, W: 82, B: 79 } });
assert(r.data.ok, 'save_result');
r = await call('sara', 'my_results');
assert(r.data.ok && r.data.results.length === 1 && r.data.results[0].pct === 81, 'my_results');

// 8) payment flow: new pending user submits reference, admin approves -> activated
r = await call('omar', 'register', { email: 'omar@example.com', name: 'عمر محمد', pass: 'Password1' });
assert(r.data.status === 'pending', 'omar pending');
r = await call('omar', 'submit_payment', { amount: '120', method: 'تحويل بنكي', ref: 'TRX-778899', note: 'حوالة من الراجحي' });
assert(r.data.ok, 'submit_payment');
r = await call('admin', 'payments_list');
assert(r.data.ok && r.data.payments[0].ref === 'TRX-778899' && r.data.payments[0].email === 'omar@example.com', 'payments_list shows submission with user email');
const payId = r.data.payments[0].id;
r = await call('admin', 'set_payment_status', { id: payId, status: 'approved' });
assert(r.data.ok, 'approve payment');
r = await call('omar', 'me');
assert(r.data.me.status === 'active' && r.data.canExam, 'omar activated after payment approval');

// 9) admin user management
r = await call('admin', 'users');
assert(r.data.ok && r.data.users.length >= 4, 'users list');
const omar = r.data.users.find(u => u.email === 'omar@example.com');
r = await call('admin', 'set_user_status', { id: omar.id, status: 'blocked' });
assert(r.data.ok, 'block user');
r = await call('omar', 'login', { email: 'omar@example.com', pass: 'Password1' });
assert(!r.data.ok && r.data.err === 'blocked', 'blocked user cannot login');
await call('admin', 'set_user_status', { id: omar.id, status: 'active' });
r = await call('admin', 'reset_user_password', { id: omar.id, pass: 'NewPass123' });
assert(r.data.ok, 'reset user password');
r = await call('omar2', 'login', { email: 'omar@example.com', pass: 'NewPass123' });
assert(r.data.ok, 'login with reset password');
r = await call('admin', 'create_user', { email: 'vip@example.com', name: 'ضيف مميز', status: 'active' });
assert(r.data.ok && r.data.pass.length >= 8, 'create_user returns generated password');
r = await call('vip', 'login', { email: 'vip@example.com', pass: r.data.pass });
assert(r.data.ok, 'created user can login');

// 10) student cannot hit admin actions
r = await call('sara', 'users');
assert(r.status === 403, 'admin actions blocked for students');
r = await call('sara', 'save_settings', { price: '1' });
assert(r.status === 403, 'save_settings blocked for students');

// 11) admin question CRUD
r = await call('admin', 'save_question', { q: { s: 1, d: 'W', t: 'mc', q: { a: 'سؤال تجريبي؟', e: 'Test?' }, o: [{ a: 'أ' }, { a: 'ب' }], c: 0, x: 'شرح' } });
assert(r.data.ok && r.data.id, 'save_question insert');
const qid = r.data.id;
r = await call('admin', 'save_question', { id: qid, q: { s: 2, d: 'P', t: 'mc', q: { a: 'سؤال معدل؟' }, o: [{ a: 'أ' }, { a: 'ب' }, { a: 'ج' }], c: 2, x: 'شرح' } });
assert(r.data.ok, 'save_question update');
r = await call('admin', 'save_question', { q: { s: 1, d: 'W', t: 'mc', q: { a: 'ناقص' }, o: [{ a: 'أ' }], c: 5, x: '' } });
assert(!r.data.ok && r.data.err === 'structure', 'save_question structural validation');
r = await call('admin', 'toggle_question', { id: qid });
assert(r.data.ok, 'toggle_question');
r = await call('admin', 'delete_question', { id: qid });
assert(r.data.ok, 'delete_question');

// 12) videos + settings + stats
r = await call('admin', 'save_video', { ta: 'مقدمة PMP', url: 'https://youtu.be/abc123xyz' });
assert(r.data.ok, 'save_video');
r = await call('guest', 'boot');
assert(r.data.videos.length === 1, 'video visible in boot');
r = await call('admin', 'save_settings', { price: '150', free_mode: '0', bank_info: 'IBAN SA00 0000' });
assert(r.data.ok, 'save_settings');
r = await call('guest', 'boot');
assert(r.data.settings.price === '150', 'settings persisted');
r = await call('admin', 'stats');
assert(r.data.ok && r.data.stats.users === 4 && r.data.stats.questions === 198, 'stats');

// 13) free_mode opens the exam for guests
await call('admin', 'save_settings', { free_mode: '1' });
r = await call('guest', 'questions');
assert(r.data.ok && r.data.questions.length === 198, 'free_mode=1: guests can access questions');
await call('admin', 'save_settings', { free_mode: '0' });

// 14) allowed list view/delete + results admin
r = await call('admin', 'allowed_list');
assert(r.data.ok && r.data.allowed.length === 2, 'allowed_list');
r = await call('admin', 'delete_allowed', { email: 'khaled@example.com' });
assert(r.data.ok, 'delete_allowed');
r = await call('admin', 'results');
assert(r.data.ok && r.data.results.length === 1 && r.data.results[0].email === 'sara@example.com', 'admin results with email');

// 15) profile + password change + logout
r = await call('sara', 'update_profile', { name: 'سارة أحمد السعيد', phone: '0511111111' });
assert(r.data.ok, 'update_profile');
r = await call('sara', 'change_password', { old: 'Password1', new: 'Password22' });
assert(r.data.ok, 'change_password');
r = await call('sara', 'change_password', { old: 'wrong', new: 'Password33' });
assert(!r.data.ok && r.data.err === 'old', 'change_password rejects wrong old');
r = await call('sara', 'logout');
assert(r.data.ok, 'logout');
r = await call('sara', 'me');
assert(r.data.me === null, 'session cleared after logout');

console.log(`\n— النتيجة: ${PASS} ناجح / ${FAIL} فاشل —`);
process.exit(FAIL ? 1 : 0);
