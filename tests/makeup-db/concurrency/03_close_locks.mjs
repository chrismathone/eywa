/** 종결 ↔ 출결 관측 ↔ 대사 실행이 같은 케이스 잠금을 쓴다 (잔여 7 — MU-053 · MU-X16·X17).
 * 종결은 케이스 행 잠금을 쥔 채 미결 항목을 센다. 관측 트리거와 대사 실행도 쓰기 전에 그 행을 잠그므로 순서가 선다:
 *   종결이 먼저 → 관측은 기다렸다가 **닫힌 건에** 항목을 남긴다 / 관측이 먼저 → 종결은 기다렸다가 그 항목을 보고 닫지 않는다.
 * 여기 데이터는 커밋된다 — 끝나면 합성 학원을 지워(연쇄 삭제) 치운다. 격리 DB 전용.
 */
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lit = (v) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
const cmd = (actor, action, payload, rev = null) => `select mt.cmd('${id(actor)}', '${action}', ${lit(payload)}, ${rev ?? 'null'}) as r`;
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
    const dates = await one(a, 'select mt.d(0)::text as d0, mt.d(-13)::text as m13');
    const rev = async (table, rowId) => (await one(a, `select revision from public.${table} where id = '${rowId}'`)).revision;
    /** 검토까지 끝냈지만 50분이 남아 열려 있는 건 + 맞는 출결 행(보강 1.0)을 만든다. */
    const prepared = async (student, periods) => {
      const c = (await one(a, cmd(22, 'intake', { student_id: id(student), original_class_id: id(51), original_date: dates.m13 }))).r.id;
      await a.unsafe(cmd(22, 'approve', { case_id: c, target_minutes: 110 }, await rev('makeup_cases', c)));
      const part = (await one(a, cmd(22, 'reserve', { student_id: id(student), session_date: dates.d0, period_ids: periods,
        teacher_id: id(25), classroom_id: id(41), allocations: [{ case_id: c, minutes: 110 }] }))).r.participant_id;
      const att = (await one(a, `insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
        values ('${id(11)}', '${id(51)}', '${id(student)}', '${dates.d0}', 'makeup', 1, '${id(25)}') returning id as r`)).r;
      await a.unsafe(cmd(25, 'participation', { participant_id: part, status: 'present', actual_minutes: 110, attendance_record_id: att }));
      const ful = (await one(a, cmd(25, 'submit', { participant_id: part, learning_summary: '합성 지도 내용' }))).r.id;
      await a.unsafe(cmd(22, 'verify', { fulfillment_id: ful, recognitions: [{ case_id: c, minutes: 60 }] }, await rev('makeup_fulfillments', ful)));
      return { c, part, att };
    };
    const state = async (x) => one(a, `select c.lifecycle, c.outstanding_minutes as o,
      (select count(*)::int from public.makeup_reconciliation r where r.participant_id = '${x.part}' and r.state = 'open' and r.blocks_close) as blockers
      from public.makeup_cases c where c.id = '${x.c}'`);
    const waive = async (x) => cmd(22, 'waive', { case_id: x.c, minutes: 50, reason: '합성 면제' }, await rev('makeup_cases', x.c));
    const spoil = (x) => `update public.attendance_records set session_units = 3 where id = '${x.att}' returning id as r`;

    const X = await prepared(61, ['1', '2']);
    const Y = await prepared(62, ['3', '4']);
    ok((await state(X)).lifecycle === 'open' && (await state(X)).o === 50 && (await state(X)).blockers === 0, '준비: 50분 남은 열린 건 · 미결 항목 없음');

    // ① 종결이 먼저: 남은 분량을 면제해 닫는 중(미커밋)에 출결이 바뀐다 → 관측은 줄을 섰다가 닫힌 건에 항목을 남긴다.
    const waiveX = await waive(X);
    await a.unsafe('begin');
    await a.unsafe(waiveX);
    const late = settle(b.unsafe(spoil(X)));
    ok(await waiting(late), '종결 중인 건의 출결 관측은 같은 케이스 잠금에 줄을 선다');
    await a.unsafe('commit');
    ok((await late).ok, 'MU-X16 줄을 섰던 출결 저장은 그대로 성공한다(거절·되돌림 없음)');
    const sx = await state(X);
    ok(sx.lifecycle === 'closed' && sx.blockers === 1, 'MU-X17 종결이 먼저 끝났으면 항목은 닫힌 건에 보이게 남는다(조용히 사라지지 않는다)');

    // ② 관측이 먼저: 출결이 바뀌어 항목이 열리는 중(미커밋)에 종결을 시도 → 종결은 줄을 섰다가 그 항목을 보고 닫지 않는다.
    const waiveY = await waive(Y);
    await a.unsafe('begin');
    await a.unsafe(spoil(Y));
    const closing = settle(b.unsafe(waiveY));
    ok(await waiting(closing), '출결 관측 중인 건의 종결은 같은 케이스 잠금에 줄을 선다');
    await a.unsafe('commit');
    ok((await closing).ok, '면제 자체는 처리된다');
    const sy = await state(Y);
    ok(sy.lifecycle === 'open' && sy.o === 0 && sy.blockers === 1, 'MU-X17 막 생긴 항목을 종결이 놓치지 않는다(남은 분량 0이어도 열려 있다)');
    const forced = await settle(b.unsafe(cmd(22, 'close', { case_id: Y.c, closure_reason: 'completed_with_waiver', reason: '합성' }, await rev('makeup_cases', Y.c))));
    ok(!forced.ok && String(forced.code).includes('"conflict"'), '수동 종결도 그 항목 때문에 거절');

    // ③ 대사 실행도 같은 잠금을 쓴다: 실행 중(미커밋)에는 그 지점의 케이스 명령이 줄을 서고, 끝나면 이어진다.
    await a.unsafe('begin');
    const run1 = (await one(a, cmd(24, 'reconcile', { reason: '합성 대사' }))).r.run;
    const adjust = settle(b.unsafe(cmd(22, 'assign', { case_id: Y.c, owner_id: id(26), reason: '합성' }, await rev('makeup_cases', Y.c))));
    ok(run1.status === 'succeeded' && (await waiting(adjust)), 'MU-053 대사 실행 중인 지점의 케이스 명령은 줄을 선다');
    await a.unsafe('commit');
    ok((await adjust).ok, '대사 실행이 끝나면 명령이 이어진다');
    ok((await state(X)).blockers === 1 && (await state(Y)).blockers === 1, '대사 실행은 열려 있는 항목을 그대로 둔다(자동으로 닫거나 고치지 않는다)');
    const units = await one(a, `select string_agg(session_units::text, ',' order by id) as u from public.attendance_records where id in ('${X.att}', '${Y.att}')`);
    ok(units.u === '3.0,3.0', '어느 순서에서도 출결 시수는 사람이 넣은 값 그대로');
    return checks;
  } finally {
    await a.unsafe('rollback').catch(() => {});
    await b.unsafe('rollback').catch(() => {});
    await wipe().catch(() => {});
    await a.end({ timeout: 5 });
    await b.end({ timeout: 5 });
  }
}
