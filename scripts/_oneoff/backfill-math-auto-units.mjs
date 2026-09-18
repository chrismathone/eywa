/**
 * scripts/_oneoff/backfill-math-auto-units.mjs — **9월분** 수학 출석 시수를 수업 길이 자동값으로 소급 보정한다.
 *
 * 원장 2026-09-11: *"월목 3시간 반이랑 수 3시간반 출석할때 출석부에 1로 입력된다는데 확인해봐. 1.5로 입력되어야
 * 맞을 것 같은데"* → "그날 수업 길이로 자동"(앞으로 새 칸은 앱이 넣는다 — src/features/attendance/auto-units.ts)
 * + **"9월분만 보정"**: 드라이런으로 바뀔 칸 목록을 먼저 보여 주고 **승인 후 적용**.
 *
 * 대상(전부 만족해야 한다):
 *   · 테넌트(기본 cs = 침산) · 과목 = 자동 대상(수학) 반(특강 포함)
 *   · 2026-09-01 ≤ session_date ≤ min(--to 또는 KST 오늘, 2026-09-30)
 *   · 그 칸(학생·반·날짜)의 **유효 행**(교시별 최신 1건 — 0198a distinct-on 규약)이 교시 없는 "그날 전체" 행
 *   · 소비 상태(출석·지각·조퇴) · session_units IS NULL(=1) · 자리 시수 행(seat_label) 아님
 *   · 그날 배치로 센 자동값 ≠ 1 (55분×3교시 = 165분 → 1.5 · 180 → 1.5 · 240 → 2)
 * 건너뜀(목록에 따로 센다): 같은 칸에 교시별 행이 섞인 칸(합산하면 이중 계상) · 배치 없음·2시간 이하.
 * 🔴 **보강 칸은 기본 제외**하고 목록에 따로 적는다 — 보강은 확인창에서 시수를 **보고 고르는** 기록이라 null(=1)이
 *    명시였을 수 있고, 오늘 앱으로 같은 보강을 넣어도 1로 남는다(적대 리뷰 2026-09-11: 드라이런 91칸 중 3칸이 그 반
 *    수강생이 아닌 보강 방문자). 원장이 넣기로 하면 `--include-makeup`.
 *
 * 🔴 **드라이런이 기본**(읽기 전용 트랜잭션). `--apply`일 때만 UPDATE + 감사로그 한 줄.
 * 🔴 **`--apply`엔 `--recorded-before=<ISO 시각>`이 필수** — "강사가 명시로 친 1"과 "기본 1"은 DB에서 **구분이 안 된다**
 *    (둘 다 null). 앱(자동 시수) 배포 **뒤** 강사가 친 1을 덮지 않게 배포 시각을 넘긴다(배포 전 적용이면 지금 시각).
 *    없으면 쓰기 전에 멈춘다(적대 리뷰 2026-09-11 — 선택 옵션이던 때 사용법대로 돌리면 그 칸들이 1.5·2가 됐다).
 * 🔴 **멱등** — UPDATE는 `session_units IS NULL`·교시 없음·대상 상태인 행만 건드린다(두 번째 실행은 0건).
 * 🔴 테넌트 cs(침산, 옛 slug injaewon) = 프로덕션 실데이터. `db:seed` 금지.
 * ⚠️ 판정은 `math-auto-units-rules.mjs`(앱 TS 규칙의 사본 — `auto-units-parity.test.ts`가 두 벌을 잠그고,
 *    칸 판정·보강 제외·적용 전제는 `auto-units-backfill.test.ts`가 잠근다).
 *
 * 사용(이 워크트리엔 메인 체크아웃의 .env.local을 지정):
 *   node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/backfill-math-auto-units.mjs            # 드라이런
 *   node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/backfill-math-auto-units.mjs \
 *        --apply --recorded-before=2026-09-11T18:00:00+09:00                                               # 적용
 *   옵션: --tenant=<slug>(기본 cs) · --to=YYYY-MM-DD · --recorded-before=<ISO 시각> · --include-makeup
 * env: DATABASE_URL
 */
