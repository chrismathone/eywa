/**
 * scripts/_makeedu/import-staff-attendance.cjs — makeedu 직원 출퇴근 → aywa `staff_attendance_days`(0365a) **upsert**(강사평가 '강사 근태').
 * 입력: $MAKEEDU_OUT(기본 <repo>/.makeedu-tmp)/staff_attendance.json (scrape.cjs 산출 — 열 이름은 extract-table의 출퇴근 모드 · `meta` = 넣은 기간).
 *   node --env-file=.env.local scripts/_makeedu/import-staff-attendance.cjs [--apply] [--no-sync-state]
 *   `--no-sync-state` = 동기화 상태 줄을 남기지 않는다(연동 PC가 아닌 곳에서 한 번 채울 때 — 남기면 그 뒤 연동 PC가 안 갱신해 26시간 경보가 뜬다).
 * 변환·매칭·차이 판정은 staff-attendance.cjs(순수 · 테스트). 여기는 읽고 쓰기만. 출력은 건수만(이름·시각 없음).
 * ⚠️ 연동 앱(AywaSync)에서는 SQL이 태그드 템플릿 한 문장씩만 된다(쓰기 묶음 없음) — 줄마다 upsert, 바뀐 줄만.
 * ⚠️ 강사평가를 쓰는 지점만(0366a `sync_agent_staff_attendance_ready` — 직원 포트폴리오 집계가 있는 지점). 아니면 아무것도 안 한다.
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");
const { parseStaffAttendance, planStaffAttendance } = require("./staff-attendance.cjs");

const APPLY = process.argv.includes("--apply");
const NO_SYNC_STATE = process.argv.includes("--no-sync-state");
const OUT = process.env.MAKEEDU_OUT || path.resolve(__dirname, "..", "..", ".makeedu-tmp");

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const [gate] = await sql`select public.sync_agent_staff_attendance_ready(${tenantId}) as ready`.catch(() => [null]);
    if (!gate || !gate.ready) { console.log("직원 출퇴근 가져오기 꺼짐(강사평가를 쓰지 않는 지점이거나 0366a 전) — 건너뜀"); return; }
    const data = JSON.parse(fs.readFileSync(path.join(OUT, "staff_attendance.json"), "utf8"));
    if (data.error) throw new Error(`출퇴근 목록을 읽지 못했습니다: ${String(data.error).slice(0, 200)}`);
    const range = data.meta || {};
    if (!range.from || !range.to) throw new Error("출퇴근 목록의 조회 기간을 모릅니다(검색 조건을 못 넣음) — 쓰지 않습니다");
    if (data.totalReported == null) throw new Error("출퇴근 목록의 총건수를 읽지 못했습니다 — 덜 받았는지 알 수 없어 쓰지 않습니다");
    if (data.totalReported > 0 && data.rows.length < data.totalReported) {
      throw new Error(`출퇴근 목록을 덜 받았습니다(화면 ${data.totalReported}건 중 ${data.rows.length}건) — 쓰지 않고 다음 실행에 다시 받습니다`);
    }
    const rows = parseStaffAttendance(data);
    const outside = rows.filter((r) => r.day < range.from || r.day > range.to).length;
    if (outside) throw new Error(`조회 기간(${range.from} ~ ${range.to}) 밖의 줄이 ${outside}건 — 검색이 걸리지 않은 목록이라 쓰지 않습니다`);
    console.log(`file: staff_attendance.json  rows ${data.rows.length} → 출퇴근 ${rows.length}줄 (기간 ${range.from} ~ ${range.to})`);
    const users = await sql`select id, display_name, english_name, status from users where tenant_id = ${tenantId} and system_role <> 'student'`;
    const existing = await sql`select source_key, user_id, work_date::text as work_date, check_in_at, check_out_at, note from staff_attendance_days
      where tenant_id = ${tenantId} and source = 'makeedu' and work_date >= ${range.from} and work_date <= ${range.to}`;
    const plan = planStaffAttendance({ rows, users, existing, tenantId });
    // 받은 줄이 하나도 없으면(그 기간 기록 0건) 지우지 않는다. 지울 줄이 지나치게 많으면(20줄 넘고 기존의 3분의 1 넘게) 엉뚱한 목록일 수 있다 — 멈춘다.
    const deletes = rows.length ? plan.deletes : [];
    if (deletes.length > 20 && deletes.length * 3 > existing.length) {
      throw new Error(`지울 출퇴근 줄이 너무 많습니다(기존 ${existing.length}줄 중 ${deletes.length}줄) — 목록을 다시 확인할 때까지 쓰지 않습니다`);
    }
    console.log(`직원·날짜 ${plan.merged} · 쓸 줄 ${plan.writes.length} · 지울 줄 ${deletes.length} · 그대로 ${plan.unchanged} · 이름 못 이음 ${plan.unmatched} · 동명이인 ${plan.ambiguous} · 시각 없음 ${plan.empty}`);
    if (!APPLY) { console.log("[DRY-RUN] --apply 없이 종료 (DB write 0)."); return; }
    let written = 0;
    for (const r of plan.writes) {
      await sql`
        insert into staff_attendance_days (tenant_id, user_id, work_date, check_in_at, check_out_at, status, late_minutes, source, source_key, note)
        values (${r.tenant_id}, ${r.user_id}, ${r.work_date}, ${r.check_in_at}, ${r.check_out_at}, ${r.status}, ${r.late_minutes}, ${r.source}, ${r.source_key}, ${r.note})
        on conflict (tenant_id, source, source_key) do update set
          user_id = excluded.user_id, work_date = excluded.work_date, check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at,
          status = excluded.status, note = excluded.note, updated_at = now()`;
      written++;
    }
    for (const key of deletes) {
      await sql`delete from staff_attendance_days where tenant_id = ${tenantId} and source = 'makeedu' and source_key = ${key}`;
    }
    if (!NO_SYNC_STATE) await L.recordSync(sql, tenantId, "staff_attendance", written + deletes.length);
    console.log(`출퇴근 ${written}줄 반영 · ${deletes.length}줄 지움`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
