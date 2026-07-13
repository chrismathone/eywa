/**
 * scripts/_classnote/assign-classnote-students.mjs — 학생↔개별 보드 배정 전수조사 + (--apply) 배정.
 *
 * ClassNote 제약: 학생 엔티티는 **학부모가 가입·승인해야** 생긴다("회원가입 후 반배정 필요") — 그래서
 * 보드(provision-classnote-boards.mjs)는 미리 만들어도, 배정은 가입 후에만 가능.
 *
 * 판독(2026-07-13 API 전환 — Edutrix 원본의 per-학생 DOM 검색은 오탐·모달 스크롤 스캔은 비결정이라 폐기):
 * 내부 REST로 보드별 배정 인원(centers/{id}/classes.approved_children)과 가입 원아 목록(children)을 전건
 * 조회해 전수 판정(읽기 전용):
 *   assigned(자기 보드 1명+) / ready(가입했는데 자기 보드 0명 = 배정 가능) /
 *   not_signed_up(가입 안 됨 = 학부모 초대 필요) / board_missing(보드 없음 = provision 먼저).
 *
 * 실행(기본 dry-run — 스캔·판정만, 아무것도 변경하지 않음):
 *   node --env-file=.env.local scripts/_classnote/assign-classnote-students.mjs [--subject=math|english|all] [--student=이름]
 * 실제 배정(ready 대상만):
 *   node --env-file=.env.local scripts/_classnote/assign-classnote-students.mjs --apply [--limit=N] [--headed]
 * ⚠️ --apply 배정 흐름(학생 행 클릭→반 선택→선택완료)은 Edutrix 원본 이식 — 첫 실대상 발생 시 1건으로 검증할 것.
 */
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import {
  BOARD_GROUPS,
  launchAdminBrowser,
  loginClassnote,
  dismissHonorificDialog,
  collectModalButtons,
  fetchCenterId,
  fetchBoards,
  fetchChildren,
  childKeys,
  norm,
  CLASSNOTE_BASE,
} from "./classnote-admin-core.mjs";

const APPLY = process.argv.includes("--apply");
const HEADED = process.argv.includes("--headed");
const subjectArg = (process.argv.find((a) => a.startsWith("--subject=")) || "--subject=math").slice(10);
const studentArg = process.argv.find((a) => a.startsWith("--student="))?.slice(10)?.trim() || null;
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Math.max(0, Number(limitArg.slice(8)) || 0) : Infinity;

const groups =
  subjectArg === "all" ? Object.values(BOARD_GROUPS) : [BOARD_GROUPS[subjectArg]].filter(Boolean);
if (!groups.length) {
  console.error(`--subject=${subjectArg} 인식 불가 (math|english|all)`);
  process.exit(1);
}

async function targetsOf(sql, tenant, group) {
  const rows = await sql`
    select distinct s.id, s.name, s.classnote_name
    from students s
    join enrollments e on e.student_id = s.id and e.end_date is null and e.tenant_id = ${tenant}
    join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
    where s.tenant_id = ${tenant}
      and s.status = 'enrolled'
      and c.subject in ${sql(group.subjectKeys)}`;
  return rows
    .map((r) => {
      const eff = (r.classnote_name || r.name || "").trim();
      return eff ? { studentName: eff, board: `${group.prefix}${eff}`, subject: group.label } : null;
    })
    .filter(Boolean);
}

/** "반 추가" 모달 열기(학생 관리 페이지). */
async function openAssignModal(page) {
  await page.goto(`${CLASSNOTE_BASE}/service/setting/child`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await dismissHonorificDialog(page);
  // '반 추가' 버튼은 승인 완료 탭에서만 노출 — 탭 먼저 활성화.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.innerText || "").includes("승인 완료"),
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);
  const opened = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      ((b.innerText || "").trim() || "").includes("반 추가"),
    );
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!opened) throw new Error("'반 추가' 버튼을 찾지 못함(학생 관리 페이지)");
  await page.waitForTimeout(2200);
  return true;
}