import postgres from "postgres";
import {
  AUTO_UNITS_SUBJECTS,
  autoUnitsOn,
  backfillApplyError,
  backfillStatuses,
  partitionBackfillItems,
  pickBackfillCandidates,
} from "./math-auto-units-rules.mjs";

const APPLY = process.argv.includes("--apply");
const INCLUDE_MAKEUP = process.argv.includes("--include-makeup");
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const tenantSlug = arg("tenant", "cs"); // 침산(cs) — 2026-09-18 slug 개명(옛 injaewon)
const FROM = "2026-09-01";
const SEPT_END = "2026-09-30";
const kstToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const toArg = arg("to", kstToday);
if (!YMD.test(toArg)) throw new Error(`--to 형식이 YYYY-MM-DD가 아닙니다: ${toArg}`);
/** 9월 밖은 보정하지 않는다("9월분만") — 늦게 돌려도 10월 행을 건드리지 않게 자른다. */
const TO = [toArg, SEPT_END].sort()[0];
const recordedBeforeArg = arg("recorded-before", null);
const recordedBefore = recordedBeforeArg ? new Date(recordedBeforeArg) : null;
if (recordedBefore && Number.isNaN(recordedBefore.getTime())) {
  throw new Error(`--recorded-before 시각을 읽을 수 없습니다: ${recordedBeforeArg}`);
}
const ACTOR = "system:backfill-math-auto-units";
/** 감사로그 한 줄(적용 때만) — 액션 키는 src/features/audit/server/log.ts에 한글 라벨로 등록돼 있다. */
const AUDIT = { action: "attendance_units_backfill", target_type: "attendance" };
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
const dowKo = (ymd) => DOW_KO[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(4, 56 - title.length))}`);
}

/** 읽기 전용 — 바뀔 칸 목록과 건너뛴 사유별 수를 만든다. */
async function buildPlan(tx) {
  const [tenant] = await tx`select id, name from tenants where slug = ${tenantSlug}`;
  if (!tenant) throw new Error(`테넌트 ${tenantSlug}를 찾지 못했습니다`);
  const subjects = [...AUTO_UNITS_SUBJECTS];
  const rows = await tx`
    select distinct on (ar.student_id, ar.class_id, ar.session_date, ar.slot_start)
           ar.id, ar.student_id, ar.class_id, ar.session_date::text as session_date,
           ar.slot_start::text as slot_start, ar.status::text as status, ar.session_units,
           ar.seat_label, ar.recorded_at
      from attendance_records ar
      join classes c on c.id = ar.class_id and c.tenant_id = ar.tenant_id
     where ar.tenant_id = ${tenant.id}
       and c.subject::text = any(${tx.array(subjects)}::text[])
       and ar.session_date between ${FROM} and ${TO}
     order by ar.student_id, ar.class_id, ar.session_date, ar.slot_start, ar.recorded_at desc, ar.id desc`;

  // 칸 판정(교시별 행 섞임·소비 상태·이미 시수·자리 행·기준 시각 뒤) — 순수 함수 한 벌(Vitest).
  const { cands, skip: picked, scanned } = pickBackfillCandidates(rows, { recordedBefore });
  const skip = { ...picked, noAuto: 0 };

  const classIds = [...new Set(cands.map((r) => r.class_id))];
  const [scheds, classes] = classIds.length
    ? await Promise.all([
        tx`
          select class_id, day_of_week::text as day_of_week, start_time::text as start_time,
                 end_time::text as end_time, valid_from::text as valid_from, valid_to::text as valid_to,
                 slot_teacher_label
            from class_schedules
           where tenant_id = ${tenant.id}
             and class_id = any(${tx.array(classIds)}::uuid[])
             and valid_from <= ${TO}
             and (valid_to is null or valid_to >= ${FROM})`,
        tx`
          select c.id, c.class_name, c.is_special, u.display_name as teacher_name
            from classes c
            left join users u on u.id = c.teacher_id
           where c.tenant_id = ${tenant.id} and c.id = any(${tx.array(classIds)}::uuid[])`,
      ])
    : [[], []];
  const schedsByClass = new Map();
  for (const s of scheds) {
    const list = schedsByClass.get(s.class_id) ?? [];
    list.push({
      dayOfWeek: s.day_of_week,
      startTime: s.start_time,
      endTime: s.end_time,
      validFrom: s.valid_from,
      validTo: s.valid_to,
      slotTeacherLabel: s.slot_teacher_label,
    });
    schedsByClass.set(s.class_id, list);
  }
  const classById = new Map(classes.map((c) => [c.id, c]));

  const withUnits = [];
  for (const r of cands) {
    const units = autoUnitsOn(r.session_date, schedsByClass.get(r.class_id) ?? []);
    if (units === null) { skip.noAuto++; continue; }
    const c = classById.get(r.class_id);
    withUnits.push({
      id: r.id,
      status: r.status,
      classId: r.class_id,
      className: c?.class_name ?? "(반 이름 없음)",
      teacher: c?.teacher_name ?? "(담임 없음)",
      date: r.session_date,
      units,
    });
  }
  // 🔴 보강 칸은 기본 제외 — 목록에 따로 적어 원장이 포함 여부를 고르게 한다(--include-makeup).
  const { apply: items, excluded } = partitionBackfillItems(withUnits, { includeMakeup: INCLUDE_MAKEUP });
  return { tenant, items, excluded, skip, scanned };
}

function printByClassDate(list) {
  const byClass = new Map();
  for (const i of list) {
    const k = `${i.teacher}|${i.className}`;
    const c = byClass.get(k) ?? { teacher: i.teacher, className: i.className, dates: new Map() };
    const d = c.dates.get(i.date) ?? { units: i.units, cells: 0 };
    d.cells++;
    c.dates.set(i.date, d);
    byClass.set(k, c);
  }
  for (const c of [...byClass.values()].sort((a, b) => (a.teacher + a.className).localeCompare(b.teacher + b.className, "ko"))) {
    const total = [...c.dates.values()].reduce((s, d) => s + d.cells, 0);
    console.log(`  [${c.teacher}] ${c.className} — ${total}칸`);
    for (const [date, d] of [...c.dates].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`      ${date}(${dowKo(date)})  ${fmt(d.units)} × ${d.cells}칸`);
    }
  }
}

function report(plan) {
  const { tenant, items, excluded, skip, scanned } = plan;
  console.log(`모드: ${APPLY ? "APPLY(실제 UPDATE)" : "DRY-RUN(읽기 전용 — 쓰기 없음)"} · 테넌트 ${tenant.name}`);
  console.log(
    `기간: ${FROM} ~ ${TO}${recordedBefore ? ` · ${recordedBefore.toISOString()} 이전에 손댄 행만` : ""}` +
      `${INCLUDE_MAKEUP ? " · 보강 칸 포함" : ""}`,
  );

  section("요약");
  const delta = items.reduce((s, i) => s + (i.units - 1), 0);
  const byUnits = {};
  for (const i of items) byUnits[fmt(i.units)] = (byUnits[fmt(i.units)] ?? 0) + 1;
  console.log(`  훑은 칸 ${scanned}칸(수학 반 · 기간 안)`);
  console.log(`  바뀔 칸 ${items.length}칸 · 시수 합계 ${fmt(items.length)} → ${fmt(items.length + delta)} (+${fmt(delta)})`);
  console.log(`  값별: ${Object.entries(byUnits).map(([u, n]) => `${u} × ${n}칸`).join(" · ") || "없음"}`);
  console.log(
    `  건너뜀: 결석·공결 ${skip.notCountable} · 이미 시수 있음 ${skip.alreadySet} · 자리 행 ${skip.seat} · ` +
      `교시별 행 섞임 ${skip.mixed} · 수업 2시간 이하·배치 없음 ${skip.noAuto}` +
      (recordedBefore ? ` · 기준 시각 뒤 손댐 ${skip.recordedAfter}` : ""),
  );
  if (excluded.length > 0) {
    const exDelta = excluded.reduce((s, i) => s + (i.units - 1), 0);
    console.log(
      `  보강 칸 ${excluded.length}칸 제외(+${fmt(exDelta)} 해당) — 확인창에서 시수를 보고 고른 기록이라 null(=1)이 명시일 수 있다. ` +
        "포함하려면 --include-makeup",
    );
  }
  if (!APPLY) console.log("  ⚠️ 적용할 땐 --recorded-before=<앱 배포 시각>이 필수다(배포 뒤 강사가 명시로 친 1을 덮지 않게).");

  section("담임별");
  const byTeacher = new Map();
  for (const i of items) {
    const t = byTeacher.get(i.teacher) ?? { cells: 0, delta: 0 };
    t.cells++;
    t.delta += i.units - 1;
    byTeacher.set(i.teacher, t);
  }
  for (const [name, t] of [...byTeacher].sort((a, b) => b[1].cells - a[1].cells)) {
    console.log(`  ${name.padEnd(8)} ${String(t.cells).padStart(4)}칸  +${fmt(t.delta)}`);
  }

  section("반·날짜별");
  printByClassDate(items);

  if (excluded.length > 0) {
    section("제외한 보강 칸(반·날짜별)");
    printByClassDate(excluded);
  }
}

async function apply(sql, plan) {
  const { tenant, items } = plan;
  if (items.length === 0) {
    console.log("\n바꿀 칸이 없습니다 — 쓰기 없이 끝냅니다.");
    return;
  }
  const statuses = [...backfillStatuses({ includeMakeup: INCLUDE_MAKEUP })];
  const byUnits = new Map();
  for (const i of items) (byUnits.get(i.units) ?? byUnits.set(i.units, []).get(i.units)).push(i.id);
  await sql.begin(async (tx) => {
    const updatedIds = [];
    const updatedByUnits = {};
    for (const [units, ids] of byUnits) {
      for (let k = 0; k < ids.length; k += 500) {
        const chunk = ids.slice(k, k + 500);
        // 🔴 멱등·안전 조건을 UPDATE에 다시 건다 — 드라이런과 적용 사이에 누가 고친 행은 건드리지 않는다.
        const res = await tx`
          update attendance_records set session_units = ${units}
           where tenant_id = ${tenant.id}
             and id = any(${tx.array(chunk)}::uuid[])
             and session_units is null
             and slot_start is null
             and seat_label is null
             and status::text = any(${tx.array(statuses)}::text[])
             and recorded_at < ${recordedBefore}
          returning id`;
        for (const r of res) updatedIds.push(r.id);
        updatedByUnits[fmt(units)] = (updatedByUnits[fmt(units)] ?? 0) + res.length;
      }
    }
    const deltaSum = Math.round(
      items.filter((i) => updatedIds.includes(i.id)).reduce((s, i) => s + (i.units - 1), 0) * 10,
    ) / 10;
    const meta = {
      from: FROM,
      to: TO,
      count: updatedIds.length,
      planned: items.length,
      byUnits: updatedByUnits,
      deltaSum,
      recordedBefore: recordedBefore.toISOString(),
      ...(INCLUDE_MAKEUP ? { includeMakeup: true } : {}),
      ids: updatedIds,
    };
    await tx`
      insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${tenant.id}, ${null}, ${ACTOR}, ${AUDIT.action}, ${AUDIT.target_type},
              ${`수학 출석 시수 자동값 ${FROM}~${TO}`}, ${tx.json(meta)}::jsonb)`;
    console.log(`\n✓ UPDATE ${updatedIds.length}칸 (계획 ${items.length}칸) · 합계 +${fmt(deltaSum)} · 감사로그 1줄`);
  });
}

(async () => {
  // 🔴 적용 전제(기준 시각)는 DB에 붙기 **전에** 본다 — 쓰기 직전에 알게 되면 늦다.
  const guard = backfillApplyError({ apply: APPLY, recordedBefore });
  if (guard) {
    console.error(guard);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL이 없습니다 — node --env-file=D:/eywa_refactoring/.env.local … 로 실행하세요");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    const plan = await sql.begin("read only", (tx) => buildPlan(tx));
    report(plan);
    if (APPLY) await apply(sql, plan);
    else console.log("\n(드라이런 — 아무것도 쓰지 않았습니다. 승인 뒤 --apply --recorded-before=<배포 시각>)");
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("\n!! 중단:", e.message);
  process.exit(1);
});
