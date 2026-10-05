/** 노쇼 되돌리기 ↔ 마지막 자리 합류가 실제로 겹치는 경합 (보완 5 — MU-015·020).
 * 두 방향 모두: 먼저 잡은 쪽이 끝난 뒤에야 다른 쪽이 정원을 다시 세고, 늦은 쪽은 거절된다(정원 초과 없음).
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
    const approved = async (student) => {
      const c = (await one(a, cmd(22, 'intake', { student_id: id(student), original_class_id: id(51), original_date: dates.m13 }))).r.id;
      const rev = (await one(a, `select revision from public.makeup_cases where id = '${c}'`)).revision;
      await a.unsafe(cmd(22, 'approve', { case_id: c, target_minutes: 240 }, rev));
      return c;
    };
    const [cA, cB, cC] = [await approved(61), await approved(62), await approved(63)];
    // 회차: 오늘 1~2교시 · 정원 2. 학생A가 열고 학생B가 합류(만석) → 학생A 노쇼(1자리 빔).
    const seat = (await one(a, cmd(22, 'reserve', {
      student_id: id(61), session_date: dates.d0, period_ids: ['1', '2'], teacher_id: id(25), classroom_id: id(41), capacity: 2,
      allocations: [{ case_id: cA, minutes: 50 }],
    }))).r;
    const join = (student, c) => cmd(22, 'reserve', { session_id: seat.session_id, student_id: id(student), allocations: [{ case_id: c, minutes: 50 }] });
    await a.unsafe(join(62, cB));
    const noShow = cmd(25, 'participation', { participant_id: seat.participant_id, status: 'no_show' });
    const restore = cmd(25, 'participation', { participant_id: seat.participant_id, status: 'present', actual_minutes: 50, learning_summary: '합성 지도 내용' });
    const taken = async () => (await one(a, `select count(*)::int as n from public.makeup_participants
      where session_id = '${seat.session_id}' and status in ('unknown', 'present', 'partial')`)).n;
    const stateA = async () => (await one(a, `select p.status, al.released_minutes as rel from public.makeup_participants p
      join public.makeup_allocations al on al.participant_id = p.id where p.id = '${seat.participant_id}'`));
    await a.unsafe(noShow);
    ok((await taken()) === 1, '노쇼 뒤 한 자리가 비었다');

    // ① 되돌리기가 먼저 문을 잡는다 → 합류는 줄을 섰다가, 되돌린 뒤의 정원을 보고 거절된다.
    await a.unsafe('begin');
    await a.unsafe(restore);
    const rival = settle(b.unsafe(join(63, cC)));
    ok(await waiting(rival), '되돌리기 중인 회차의 합류는 같은 문에 줄을 선다');
    await a.unsafe('commit');
    const lost = await rival;
    ok(!lost.ok && String(lost.code).includes('"conflict"'), '되돌리기가 먼저 끝나면 늦은 합류는 거절');
    ok((await taken()) === 2, '정원 초과 없음(되돌린 학생A + 학생B)');
    ok((await stateA()).status === 'present' && (await stateA()).rel === 0, '학생A는 왔다로 돌아오고 배정도 다시 선다');

    // ② 반대 순서: 합류가 먼저 문을 잡는다 → 되돌리기는 줄을 섰다가, 찬 자리를 보고 거절된다(예전 자리를 되살리지 않는다).
    await a.unsafe(noShow);
    ok((await taken()) === 1, '다시 노쇼 → 한 자리가 비었다');
    await a.unsafe('begin');
    const joined = (await one(a, join(63, cC))).r;
    const late = settle(b.unsafe(restore));
    ok(await waiting(late), '합류 중인 회차의 노쇼 되돌리기는 같은 문에 줄을 선다');
    await a.unsafe('commit');
    const res = await late;
    ok(!res.ok && String(res.code).includes('"conflict"'), '합류가 먼저 끝나면 늦은 되돌리기는 거절');
    ok((await taken()) === 2, '정원 초과 없음(학생B + 학생C)');
    const after = await stateA();
    ok(after.status === 'no_show' && after.rel === 50, '학생A는 노쇼 그대로 · 풀린 배정도 그대로(자동 복원 없음)');
    ok((await one(a, `select status from public.makeup_participants where id = '${joined.participant_id}'`)).status === 'unknown', '먼저 합류한 학생C의 자리는 그대로');
    const q = await one(a, `select committed_minutes as c, outstanding_minutes as o from public.makeup_cases where id = '${cA}'`);
    ok(q.c === 0 && q.o === 240, '학생A의 의무는 그대로 · 점유 0(다른 날로 새로 잡을 수 있다)');
    return checks;
  } finally {
    await a.unsafe('rollback').catch(() => {});
    await b.unsafe('rollback').catch(() => {});
    await wipe().catch(() => {});
    await a.end({ timeout: 5 });
    await b.end({ timeout: 5 });
  }
}
