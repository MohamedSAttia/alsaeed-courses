/* اختبار دخاني للمحرك متعدد الدورات */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://saeed:saeed@127.0.0.1:5432/saeedmc';
process.env.PG_DIRECT = '1';
process.env.AUTH_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'admin@al-ltc.com';
process.env.ADMIN_PASSWORD = 'Saeed@2026';

const { default: handler } = await import('../api/app.js');
let PASS = 0, FAIL = 0;
const assert = (c, l) => { c ? (PASS++, console.log('  ✔', l)) : (FAIL++, console.log('  ✘ FAILED:', l)); };
const jars = {};
async function call(persona, action, body, extraQuery) {
  const req = { method: body ? 'POST' : 'GET', query: { action, ...(extraQuery || {}) }, body, headers: { cookie: jars[persona] || '' } };
  let status = 200, data = null, setCookie = null;
  const res = {
    setHeader(k, v) { if (k.toLowerCase() === 'set-cookie') setCookie = v; },
    set statusCode(c) { status = c; }, get statusCode() { return status; },
    end(s) { data = JSON.parse(s); }
  };
  await handler(req, res);
  if (setCookie) jars[persona] = String(setCookie).split(';')[0];
  return { status, data };
}

console.log('— المحرك متعدد الدورات —');

/* 1) الكتالوج في boot */
let r = await call('guest', 'boot');
assert(r.data.ok && Array.isArray(r.data.courses) && r.data.courses.length >= 8, 'boot returns seeded course catalog (8+)');
const pmp = r.data.courses.find(c => c.code === 'pmp');
const rmp = r.data.courses.find(c => c.code === 'rmp');
assert(pmp && pmp.active === 1 && pmp.qcount >= 190, 'PMP active with seeded questions');
assert(rmp && rmp.active === 0, 'RMP seeded as coming-soon');

/* 2) دخول الأدمن وإنشاء دورة جديدة */
await call('admin', 'login', { email: 'admin@al-ltc.com', pass: 'Saeed@2026' });
r = await call('admin', 'save_course', { code: 'rmp2', name_ar: 'محاكاة اختبارية RMP2', sec_per_q: 90, passing_score: 65, price: '50', active: 1, chapters: [{ s: 1, ar: 'التخطيط', en: 'Planning' }, { s: 2, ar: 'التحليل', en: 'Analysis' }] });
assert(r.data.ok && r.data.id, 'save_course creates a new course');
const cid = r.data.id;
r = await call('admin', 'save_course', { code: 'pmp', name_ar: 'تكرار' });
assert(!r.data.ok && r.data.err === 'exists', 'duplicate course code rejected');

/* 3) سؤال داخل الدورة الجديدة */
r = await call('admin', 'save_question', { course_id: cid, q: { s: 1, d: 'W', t: 'mc', q: { a: 'سؤال تجريبي؟', e: 'Test?' }, o: [{ a: 'أ' }, { a: 'ب' }], c: 0, x: 'شرح' } });
assert(r.data.ok, 'save_question into new course');
r = await call('admin', 'admin_questions', null, { course: String(cid) });
assert(r.data.ok && r.data.questions.length === 1, 'admin_questions filtered by course');
r = await call('admin', 'admin_questions', null, { course: 'pmp' });
assert(r.data.ok && r.data.questions.length >= 190, 'PMP bank untouched');

/* 4) متدرب: تسجيل، بوابة الوصول لكل دورة */
await call('stu', 'register', { email: 'mc-student@test.com', name: 'متدرب الدورات', pass: 'Passw0rd123' });
r = await call('stu', 'questions', null, { course: 'pmp' });
assert(!r.data.ok && r.data.err === 'inactive', 'pending student blocked from PMP');
r = await call('stu', 'questions', null, { course: 'rmp' });
assert(!r.data.ok && r.data.err === 'soon', 'coming-soon course blocked');

/* 5) اشتراك + دفع + اعتماد → تفعيل تلك الدورة فقط */
r = await call('stu', 'enroll', { course: 'rmp2' });
assert(r.data.ok && r.data.status === 'pending', 'enroll creates pending enrollment');
await call('stu', 'submit_payment', { ref: 'TRX-999', amount: '50', method: 'تحويل', course: 'rmp2' });
r = await call('admin', 'payments_list');
const pay = r.data.payments.find(p => p.ref === 'TRX-999');
assert(pay && pay.course_code === 'rmp2', 'payment linked to its course');
await call('admin', 'set_payment_status', { id: pay.id, status: 'approved' });
r = await call('stu', 'questions', null, { course: 'rmp2' });
assert(r.data.ok && r.data.questions.length === 1 && r.data.course.passing_score === 65, 'approval activates that course only + course meta returned');
assert(r.data.course.chapters.length === 2 && r.data.course.chapters[0].ar === 'التخطيط', 'dynamic chapters delivered');
r = await call('stu', 'questions', null, { course: 'pmp' });
assert(!r.data.ok, 'PMP still locked for this student');

/* 6) نتيجة مرتبطة بالدورة */
await call('stu', 'save_result', { ch: 0, mode: 'e', score: 1, total: 1, pct: 100, course_id: cid });
r = await call('stu', 'my_results');
assert(r.data.ok && r.data.results[0].course_code === 'rmp2' && r.data.results[0].passing_score === 65, 'my_results carries course info');
r = await call('admin', 'results');
assert(r.data.results.some(x => x.course_code === 'rmp2'), 'admin results include course');

/* 7) الاشتراكات إداريًا + إحصاءات لكل دورة */
r = await call('admin', 'enrollments_list');
const enr = r.data.enrollments.find(e => e.course_code === 'rmp2');
assert(enr && enr.status === 'active', 'enrollments_list shows activated enrollment');
await call('admin', 'set_enrollment', { id: enr.id, status: 'blocked' });
r = await call('stu', 'questions', null, { course: 'rmp2' });
assert(!r.data.ok, 'blocking enrollment revokes access');
r = await call('admin', 'stats');
const pc = r.data.stats.per_course.find(c => c.code === 'rmp2');
assert(pc && pc.questions === 1 && pc.attempts === 1 && pc.avg_pct === 100, 'per-course stats correct');

/* 8) البريد المسموح بدورة محددة */
await call('admin', 'add_allowed', { emails: 'vip@test.com', course_code: 'rmp2', auto_active: true });
await call('vip', 'register', { email: 'vip@test.com', name: 'متدرب مسموح', pass: 'Passw0rd123' });
r = await call('vip', 'questions', null, { course: 'rmp2' });
assert(r.data.ok, 'allowed email auto-activates its specific course');
r = await call('vip', 'questions', null, { course: 'pmp' });
assert(!r.data.ok, 'allowed email does NOT open other courses');

/* 9) حماية الدورة الأساسية + حذف بقوة */
r = await call('admin', 'delete_course', { id: 1 });
assert(!r.data.ok && r.data.err === 'core', 'core PMP course protected from deletion');
r = await call('admin', 'delete_course', { id: cid });
assert(!r.data.ok && r.data.err === 'has_questions', 'deletion warns when course has questions');
r = await call('admin', 'delete_course', { id: cid, force: 1 });
assert(r.data.ok, 'forced deletion removes course with its data');

console.log(`\n— النتيجة: ${PASS} ناجح / ${FAIL} فاشل —`);
process.exit(FAIL ? 1 : 0);
