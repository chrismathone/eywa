/**
 * scripts/_oneoff/backfill-makeup-attendance.mjs — 지난 **반 없는 보강 보고서**의 출석부 칸 소급 채움.
 *
 * 배경(2026-09-02, 원장 제보 *"김은정 선생님의 이윤 학생이 9/1 자 출석부에 나와야하는데 목록에도 안보이네"*):
 * 보강 보고서를 저장하면 그 강사의 **보이지 않는 '보강' 반**(0241a)에 `makeup` 칸이 서지만, 그 배선은
 * **새로 저장되는 건**에만 걸린다. 그 전에 쓴 보고서(2025-11-18~2026-09-01, 243건)는 반도 칸도 없어
 * 출석부·시수에 없다. 이 스크립트가 앱과 **같은 규약**으로 그 칸을 채운다.
 *
 * 🔴 **드라이런이 기본** — `--apply`가 없으면 한 줄도 쓰지 않는다(테넌트 injaewon = 프로덕션 실데이터).
 * 🔴 `--from=YYYY-MM-DD`로 기간을 자른다. 소급은 **시수**를 늘리고 시수는 급여에 닿는다 — 드라이런의
 *    월별 표를 원장이 보고 기간을 정한다("9월부터만" 같은 결정).
 * 🔴 **이미 있는 칸은 절대 안 덮는다** — 판정 두 겹:
 *    ① 그 강사의 보강 반에 (학생, 날짜) 칸이 있으면 skip(어떤 상태든 — 사람이 고쳐 둔 값일 수 있다)
 *    ② **어느 반이든** 그 (학생, 날짜)에 `status='makeup'` 행이 있으면 skip
 *       (반 보강으로 이미 찍어 둔 건에 한 칸 더 만들면 **시수가 두 배**가 된다)
 * 🔴 **귀속 강사** = 앱의 `pickMakeupOwner`(src/features/classes/makeup-pool.ts)와 같은 규칙의 사본:
 *    `created_by`(0172a 소유 계정 — 갱신에도 트리거가 보존) → 없으면 `teacher_name`이 같은 학원 **활성
 *    직원(학생 계정 제외)** 표시 이름과 **정확히 하나** 일치 → 둘 다 안 되면 그 건은 건너뛰고 목록에 남긴다.
 *    이름으로 남의 계정에 붙이지 않는다([[#93]] — 작성자 ≠ 소유자와 같은 결).
 *    ⚠️ 두 벌인 이유: 이 스크립트는 TS 빌드 없이 node로 도는 일회성 도구다. 규칙을 바꾸면 **두 곳을 함께**.
 * 🔴 반 생성·출결 삽입은 앱(src/features/attendance/server/makeup-pool.ts)과 **같은 규약**:
 *    `is_active=false` · `is_makeup_pool=true` · 강사당 1개 · **교시/수강 생성 금지** ·
 *    출결 `status='makeup'` · `recorded_by=그 강사` · `session_units`는 비운다(기본 1).
 * 🔴 부분 유니크(`where is_makeup_pool`)라 `on conflict` 추론이 안 된다([[#113]]) — 읽고 없으면 insert,
 *    23505는 경쟁으로 보고 다시 읽는다. (트랜잭션 **밖**에서 — 안에서 실패하면 트랜잭션이 통째로 죽는다.)
 * ⚠️ 0241a 미적용이면 즉시 중단한다(컬럼이 없으면 반을 못 만든다).
 *
 * 사용:
 *   node --env-file=.env.local scripts/_oneoff/backfill-makeup-attendance.mjs                        # 드라이런(전체)
 *   node --env-file=.env.local scripts/_oneoff/backfill-makeup-attendance.mjs --from=2026-09-01      # 드라이런(기간)
 *   node --env-file=.env.local scripts/_oneoff/backfill-makeup-attendance.mjs --from=2026-09-01 --apply
 * env: DATABASE_URL.
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const fromArg = process.argv.find((a) => a.startsWith("--from="))?.slice("--from=".length) ?? null;

/** 앱 `LEGACY_REPORT_SUBJECT`와 같은 값 — 보고서에 과목이 없을 때 반 과목 폴백(표시·필터용, 귀속과 무관). */
const LEGACY_SUBJECT = "math";

