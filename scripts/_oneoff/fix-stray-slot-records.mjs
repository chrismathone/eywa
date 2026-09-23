/**
 * 시간표에 없는 시각(고아)에 남은 기록 정리 — **드라이런 기본**.
 *
 * 배경(2026-09-22 원장 제보 *"영어 강사 시트에서 이게 왜 나오지? 시간 변경됨"*): 시간표를 바꾸면 미리 적어 둔
 * 계획 줄이 옛 시각에 남고, 강사 시트가 그 칸을 카드로 세워 사람이 거기에 출결까지 넣었다. 그 결과 한 수업의
 * 시수가 두 칸으로 갈리거나(9/18) 겹쳤다(9/22). 카드가 서는 것은 앱에서 고쳤고, 이 스크립트는 남은 데이터를 옮긴다.
 *
 * 규칙
 *  · 계획 줄의 옮길 곳 = 그 날짜 교시 중 **고아 시각을 품는 칸**([start,end)) — 자리(JJ)도 대상이다(JJ 계획은 JJ 칸으로).
 *  · 🔴 **출결의 옮길 곳은 자리(JJ·LAB) 칸이 될 수 없다.** 시트는 그날 시수를 **강사 카드들에 나눠** 넣는데
 *    (실측 9/22: 1.5를 15:00에 0.8, 고아 16:20에 0.7), 고아 시각이 우연히 JJ 시간대 안이라고 JJ로 합치면
 *    강사 수업 시수가 자리로 옮겨 간다. 그래서 품는 칸이 자리면 **그 날 강사 칸**으로 보내고, 강사 칸이
 *    둘 이상이면 사람 판단으로 넘긴다. 옮길 곳이 없으면 건드리지 않는다.
 *  · 계획 줄: `slot_start`를 그 칸으로 옮기고 **줄번호는 그 칸의 빈 번호로 새로 매긴다**.
 *    🔴 유니크는 `(반,날짜,칸,평시/특강,줄번호)`라 **구분(skill_area)과 무관하게** 줄번호가 칸 안에서 유일해야 한다
 *    (처음엔 구분까지 같이 보고 검사해 적용이 통째로 되돌아갔다). 내용(구분·교재·진도)이 똑같은 줄이 이미 있으면 옮기지 않는다.
 *  · 출결: 같은 학생의 그 칸 행이 있으면 **시수를 합치고** 고아 행을 지운다. 없으면 행을 그 칸으로 옮긴다.
 *    🔴 상태가 다르거나(출석↔결석 등) 시수가 수상한 행(보강 5.0 등)은 **자동으로 안 건드리고** 사람 판단으로 넘긴다.
 *  · 자리(JJ·LAB) 칸에 들어간 시수는 이 스크립트가 손대지 않는다 — 따로 보고만 한다(원장 결정).
 *
 * 사용: node scripts/_oneoff/fix-stray-slot-records.mjs [--from=2026-09-01] [--to=2026-12-31] [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const args = new Map(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? "true"];
}));
const FROM = args.get("from") ?? "2026-09-01";
const TO = args.get("to") ?? "2026-12-31";
const APPLY = args.get("apply") === "true";

const envPath = path.join(process.cwd(), ".env.local");
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
  }),
);
const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });
const hhmm = (t) => (t ?? "").slice(0, 5);
const SEAT = /^(JJ|LAB|이주희|랩실|집중자율|자율)/i;

async function main() {
  // 1) 고아 (반,날짜,칸) 찾기 — 계획 줄·출결 양쪽에서.
  const stray = await sql`
    with data as (
      select class_id, plan_date d, slot_start s from class_sheet_plan_lines
       where plan_date between ${FROM} and ${TO} and slot_start is not null
      union
      select class_id, session_date, slot_start from attendance_records
       where session_date between ${FROM} and ${TO} and slot_start is not null and supersedes_id is null
    )
    select c.class_name, c.subject, x.class_id, x.d::text d, to_char(x.s,'HH24:MI') s
      from data x join classes c on c.id = x.class_id
     where not exists (
       select 1 from class_schedules cs
        where cs.class_id = x.class_id and cs.day_of_week::text = lower(to_char(x.d,'dy'))
          and cs.start_time = x.s and cs.valid_from <= x.d and (cs.valid_to is null or cs.valid_to >= x.d))
     order by c.class_name, x.d, x.s`;
  if (stray.length === 0) {
    console.log(`고아 칸 없음 (${FROM} ~ ${TO})`);
    return;
  }

  const plans = [];
  const atts = [];
  const skips = [];
  const seatUnits = [];

  for (const row of stray) {
    // 그 날짜에 도는 교시 — 고아 시각을 품는 칸을 찾는다.
    const live = await sql`
      select to_char(start_time,'HH24:MI') s, to_char(end_time,'HH24:MI') e, slot_teacher_label lbl
        from class_schedules
       where class_id = ${row.class_id} and day_of_week::text = lower(to_char(${row.d}::date,'dy'))
         and valid_from <= ${row.d} and (valid_to is null or valid_to >= ${row.d})
       order by start_time`;
    const contains = live.find((l) => hhmm(l.s) <= row.s && row.s < hhmm(l.e));
    const teacherSlots = live.filter((l) => !SEAT.test(l.lbl ?? ""));
    const where = `${row.class_name} ${row.d} ${row.s}`;
    if (!contains) {
      skips.push(`${where} — 그 시각을 품는 교시가 없음(그 날 교시: ${live.map((l) => `${hhmm(l.s)}~${hhmm(l.e)}`).join(", ") || "없음"})`);
      continue;
    }
    const to = hhmm(contains.s); // 계획 줄이 갈 곳
    // 출결이 갈 곳 — 자리 칸은 안 된다(위 🔴).
    const attTo = SEAT.test(contains.lbl ?? "")
      ? (teacherSlots.length === 1 ? hhmm(teacherSlots[0].s) : null)
      : to;

    const lines = await sql`
      select id, skill_area, line_no, term_mode, textbook, progress from class_sheet_plan_lines
       where class_id = ${row.class_id} and plan_date = ${row.d} and slot_start = ${row.s}
       order by line_no`;
    const same = (a, b) => (a ?? "").trim().replace(/\s+/g, " ") === (b ?? "").trim().replace(/\s+/g, " ");
    for (const l of lines) {
      const there = await sql`
        select line_no, skill_area, textbook, progress from class_sheet_plan_lines
         where class_id = ${row.class_id} and plan_date = ${row.d} and slot_start = ${to} and term_mode = ${l.term_mode}`;
      if (there.some((t) => t.skill_area === l.skill_area && same(t.textbook, l.textbook) && same(t.progress, l.progress))) {
        skips.push(`${where} 계획 [${l.skill_area} ${l.line_no}] — ${to} 칸에 같은 내용이 이미 있음(옮기지 않는다)`);
        continue;
      }
      // 🔴 줄번호는 구분과 무관하게 칸 안에서 유일하다 — 이번 실행에서 이미 잡아 둔 번호까지 세어 다음 빈 번호를 준다.
      const taken = new Set(there.map((t) => Number(t.line_no)));
      for (const q of plans) if (q.slotKey === `${row.class_id}|${row.d}|${to}|${l.term_mode}`) taken.add(q.lineNo);
      let lineNo = 1;
      while (taken.has(lineNo)) lineNo += 1;
      plans.push({
        id: l.id, to, lineNo, slotKey: `${row.class_id}|${row.d}|${to}|${l.term_mode}`, where,
        what: `${l.skill_area} ${l.line_no}→${lineNo} ${l.textbook ?? ""} ${l.progress ?? ""}`.trim(),
      });
    }

    const rows = await sql`
      select a.id, a.student_id, s.name, a.status::text st, a.session_units u, a.seat_label
        from attendance_records a join students s on s.id = a.student_id
       where a.class_id = ${row.class_id} and a.session_date = ${row.d} and a.slot_start = ${row.s}
         and a.supersedes_id is null`;
    for (const a of rows) {
      const label = `${where} ${a.name} ${a.st}${a.u == null ? "" : ` ${a.u}`}`;
      if (!attTo) {
        skips.push(`${label} — 품는 칸이 자리(${contains.lbl})이고 그 날 강사 칸이 ${teacherSlots.length}개라 사람 판단 필요`);
        continue;
      }
      const [mate] = await sql`
        select id, status::text st, session_units u from attendance_records
         where class_id = ${row.class_id} and session_date = ${row.d} and slot_start = ${attTo}
           and student_id = ${a.student_id} and supersedes_id is null limit 1`;
      if (!mate) {
        atts.push({ kind: "move", id: a.id, to: attTo, label: `${label} → ${attTo} 칸으로 이동` });
        continue;
      }
      if (mate.st !== a.st) {
        skips.push(`${label} — ${attTo} 칸은 '${mate.st}'라 상태가 달라 사람 판단 필요`);
        continue;
      }
      if (a.st === "makeup") {
        skips.push(`${label} — 보강은 시수를 자동으로 합치지 않는다(사람 판단)`);
        continue;
      }
      const sum = Number(mate.u ?? 0) + Number(a.u ?? 0);
      atts.push({
        kind: "merge",
        id: a.id,
        mateId: mate.id,
        units: a.u == null && mate.u == null ? null : sum,
        label: `${label} + ${attTo} 칸 ${mate.u ?? "—"} → ${attTo} 칸 ${a.u == null && mate.u == null ? "—" : sum} (고아 행 삭제)`,
      });
    }

    // 같은 날 자리(JJ·LAB) 칸에 시수가 들어가 있으면 따로 알린다(이 스크립트는 안 건드린다).
    for (const l of live) {
      if (!SEAT.test(l.lbl ?? "")) continue;
      const seat = await sql`
        select count(*)::int n, sum(session_units)::float u from attendance_records
         where class_id = ${row.class_id} and session_date = ${row.d} and slot_start = ${hhmm(l.s)}
           and supersedes_id is null and session_units is not null`;
      if (seat[0].n > 0) seatUnits.push(`${row.class_name} ${row.d} ${hhmm(l.s)} (${l.lbl}) — 시수가 든 출결 ${seat[0].n}건 · 합 ${seat[0].u}`);
    }
  }

  const uniq = (xs) => [...new Set(xs)];
  console.log(`\n== 계획 줄 이동 ${plans.length}건`);
  for (const p of plans) console.log(`  ${p.where} → ${p.to} · ${p.what}`);
  console.log(`\n== 출결 ${atts.length}건`);
  for (const a of atts) console.log(`  ${a.label}`);
  console.log(`\n== 사람 판단이 필요해 건너뛴 것 ${uniq(skips).length}건`);
  for (const s of uniq(skips)) console.log(`  ${s}`);
  console.log(`\n== 참고: 자리(JJ·LAB) 칸에 든 시수 ${uniq(seatUnits).length}곳 — 이 스크립트는 안 건드립니다`);
  for (const s of uniq(seatUnits)) console.log(`  ${s}`);

  if (!APPLY) {
    console.log(`\n드라이런입니다. 적용하려면 --apply 를 붙이세요.`);
    return;
  }
  await sql.begin(async (tx) => {
    for (const p of plans) await tx`update class_sheet_plan_lines set slot_start = ${p.to}, line_no = ${p.lineNo}, updated_at = now() where id = ${p.id}`;
    for (const a of atts) {
      if (a.kind === "move") await tx`update attendance_records set slot_start = ${a.to} where id = ${a.id}`;
      else {
        await tx`update attendance_records set session_units = ${a.units} where id = ${a.mateId}`;
        await tx`delete from attendance_records where id = ${a.id}`;
      }
    }
  });
  console.log(`\n적용 완료 — 계획 ${plans.length}건, 출결 ${atts.length}건.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => sql.end());
