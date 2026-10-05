/** 두 연결이 실제로 겹치는 경합 (MU-001·015·066·067 · MU-X13).
 * 여기 데이터는 커밋된다 — 끝나면 합성 학원을 지워(연쇄 삭제) 치운다. 격리 DB 전용.
 */
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lit = (v) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
const cmd = (actor, action, payload, rev = null, cid = null) =>
  `select mt.cmd('${id(actor)}', '${action}', ${lit(payload)}, ${rev ?? 'null'}${cid ? `, '${cid}'` : ''}) as r`;
/** 아직 안 끝났으면 true(= 잠금에 줄 서 있다). */
async function waiting(promise, ms = 500) {
  let done = false;
  promise.then(() => (done = true), () => (done = true));
  await sleep(ms);
  return !done;
}
const settle = (p) => p.then((rows) => ({ ok: true, r: rows.at(-1)?.r }), (e) => ({ ok: false, code: e.detail ?? e.message }));

export default async function run({ connect, assert }) {
  const a = connect();
  const b = connect();
  const one = async (c, text) => (await c.unsafe(text)).at(-1);
  let checks = 0;
  const ok = (cond, name) => { assert.ok(cond, name); checks++; };
  const wipe = () => a.unsafe(`delete from public.tenants where id in ('${id(11)}', '${id(12)}')`);
  try {
    await wipe();
    await a.unsafe('select mt.seed_on()');
    const intake = (student, klass, day) => ({ student_id: id(student), original_class_id: id(klass), original_date: '__D__' + day });
    // 날짜는 DB에서 만든다(오늘 KST 기준).
    const dates = (await one(a, 'select mt.d(0)::text as d0, mt.d(3)::text as d3, mt.d(-5)::text as m5, mt.d(-6)::text as m6'));
    const fix = (p) => JSON.parse(JSON.stringify(p).replaceAll('__D__-5', dates.m5).replaceAll('__D__-6', dates.m6));
    const approved = async (student, klass, day, minutes) => {
      const c = (await one(a, cmd(22, 'intake', fix(intake(student, klass, day))))).r.id;
      const rev = (await one(a, `select revision from public.makeup_cases where id = '${c}'`)).revision;
      await a.unsafe(cmd(22, 'approve', { case_id: c, target_minutes: minutes }, rev));
      return c;
    };
    const reserve = (student, c, day, periods, extra = {}) => ({
      student_id: id(student), session_date: day, period_ids: periods, teacher_id: id(25), classroom_id: id(41),
      allocations: [{ case_id: c, minutes: 50 }], ...extra,
    });

    // MU-001 같은 원수업을 두 연결이 동시에 접수 → 케이스 1건.
    await a.unsafe('begin');
    const first = (await one(a, cmd(22, 'intake', fix(intake(63, 51, -6))))).r.id;
    const second = settle(b.unsafe(cmd(24, 'intake', fix(intake(63, 51, -6)))));
    ok(await waiting(second), 'MU-001 둘째 접수는 첫째가 끝날 때까지 줄을 선다');
    await a.unsafe('commit');
    ok((await second).r.id === first, 'MU-001 동시 접수 → 같은 케이스');
    ok((await one(a, `select count(*)::int as n from public.makeup_cases`)).n === 1, 'MU-001 케이스 1건');

    // MU-067 같은 요청 번호를 동시에 → 한 번만 실행, 둘째는 replayed.
    const cid = (await one(a, 'select gen_random_uuid() as u')).u;
    await a.unsafe('begin');
    await a.unsafe(cmd(22, 'intake', fix(intake(62, 51, -6)), null, cid));
    const dup = settle(b.unsafe(cmd(22, 'intake', fix(intake(62, 51, -6)), null, cid)));
    ok(await waiting(dup), 'MU-067 같은 요청 번호는 줄을 선다');
    await a.unsafe('commit');
    ok((await dup).r.replayed === true, 'MU-067 둘째는 저장된 결과(replayed)');
    ok((await one(a, `select count(*)::int as n from public.makeup_commands where command_id = '${cid}'`)).n === 1, '명령 기록 1건');

    // MU-015 마지막 자리: 정원 2 중 1자리 남은 회차에 두 학생이 동시에 합류 → 한 요청만 통과.
    const cD = await approved(64, 52, -5, 120);
    const cE = await approved(65, 52, -5, 120);
    const cB = await approved(62, 51, -6, 120);
    const crev0 = (await one(a, `select revision from public.makeup_cases where id = '${first}'`)).revision;
    await a.unsafe(cmd(22, 'approve', { case_id: first, target_minutes: 120 }, crev0));
    const seat = (await one(a, cmd(22, 'reserve', reserve(64, cD, dates.d3, ['1', '2'], { capacity: 2 })))).r;
    const join = (student, c) => cmd(22, 'reserve', { session_id: seat.session_id, student_id: id(student), allocations: [{ case_id: c, minutes: 50 }] });
    await a.unsafe('begin');
    await a.unsafe(join(65, cE));
    const rival = settle(b.unsafe(join(62, cB)));
    ok(await waiting(rival), 'MU-015 경쟁 예약은 문 잠금에 줄을 선다');
    await a.unsafe('commit');
    const lost = await rival;
    ok(!lost.ok && String(lost.code).includes('"conflict"'), 'MU-015 늦은 요청은 충돌로 거절');
    ok((await one(a, `select count(*)::int as n from public.makeup_participants where session_id = '${seat.session_id}' and status <> 'cancelled'`)).n === 2, 'MU-015 정원 초과 없음');

    // MU-X13 ① 예약 확정 중 정규 시간표 저장 → 줄을 섰다가 저장은 성공하고 영향 큐에 남는다.
    const slot = await one(a, `select start_time::text as s, end_time::text as e from public.makeup_sessions where id = '${seat.session_id}'`);
    await a.unsafe('begin');
    const mine = (await one(a, cmd(22, 'reserve', reserve(62, cB, dates.d0, ['1', '2'])))).r;
    const sched = settle(b.unsafe(`insert into public.class_schedules (id, tenant_id, class_id, day_of_week, start_time, end_time, valid_from, classroom_id)
      select '${id(77)}', '${id(11)}', '${id(51)}', mt.dow(mt.d(0)), s.start_time, s.end_time, mt.d(-10), '${id(42)}' from public.makeup_sessions s where s.id = '${seat.session_id}' returning id as r`));
    ok(await waiting(sched), 'MU-X13 정규 시간표 저장이 같은 문에 줄을 선다');
    await a.unsafe('commit');
    ok((await sched).ok, 'MU-X13 정규 시간표 저장은 거절되지 않는다');
    ok((await one(a, `select count(*)::int as n from public.makeup_reconciliation where dedupe_key = 'tt:teacher:${mine.session_id}'`)).n === 1, 'MU-X13 커밋된 예약과의 충돌이 영향 큐에 남는다');
    await a.unsafe(`delete from public.class_schedules where id = '${id(77)}'`);

    // MU-X13 ② 정규 시간표 저장 중 예약 확정 → 줄을 섰다가 바뀐 시간표를 보고 거절된다.
    await a.unsafe('begin');
    await a.unsafe(`insert into public.class_schedules (id, tenant_id, class_id, day_of_week, start_time, end_time, valid_from, classroom_id)
      values ('${id(78)}', '${id(11)}', '${id(51)}', mt.dow(mt.d(3)), '${slot.s}', '${slot.e}', mt.d(-10), '${id(42)}')`);
    const late = settle(b.unsafe(cmd(22, 'reserve', reserve(63, first, dates.d3, ['1', '2'], { classroom_id: id(42), teacher_id: id(26) }))));
    ok(await waiting(late), 'MU-X13 예약 확정이 정규 시간표 저장을 기다린다');
    await a.unsafe('commit');
    const res = await late;
    ok(!res.ok && String(res.code).includes('"conflict"'), 'MU-X13 바뀐 시간표와 충돌하는 예약은 거절');
    await a.unsafe(`delete from public.class_schedules where id = '${id(78)}'`);

    // MU-066 검토와 면제가 같은 케이스에 동시에 → 케이스 잠금으로 순서가 서고 초과 처리는 거절.
    const partB = mine.participant_id;
    await a.unsafe(cmd(25, 'participation', { participant_id: partB, status: 'present', actual_minutes: 50, learning_summary: '합성 지도 내용' }));
    const ful = (await one(a, cmd(25, 'submit', { participant_id: partB, learning_summary: '합성' }))).r.id;
    const frev = (await one(a, `select revision from public.makeup_fulfillments where id = '${ful}'`)).revision;
    const crev = (await one(a, `select revision from public.makeup_cases where id = '${cB}'`)).revision;
    await a.unsafe('begin');
    await a.unsafe(cmd(22, 'verify', { fulfillment_id: ful, recognitions: [{ case_id: cB, minutes: 50 }] }, frev));
    const waive = settle(b.unsafe(cmd(23, 'waive', { case_id: cB, minutes: 120, reason: '합성 동시 면제' }, crev)));
    ok(await waiting(waive), 'MU-066 같은 케이스의 다른 명령은 줄을 선다');
    await a.unsafe('commit');
    const w = await waive;
    ok(!w.ok && String(w.code).includes('"stale_revision"'), 'MU-066 먼저 끝난 검토 뒤의 옛 화면 면제는 거절(덮어쓰기 없음)');
    const q = await one(a, `select outstanding_minutes as o, committed_minutes as c, recognized_minutes as r, waived_minutes as w from public.makeup_cases where id = '${cB}'`);
    ok(q.o === 70 && q.c === 0 && q.r === 50 && q.w === 0, 'MU-066 수량은 한 번만 반영(O=70·C=0·인정 50)');
    return checks;
  } finally {
    await a.unsafe('rollback').catch(() => {});
    await b.unsafe('rollback').catch(() => {});
    await wipe().catch(() => {});
    await a.end({ timeout: 5 });
    await b.end({ timeout: 5 });
  }
}