const SKIP_LABEL = {
  pool_cell: "보강 반에 이미 칸 있음",
  makeup_elsewhere: "다른 반에 이미 보강 칸 있음(시수 중복 방지)",
  no_owner: "귀속 불가(작성 계정 없음 · 동명이인 · 미등록 이름)",
  dup_report: "같은 날 같은 학생 보고서 중복(한 칸만)",
};

/** 앱 `makeupPoolName`의 사본(표시용 — 판정 근거가 아니다). */
function makeupPoolName(teacherName) {
  const n = (teacherName ?? "").trim();
  return n ? `보강 · ${n}` : "보강";
}

/** 앱 `pickMakeupOwner`의 사본 — 스크립트엔 '저장자'가 없어 ③ 갈래가 없다. */
function pickMakeupOwner({ createdBy, teacherName, sameName }) {
  if (createdBy) return { id: createdBy, via: "created_by" };
  const name = teacherName ?? "";
  if (name.trim()) return sameName.length === 1 ? { id: sameName[0].id, via: "teacher_name" } : null;
  return null;
}

function fail(msg) {
  console.error(msg);
  return 2;
}

async function main() {
  if (fromArg && !/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) return fail("--from=YYYY-MM-DD 형식이어야 합니다.");
  if (!process.env.DATABASE_URL) return fail("DATABASE_URL 없음 — `node --env-file=.env.local …`로 실행할 것.");

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    console.log(
      `모드: ${APPLY ? "APPLY(실제 INSERT)" : "DRY-RUN(쓰기 없음)"} · 기간: ${fromArg ? `${fromArg}부터` : "전체"}\n`,
    );

    // 0241a 적용 확인 — 컬럼이 없으면 반을 만들 수 없다.
    const [{ ok }] = await sql`
      select exists(
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'classes' and column_name = 'is_makeup_pool'
      ) as ok`;
    if (!ok) return fail("0241a 미적용(classes.is_makeup_pool 없음) — 먼저 적용할 것. 중단.");

    // ── 대상: 반 없는 보강 보고서 ────────────────────────────────────────────
    const reports = await sql`
      select id, tenant_id, student_id, report_date::text as report_date, subject, teacher_name, created_by
        from lesson_reports
       where makeup = true and class_id is null
         ${fromArg ? sql`and report_date >= ${fromArg}` : sql``}
       order by report_date, id`;
    if (reports.length === 0) {
      console.log("대상 보고서 0건 — 할 일 없음.");
      return 0;
    }
    const dMin = reports[0].report_date;
    const dMax = reports[reports.length - 1].report_date;
    console.log(`대상 보고서: ${reports.length}건 (${dMin} ~ ${dMax})\n`);

    // ── 참조: 직원 · 보강 반 · 이미 있는 칸 ─────────────────────────────────
    const users = await sql`select id, tenant_id, display_name, status, system_role from users`;
    const userById = new Map(users.map((u) => [u.id, u]));
    /** `${tenant}|${display_name}` → 활성 직원(학생 계정 제외) 목록. 2명이면 모호. */
    const activeStaffByName = new Map();
    for (const u of users) {
      if (u.status !== "active" || u.system_role === "student") continue;
      const k = `${u.tenant_id}|${u.display_name}`;
      if (!activeStaffByName.has(k)) activeStaffByName.set(k, []);
      activeStaffByName.get(k).push(u);
    }

    const pools = await sql`select id, tenant_id, teacher_id, class_name from classes where is_makeup_pool = true`;
    const poolByTeacher = new Map(pools.map((p) => [`${p.tenant_id}|${p.teacher_id}`, p]));
    const poolIds = pools.map((p) => p.id);
    // ① 보강 반의 (학생, 날짜) 칸 — 상태 불문(사람이 결석·시수로 고쳐 둔 값일 수 있다).
    const poolCellRows = poolIds.length
      ? await sql`select class_id, student_id, session_date::text as d
                    from attendance_records where class_id = any(${poolIds})`
      : [];
    const poolCells = new Set(poolCellRows.map((r) => `${r.class_id}|${r.student_id}|${r.d}`));
    // ② 어느 반이든 그 (학생, 날짜)의 보강 칸 — 반 보강으로 이미 찍은 건에 한 칸 더 만들면 시수가 두 배.
    const makeupRows = await sql`
      select student_id, session_date::text as d
        from attendance_records
       where status = 'makeup' and session_date between ${dMin} and ${dMax}`;
    const makeupCells = new Set(makeupRows.map((r) => `${r.student_id}|${r.d}`));

    // ── 판정 ─────────────────────────────────────────────────────────────────
    const plan = [];
    const skips = [];
    const planned = new Set();
    /** `${tenant}|${ownerId}` → 만들 보강 반 */
    const poolsToCreate = new Map();
    for (const r of reports) {
      const creator = r.created_by ? userById.get(r.created_by) : null;
      // 삭제됐거나 다른 학원의 계정이면 없는 것으로 본다(admin 조회와 같은 tenant 필터 규약).
      const createdBy = creator && creator.tenant_id === r.tenant_id ? creator.id : null;
      const sameName = activeStaffByName.get(`${r.tenant_id}|${r.teacher_name ?? ""}`) ?? [];
      const owner = pickMakeupOwner({ createdBy, teacherName: r.teacher_name, sameName });
      if (!owner) {
        skips.push({ r, reason: "no_owner" });
        continue;
      }
      const ownerUser = userById.get(owner.id);
      const poolKey = `${r.tenant_id}|${owner.id}`;
      const pool = poolByTeacher.get(poolKey) ?? null;
      if (pool && poolCells.has(`${pool.id}|${r.student_id}|${r.report_date}`)) {
        skips.push({ r, reason: "pool_cell", owner, ownerUser });
        continue;
      }
      if (makeupCells.has(`${r.student_id}|${r.report_date}`)) {
        skips.push({ r, reason: "makeup_elsewhere", owner, ownerUser });
        continue;
      }
      const dupKey = `${poolKey}|${r.student_id}|${r.report_date}`;
      if (planned.has(dupKey)) {
        skips.push({ r, reason: "dup_report", owner, ownerUser });
        continue;
      }
      planned.add(dupKey);
      if (!pool && !poolsToCreate.has(poolKey)) {
        poolsToCreate.set(poolKey, {
          tenantId: r.tenant_id,
          ownerId: owner.id,
          ownerName: ownerUser?.display_name ?? null,
          ownerStatus: ownerUser?.status ?? "?",
          name: makeupPoolName(ownerUser?.display_name),
          subject: r.subject || LEGACY_SUBJECT,
        });
      }
      plan.push({ r, owner, ownerUser, poolKey, poolId: pool?.id ?? null });
    }

    // ── 보고(드라이런·적용 공통) ───────────────────────────────────────────────
    const month = (d) => d.slice(0, 7);
    const monthRows = new Map();
    const bump = (m, key) => {
      if (!monthRows.has(m)) {
        monthRows.set(m, { 월: m, 보고서: 0, "만들 칸": 0, "skip:보강반 칸": 0, "skip:다른반 보강": 0, "skip:귀속불가": 0, "skip:중복": 0 });
      }
      monthRows.get(m)[key] += 1;
    };
    for (const p of plan) {
      bump(month(p.r.report_date), "보고서");
      bump(month(p.r.report_date), "만들 칸");
    }
    const skipKey = { pool_cell: "skip:보강반 칸", makeup_elsewhere: "skip:다른반 보강", no_owner: "skip:귀속불가", dup_report: "skip:중복" };
    for (const s of skips) {
      bump(month(s.r.report_date), "보고서");
      bump(month(s.r.report_date), skipKey[s.reason]);
    }
    console.log("■ 월별");
    console.table([...monthRows.values()].sort((a, b) => a.월.localeCompare(b.월)));

    const byTeacher = new Map();
    for (const p of plan) {
      const k = p.owner.id;
      if (!byTeacher.has(k)) {
        byTeacher.set(k, {
          강사: p.ownerUser?.display_name ?? p.owner.id,
          상태: p.ownerUser?.status === "active" ? "활성" : "퇴직",
          "만들 칸": 0,
          "보강 반": p.poolId ? "있음" : "생성",
          "귀속 근거": p.owner.via,
        });
      }
      byTeacher.get(k)["만들 칸"] += 1;
    }
    console.log("■ 강사별(만들 칸)");
    console.table([...byTeacher.values()].sort((a, b) => b["만들 칸"] - a["만들 칸"]));

    console.log("■ skip 사유별");
    const skipCount = {};
    for (const s of skips) skipCount[s.reason] = (skipCount[s.reason] ?? 0) + 1;
    for (const [k, n] of Object.entries(skipCount)) console.log(`  ${SKIP_LABEL[k]}: ${n}건`);
    if (skips.length === 0) console.log("  (없음)");

    const noOwner = skips.filter((s) => s.reason === "no_owner");
    if (noOwner.length > 0) {
      const ids = [...new Set(noOwner.map((s) => s.r.student_id))];
      const names = new Map((await sql`select id, name from students where id = any(${ids})`).map((s) => [s.id, s.name]));
      console.log("■ 귀속 불가 목록(사람이 판단할 것 — 이름으로 남의 계정에 붙이지 않는다)");
      console.table(
        noOwner.map((s) => ({
          날짜: s.r.report_date,
          teacher_name: s.r.teacher_name,
          created_by: s.r.created_by ?? "(없음)",
          학생: names.get(s.r.student_id) ?? s.r.student_id,
        })),
      );
    }

    console.log("■ 만들어질 보강 반");
    if (poolsToCreate.size === 0) console.log("  (없음 — 전부 기존 보강 반)");
    else console.table([...poolsToCreate.values()].map((p) => ({ 반이름: p.name, 과목: p.subject, 강사상태: p.ownerStatus })));

    console.log(`\n요약: 만들 칸 ${plan.length} · skip ${skips.length} · 새 보강 반 ${poolsToCreate.size}`);

    if (!APPLY) {
      console.log("\nDRY-RUN — 아무것도 쓰지 않았다. 실제 적용은 `--apply`(원장 승인 후).");
      return 0;
    }
    if (plan.length === 0) {
      console.log("\n만들 칸이 없어 적용할 것이 없다.");
      return 0;
    }

    // ── 적용 ① 보강 반(트랜잭션 밖 — 23505를 잡고 다시 읽으려면 문장 단위여야 한다) ──────────
    const poolIdByKey = new Map(pools.map((p) => [`${p.tenant_id}|${p.teacher_id}`, p.id]));
    for (const [key, p] of poolsToCreate) {
      const readOne = async () =>
        (await sql`select id from classes
                     where tenant_id = ${p.tenantId} and teacher_id = ${p.ownerId} and is_makeup_pool = true`)[0]?.id ?? null;
      let id = await readOne();
      if (!id) {
        try {
          // 🔴 앱과 같은 규약 — is_active=false · is_makeup_pool=true · 교시/수강 없음.
          const [row] = await sql`
            insert into classes (tenant_id, class_name, subject, teacher_id, is_active, is_makeup_pool)
            values (${p.tenantId}, ${p.name}, ${p.subject}, ${p.ownerId}, false, true)
            returning id`;
          id = row.id;
          console.log(`보강 반 생성: ${p.name} (${id})`);
        } catch (e) {
          if (e?.code !== "23505") throw e; // 경쟁(앱이 같은 순간 만듦) — 다시 읽는다
          id = await readOne();
        }
      }
      if (!id) throw new Error(`보강 반을 만들지도 찾지도 못함: ${key}`);
      poolIdByKey.set(key, id);
    }

    // ── 적용 ② 출결 칸(한 트랜잭션, 삽입 직전에 "이미 있나"를 다시 확인 — 드라이런 뒤 앱이 썼을 수 있다) ──
    let inserted = 0;
    let raced = 0;
    await sql.begin(async (tx) => {
      for (const p of plan) {
        const classId = poolIdByKey.get(p.poolKey);
        if (!classId) throw new Error(`보강 반 id 없음: ${p.poolKey}`);
        const [{ n }] = await tx`
          select count(*)::int as n from attendance_records
           where (class_id = ${classId} and student_id = ${p.r.student_id} and session_date = ${p.r.report_date})
              or (student_id = ${p.r.student_id} and session_date = ${p.r.report_date} and status = 'makeup')`;
        if (n > 0) {
          raced += 1;
          continue;
        }
        // 🔴 앱 `ensureMakeupAttendanceForReport`와 같은 행 모양 — session_units는 비운다(기본 1).
        await tx`
          insert into attendance_records (tenant_id, class_id, student_id, session_date, status, recorded_by)
          values (${p.r.tenant_id}, ${classId}, ${p.r.student_id}, ${p.r.report_date}, 'makeup', ${p.owner.id})`;
        inserted += 1;
      }
    });
    console.log(`\nAPPLY 완료: 출결 칸 ${inserted}건 삽입 · 적용 직전 재확인으로 건너뜀 ${raced}건 · 보강 반 ${poolsToCreate.size}개`);
    return 0;
  } finally {
    await sql.end();
  }
}

process.exitCode = await main();
