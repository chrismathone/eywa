// scripts/_classnote/plan-classnote-offboard.mjs — **명부 퇴원처리(전 과목 퇴원 45일 뒤) 드라이런**(ClassNote·DB 쓰기 0).
//
// 원장 2026-11-03 *"남은 수강과목이 1개도 없는 경우에는 45일 뒤 자동으로 퇴원처리"* — 연동 PC가 실제로 내리기 전에 명단을 사람이 본다.
// 판정·조회는 매일 동기화와 같은 코드(`runOffboard` apply=false): DB 읽기 + ClassNote GET(재원 명부 · 원아마다 글 목록 · 원아 상세). 백업·퇴소 0.
//
// `--observe` = 05시 정기 동기화의 **관찰 모드**를 그대로 돌려 보고서에 남을 줄을 보여 준다(스위치를 강제로 끈다 — 댓글까지 GET · 쓰기 0).
//
// 실행: CLASSNOTE_TENANT_ID=… node --env-file=.env.local scripts/_classnote/plan-classnote-offboard.mjs [--observe] [--json 파일]
import fs from "node:fs";
import postgres from "postgres";
import { fetchBoards, fetchCenterId, launchAdminBrowser, loginClassnote } from "./classnote-admin-core.mjs";
import { resolveTenant } from "./classnote-core.mjs";
import { runOffboard } from "./classnote-offboard.mjs";
import { offboardDailyLimit, offboardEnabled, rosterConsistency } from "./classnote-offboard-plan.mjs";
import { fetchAdmissions } from "./math-class-boards-load.mjs";

const jsonAt = process.argv.indexOf("--json");
const jsonOut = jsonAt > 0 ? process.argv[jsonAt + 1] : null;
const observe = process.argv.includes("--observe");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const browser = await launchAdminBrowser();
let exitCode = 0;
try {
  const tenant = await resolveTenant(sql);
  const page = await (await browser.newContext()).newPage();
  await loginClassnote(page);
  // 관찰 모드 = apply:true + 스위치 강제 꺼짐(PC 값과 무관) — 그래야 실제로 내리지 않는다(백업·퇴소·멈춤 표식 쓰기는 켜졌을 때만).
  const events = [];
  const r = await runOffboard(sql, page, {
    tenant, centerId: await fetchCenterId(page), apply: observe, log: () => {}, events, env: observe ? { ...process.env, CLASSNOTE_OFFBOARD: "off" } : process.env,
  });
  if (observe) {
    console.log(`\n관찰 모드 보고서 줄 ${events.length}개(명부 퇴원처리 · 정기 동기화가 이대로 남긴다)`);
    for (const e of events) console.log(`  [${e.group}] ${e.text}`);
  }
  if (r.gets) console.log(`\nClassNote GET 수: 글 목록 ${r.gets.postPages}쪽 · 원아 상세 ${r.gets.details}번 · 댓글 요청 ${r.gets.comments}번`);
  console.log(`연동 PC 스위치: ${offboardEnabled() ? "켜짐(CLASSNOTE_OFFBOARD=on — 정기 동기화가 실제로 내린다)" : "꺼짐(기본 — 정기 동기화는 보고서에 '퇴원처리 예정'만 남긴다)"}`);
  if (r.skipped) console.log(`오늘은 명부 퇴원처리를 하지 않습니다 — ${events.at(-1)?.text ?? r.skipped}`);
  else {
    const { plan, checked } = r;
    const ok = checked.filter((c) => c.ok);
    const limit = offboardDailyLimit();
    console.log(`\n퇴원처리 대상 ${ok.length}명(오늘 상한 ${limit}명 — 오래된 순으로 앞 ${Math.min(limit, ok.length)}명이 첫날)`);
    for (const c of ok) console.log(`  ${c.childName}${c.studentName !== c.childName ? `(${c.studentName})` : ""} · 퇴원 ${c.withdrawnAt} · 마지막 수강 종료 ${c.lastEnd ?? "-"} · ${c.days}일 · 원아 1 · 백업될 글 ${c.posts}건 · 소속 ${c.boardNames.join(", ") || "없음"}`);
    const late = checked.filter((c) => !c.ok);
    console.log(`\nClassNote 확인에서 보류 ${late.length}명`);
    for (const c of late) console.log(`  ${c.childName}(${c.studentName}) · ${c.days}일 — ${c.why}`);
    console.log(`\n전체방 판정: ${plan.centerWide}`);
    // 회차 건전성(B3) — 정기 동기화라면 이 값이 있을 때 그날은 하지 않는다.
    const cid = await fetchCenterId(page);
    const bad = rosterConsistency({ admissions: await fetchAdmissions(page, cid), centerBoards: await fetchBoards(page, cid), wideIds: new Set(plan.centerWideIds) });
    console.log(`회차 건전성: ${bad ?? "정상(명부의 전체방 배정 수 ≈ 전체방 보드 원아 수)"}`);
    const byCode = plan.excluded.reduce((m, x) => ({ ...m, [x.code]: (m[x.code] ?? 0) + 1 }), {});
    // 겹침 포함 — 한 원아가 걸린 사유를 전부 센다(다른 대조와 사유별로 맞춰 보기 위해).
    const anyCode = plan.excluded.flatMap((x) => x.codes ?? [x.code]).reduce((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
    console.log(`\n45일이 지났지만 가드로 제외 ${plan.excluded.length}건 · 첫 사유별 ${JSON.stringify(byCode)} · 겹침 포함 ${JSON.stringify(anyCode)}`);
    for (const x of plan.excluded) console.log(`  ${x.childName}(${x.studentName ?? "?"}) — ${x.why}${(x.codes ?? []).length > 1 ? ` [그 밖에 ${x.codes.slice(1).join(", ")}]` : ""}`);
    console.log(`\n45일 전(기다림) ${plan.waiting.length}명 · 학생과 이어지지 않은 원아(대상 아님) ${plan.unlinked}명`);
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), mode: r.mode, centerWide: plan.centerWide, consistency: bad ?? null, planned: r.planned ?? [], gets: r.gets ?? null, events, ok, late, excluded: plan.excluded, waiting: plan.waiting, unlinked: plan.unlinked }, null, 2));
  }
  console.log("\n계획만 봤습니다 — ClassNote·DB 변경 없음(백업·퇴소 0).");
} catch (e) {
  exitCode = 1;
  console.error(`실패 — ${String(e?.message ?? e).slice(0, 300)}`);
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
process.exit(exitCode);