/** API 전수 스캔 — 보드별 배정 인원 + 가입 원아 매칭 키 집합(읽기 전용 GET). */
async function scanViaApi(page) {
  const centerId = await fetchCenterId(page);
  const boards = await fetchBoards(page, centerId);
  const boardCount = new Map(boards.map((b) => [norm(b.name), b.children]));
  const memberKeys = new Set();
  for (const name of await fetchChildren(page, centerId)) for (const k of childKeys(name)) memberKeys.add(k);
  return { boardCount, memberKeys, centerId, boardsTotal: boards.length };
}

/** 판정 — 자기 보드 인원 ≥1: assigned / 가입멤버에 있고 보드 0명: ready / 멤버에 없음: not_signed_up. */
function judge(t, scan) {
  const cnt = scan.boardCount.get(norm(t.board));
  if (cnt === undefined) return { status: "board_missing" };
  if (cnt >= 1) return { status: "assigned" };
  const clean = t.studentName.replace(/[a-zA-Z]/g, "").trim();
  const signedUp = scan.memberKeys.has(t.studentName) || scan.memberKeys.has(clean);
  return signedUp ? { status: "ready" } : { status: "not_signed_up" };
}

/** (--apply) ready 학생 1명 배정 — [ALL] 자식 행 클릭 → 반 드롭다운 → 보드 정확일치 선택 → 선택완료. */
async function assignOne(page, t) {
  const clean = t.studentName.replace(/[a-zA-Z]/g, "").trim();
  // [ALL] 아코디언에서 학생 행 찾기(모달 스크롤하며)
  let clicked = false;
  await collectModalButtons(page, {
    rounds: 60,
    settleRounds: 4,
    onRound: async () => {
      if (clicked) return;
      clicked = await page.evaluate(
        ([wantA, wantB]) => {
          const dlg = document.querySelector('div[role="dialog"]');
          if (!dlg) return false;
          const rows = Array.from(dlg.querySelectorAll("button")).filter((b) => {
            const t2 = (b.innerText || "").trim();
            return (t2 === wantA || t2 === wantB) && !t2.includes("|");
          });
          if (rows.length !== 1) return false; // 0=미노출(계속 스크롤) / 2+=동명이인(중단)
          rows[0].scrollIntoView({ block: "center" });
          rows[0].click();
          return true;
        },
        [t.studentName, clean],
      );
    },
  });
  if (!clicked) {
    await page.keyboard.press("Escape").catch(() => {});
    return { status: "error", note: "학생 행 미발견/동명이인" };
  }
  await page.waitForTimeout(900);

  // 반 드롭다운 → 보드 정확일치(공백제거) 선택
  const ddOpened = await page.evaluate(() => {
    const modal = document.querySelector('div[role="dialog"]') || document.body;
    const dd =
      modal.querySelector("button.css-13ac07v") ||
      modal.querySelector('span[data-label="true"]')?.closest("button") ||
      Array.from(modal.querySelectorAll("span"))
        .find((s) => (s.innerText || "").includes("반배정 필요"))
        ?.closest("button");
    if (dd) {
      dd.click();
      return true;
    }
    return false;
  });
  if (!ddOpened) {
    await page.keyboard.press("Escape").catch(() => {});
    return { status: "error", note: "반 드롭다운 없음" };
  }
  await page.waitForTimeout(1200);

  const selected = await page.evaluate((label) => {
    const want = label.replace(/\s/g, "");
    for (const el of document.querySelectorAll("div, li, button, span, option, p")) {
      const t2 = (el.innerText || el.textContent || "").trim();
      if (t2.replace(/\s/g, "") === want && !t2.includes("\n")) {
        if (el.tagName === "OPTION") {
          const sel = el.closest("select");
          if (sel) {
            sel.value = el.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        if (el.offsetParent !== null) {
          el.click();
          return true;
        }
      }
    }
    return false;
  }, t.board);
  if (!selected) {
    await page.keyboard.press("Escape").catch(() => {});
    return { status: "error", note: "보드 옵션 미발견" };
  }
  await page.waitForTimeout(800);

  const LABELS = ["선택완료", "선택 완료", "반 추가", "추가", "확인", "저장"];
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await page.evaluate((labels) => {
      const modal = document.querySelector('div[role="dialog"]') || document.body;
      const buttons = Array.from(modal.querySelectorAll("button"));
      for (const label of labels) {
        const btn = buttons.find((b) => (b.innerText || "").trim() === label);
        if (btn) {
          if (btn.disabled) return { disabled: true };
          btn.click();
          return { ok: true };
        }
      }
      return {};
    }, LABELS);
    if (res.ok) {
      await page.waitForTimeout(2500);
      return { status: "assigned" };
    }
    await page.waitForTimeout(1000);
  }
  await page.keyboard.press("Escape").catch(() => {});
  return { status: "error", note: "제출 버튼 실패" };
}

(async () => {
  console.log(`--- ClassNote 학생↔개별반 배정 (${APPLY ? "⚠️ APPLY" : "dry-run 전수조사"} · ${groups.map((g) => g.label).join("/")}) ---`);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const tenant = await resolveTenant(sql);

  let targets = [];
  for (const g of groups) targets.push(...(await targetsOf(sql, tenant, g)));
  if (studentArg) {
    const exact = targets.filter((t) => t.studentName === studentArg);
    targets = exact.length ? exact : targets.filter((t) => t.studentName.includes(studentArg));
  }
  console.log(`대상 ${targets.length}건${studentArg ? ` (필터: ${studentArg})` : ""}`);
  if (!targets.length) return sql.end({ timeout: 5 });

  const browser = await launchAdminBrowser({ headed: HEADED });
  const page = await browser.newPage();
  try {
    await loginClassnote(page);
    console.log("전수 조회 중(API — 보드 인원 + 가입 원아)…");
    const scan = await scanViaApi(page);
    console.log(`보드 ${scan.boardsTotal}개 · 가입 원아 매칭키 ${scan.memberKeys.size}개 수집`);

    const detail = targets.map((t) => ({ ...t, ...judge(t, scan) }));
    const stats = {};
    for (const d of detail) stats[d.status] = (stats[d.status] ?? 0) + 1;

    console.log("\n=== 판정 ===");
    for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
    const show = (label, arr, fmt) => {
      if (!arr.length) return;
      console.log(`\n${label} ${arr.length}건:`);
      for (const d of arr) console.log(`  - ${fmt(d)}`);
    };
    show("🏫 보드 없음(provision 먼저)", detail.filter((d) => d.status === "board_missing"), (d) => d.board);
    show("✅ 배정 가능(가입 완료·보드 비어있음)", detail.filter((d) => d.status === "ready"), (d) => `${d.studentName} → ${d.board}`);
    show("📨 학부모 초대 필요(미가입)", detail.filter((d) => d.status === "not_signed_up"), (d) => `${d.studentName} (${d.subject})`);

    if (!APPLY) {
      console.log("\n(dry-run) 아무것도 변경하지 않았습니다. 배정 실행은 --apply (ready 대상만).");
      return;
    }

    const ready = detail.filter((d) => d.status === "ready").slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
    console.log(`\n--apply: ready ${ready.length}건 배정 시작`);
    let done = 0;
    for (const t of ready) {
      done++;
      await openAssignModal(page); // 학생마다 모달 새로 열기(상태 오염 방지)
      let r;
      try {
        r = await assignOne(page, t);
      } catch (e) {
        r = { status: "error", note: e.message };
        await page.keyboard.press("Escape").catch(() => {});
      }
      console.log(`  [${done}/${ready.length}] ${t.board} → ${r.status}${r.note ? ` (${r.note})` : ""}`);
    }
  } finally {
    await browser.close().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
})();
