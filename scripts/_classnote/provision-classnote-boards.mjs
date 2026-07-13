/**
 * scripts/_classnote/provision-classnote-boards.mjs — ClassNote 학생별 보드((수학)학생명) 프로비저닝.
 *
 * eywa DB의 발송과목 재원생 기준 "있어야 할 보드"를 계산하고, ClassNote 반 정보 관리의 실보드와 대조해
 * 없는 것만 생성한다. Edutrix scripts/create_classnote_classes.js 이식(전건 생성 시도→중복거부 방식 대신
 * **스캔→diff→누락분만 생성**으로 개선 + dry-run 기본). 학생 1명=반 1개 구조 근거는
 * docs/classnote-integration.md §3 — 보드명이 봇의 유일한 주소 키라 정확해야 한다.
 *
 * 실행(기본 dry-run — 로그인·스캔·계획 출력만, 아무것도 만들지 않음):
 *   node --env-file=.env.local scripts/_classnote/provision-classnote-boards.mjs [--subject=math|english|all]
 * 실제 생성:
 *   node --env-file=.env.local scripts/_classnote/provision-classnote-boards.mjs --apply [--limit=N] [--headed]
 *
 * env: DATABASE_URL, CLASSNOTE_UPLOAD_ID/PW, (테넌트 2개+면) CLASSNOTE_TENANT_ID.
 * ⚠️ 보드 생성은 실 ClassNote 기관 변경(학원 화면에 보임) — --apply는 원장 승인 후에만.
 * ⚠️ 학부모 미가입 학생은 보드를 만들어도 배정·수신이 안 됨(가입은 자동화 불가) — 보드 사전 생성은 무해.
 */
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import {
  BOARD_GROUPS,
  launchAdminBrowser,
  loginClassnote,
  dismissHonorificDialog,
  fetchCenterId,
  fetchBoards,
  createBoard,
  norm,
  CLASSNOTE_BASE,
} from "./classnote-admin-core.mjs";

const APPLY = process.argv.includes("--apply");
const HEADED = process.argv.includes("--headed");
const subjectArg = (process.argv.find((a) => a.startsWith("--subject=")) || "--subject=math").slice(10);
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Math.max(0, Number(limitArg.slice(8)) || 0) : Infinity;
// --exclude=이름1,이름2 — 생성 제외(예: 박서준C는 실보드 '박서준'에 classnote_name 매핑으로 해소할 케이스).
const EXCLUDE = new Set(
  (process.argv.find((a) => a.startsWith("--exclude="))?.slice(10) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const groups =
  subjectArg === "all" ? Object.values(BOARD_GROUPS) : [BOARD_GROUPS[subjectArg]].filter(Boolean);
if (!groups.length) {
  console.error(`--subject=${subjectArg} 인식 불가 (math|english|all)`);
  process.exit(1);
}

/** 그룹별 기대 보드 목록 — 재원 + 해당 과목 활성 수강. 동명이인(유효이름 중복)은 생성 보류로 분리. */
async function expectedBoards(sql, tenant, group) {
  const rows = await sql`
    select distinct s.id, s.name, s.classnote_name
    from students s
    join enrollments e on e.student_id = s.id and e.end_date is null and e.tenant_id = ${tenant}
    join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
    where s.tenant_id = ${tenant}
      and s.status = 'enrolled'
      and c.subject in ${sql(group.subjectKeys)}`;
  const byName = new Map();
  for (const r of rows) {
    const eff = (r.classnote_name || r.name || "").trim();
    if (!eff) continue;
    if (!byName.has(eff)) byName.set(eff, []);
    byName.get(eff).push(r);
  }
  const boards = [];
  const collisions = [];
  for (const [eff, students] of byName) {
    if (students.length > 1) collisions.push({ name: eff, count: students.length });
    else boards.push({ board: `${group.prefix}${eff}`, student: eff });
  }
  return { boards, collisions };
}

(async () => {
  console.log(`--- ClassNote 보드 프로비저닝 (${APPLY ? "⚠️ APPLY" : "dry-run"} · ${groups.map((g) => g.label).join("/")}) ---`);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const tenant = await resolveTenant(sql);
  console.log(`tenant: ${tenant}`);

  // 1) DB 기대 보드
  const plan = [];
  for (const g of groups) {
    const { boards, collisions } = await expectedBoards(sql, tenant, g);
    plan.push({ group: g, boards, collisions });
    console.log(`[${g.label}] 기대 보드 ${boards.length}개 · 동명이인 보류 ${collisions.length}건`);
    for (const c of collisions)
      console.log(`  ⚠️ 동명이인 "${c.name}" ${c.count}명 — students.classnote_name 접미사(A~G) 지정 후 재실행`);
  }

  // 2) ClassNote 실보드 스캔
  const browser = await launchAdminBrowser({ headed: HEADED });
  const page = await browser.newPage();
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    console.log(`로그인 OK — 실보드 조회(API, center ${centerId})…`);
    const existing = (await fetchBoards(page, centerId)).map((b) => b.name);
    const existingNorm = new Set(existing.map(norm));
    console.log(`실보드 ${existing.length}개(전체) 수집`);

    // 3) diff — --exclude 학생은 생성 대상에서 제외(매핑 등 별도 해소 케이스)
    let totalMissing = 0;
    for (const p of plan) {
      const missingAll = p.boards.filter((b) => !existingNorm.has(norm(b.board)));
      p.missing = missingAll.filter((m) => !EXCLUDE.has(m.student) && !EXCLUDE.has(m.board));
      const excluded = missingAll.length - p.missing.length;
      totalMissing += p.missing.length;
      console.log(
        `\n[${p.group.label}] 매칭 ${p.boards.length - missingAll.length} · 생성 필요 ${p.missing.length}` +
          (excluded ? ` · 제외 ${excluded}(--exclude)` : ""),
      );
      for (const m of p.missing) console.log(`  + ${m.board}`);
    }

    if (!APPLY) {
      console.log(`\n(dry-run) 생성 필요 총 ${totalMissing}개 — 실제 생성은 --apply. 아무것도 변경하지 않았습니다.`);
      return;
    }

    // 4) 생성 (--apply)
    await page.goto(`${CLASSNOTE_BASE}/service/setting/class`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    await dismissHonorificDialog(page);
    let ok = 0;
    let fail = 0;
    let done = 0;
    for (const p of plan) {
      for (const m of p.missing) {
        if (done >= LIMIT) break;
        done++;
        const res = await createBoard(page, m.board);
        if (res.ok) {
          ok++;
          console.log(`  ✅ [${done}] ${m.board}`);
        } else {
          fail++;
          console.log(`  ❌ [${done}] ${m.board} — ${res.reason}`);
        }
        await page.waitForTimeout(900);
      }
    }
    console.log(`\n=== 완료: 생성 ${ok} · 실패 ${fail}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ""} ===`);

    // 5) 재조회 검증(API) — 방금 만든 이름이 실보드에 있는지 결정적으로 확인
    if (ok > 0) {
      const after = new Set((await fetchBoards(page, centerId)).map((b) => norm(b.name)));
      const attempted = plan.flatMap((p) => p.missing).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
      const stillMissing = attempted.filter((m) => !after.has(norm(m.board)));
      console.log(
        stillMissing.length === 0
          ? "재조회 검증(API): 시도분 전부 실보드 확인 ✅"
          : `재조회 검증(API): ${stillMissing.length}개 미확인 — ${stillMissing.map((m) => m.board).join(", ")}`,
      );
    }
  } finally {
    await browser.close().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
})();
