/**
 * scripts/_classnote/classnote-childmap-core.mjs — ClassNote 원아 ID를 aywa 학생에 붙인다(0184a).
 *
 * 이게 있어야 **영어(그룹반) 학부모 연락도** 학생을 특정할 수 있다 — 그룹반 보드명(`[EIE] Let's Speak 6 …`)엔
 * 학생이 없지만 피드 행의 `child`(원아 id)는 **전 보드 100%** 채워진다(2026-08-06 실측 43/43).
 * 판정 규칙 본체는 순수 모듈 [`child-map.mjs`](./child-map.mjs)(Vitest) — 여기는 IO만 책임진다.
 * ⚠️ 매핑은 **여러 원아 → 한 학생**이다(0185a) — 같은 아이가 수학·영어를 따로 가입한 계정 2개를 갖는 게 정상.
 *
 * 🔴 **보호자 전화는 대조에만 쓰고 저장하지 않는다.** `admissioninfos` 응답엔 알레르기·병력·주소까지 실려
 *    오지만 이 코어가 DB에 남기는 건 `classnote_child_links`의 원아 id(정수) 하나뿐이다.
 *    ⚠️ 로그에도 전화를 찍지 말 것(미확정 사유는 "전화 대조 실패"처럼 값 없이 남긴다).
 *
 * ⚠️ **읽기 전용 API**(GET)만 쓴다 — ClassNote엔 아무것도 쓰지 않는다.
 * ⚠️ 쓰기는 aywa `classnote_child_links` 뿐이고, `--apply` 없이는 그것도 안 한다(dry-run 기본).
 */
import { fetchCenterId, loginClassnote } from "./classnote-admin-core.mjs";
import { kstSchoolYear } from "./board-safety.mjs";
import { planChildMap } from "./child-map.mjs";

/** 하루 1회면 충분 — 신규 원아는 학부모 가입 시점에 생기고, 그날 안에 붙으면 된다. */
const DAILY_GUARD_MS = 20 * 60 * 60 * 1000;
let lastRunAt = 0;

/**
 * ClassNote 활성 명부(원아 id·이름·생년·보호자 전화). 화면(운영관리)이 쓰는 엔드포인트라 전건이 한 번에 온다.
 * ⚠️ 반환값에 전화가 들어 있다 — **이 배열을 로그로 찍지 말 것.**
 */
export async function fetchAdmissionInfos(page, centerId) {
  const rows = await page.evaluate(
    async ([c]) => {
      const r = await fetch(`/api/v1_2/centers/${c}/admissioninfos?name=&page_size=2000`, {
        headers: { accept: "application/json" },
      });
      if (!r.ok) throw new Error(`원아 명부 조회 실패 HTTP ${r.status}`);
      const j = await r.json();
      return (j?.results ?? j ?? []).map((x) => ({
        childId: x?.child_id ?? null,
        name: x?.basic_info?.child_name ?? null,
        birth: x?.basic_info?.child_date_birth ?? null,
        phones: [x?.basic_info?.carer1_phone, x?.basic_info?.carer2_phone, x?.basic_info?.carer3_phone],
      }));
    },
    [centerId],
  );
  return rows.filter((r) => Number.isFinite(Number(r.childId)));
}

/**
 * 한 주기 — 아직 안 붙은 원아만 확정해 붙인다(멱등).
 *
 * @param {object} opts - { tenant, apply, log, force }
 *   apply=false(기본)면 **판정만** 하고 DB를 건드리지 않는다.
 * @returns {Promise<{ran:boolean, children?:number, mapped?:number, applied?:number, skipped?:number, samples?:Array}>}
 */
export async function syncChildMapOnce(sql, browser, { tenant, apply = false, log = console.log, force = false }) {
  if (!force && Date.now() - lastRunAt < DAILY_GUARD_MS) return { ran: false };
  lastRunAt = Date.now();

  const page = await browser.newPage();
  let children;
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    children = await fetchAdmissionInfos(page, centerId);
  } finally {
    // ⚠️ 형제 코어(provision·notice)와 같은 규약 — 실패해도 반드시 닫는다(데몬은 오래 사는 프로세스라
    //    페이지 누수가 쌓이면 공유 브라우저가 OOM으로 죽고 발송까지 같이 멈춘다).
    await page.close().catch(() => {});
  }

  // ⚠️ **퇴원 포함 전 학생**을 후보로 둔다 — 퇴원생 학부모도 글을 남기고(실측 있음), 재원만 보면
  //    퇴원 동명이인의 원아가 재원 학생에게 잘못 붙는다(parent-post-filter.mjs의 F1과 같은 함정).
  const [students, linked] = await Promise.all([
    sql`select id, name, classnote_name, grade, parent_phone, student_phone, home_phone, other_phone
        from students where tenant_id = ${tenant}`,
    sql`select child_id from classnote_child_links where tenant_id = ${tenant}`,
  ]);
  const candidates = students.map((s) => ({
    id: s.id,
    name: s.name,
    classnote_name: s.classnote_name,
    grade: s.grade,
    phones: [s.parent_phone, s.student_phone, s.home_phone, s.other_phone],
  }));

  const { plan, skipped } = planChildMap(children, candidates, {
    schoolYear: kstSchoolYear(),
    linkedChildIds: linked.map((r) => Number(r.child_id)),
  });
  if (!apply) {
    log(`[원아매핑] (점검) 원아 ${children.length}명 · 새로 확정 ${plan.length}명 · 미확정 ${skipped.length}명`);
    return { ran: true, children: children.length, mapped: plan.length, applied: 0, skipped: skipped.length, samples: skipped.slice(0, 10) };
  }

  let applied = 0;
  for (const p of plan) {
    // 한 건씩 — PK 충돌(그 원아가 그새 다른 학생에 붙음)은 그 건만 건너뛰고 나머지는 붙는다.
    // ⚠️ `do nothing`이라 **기존 링크를 덮지 않는다** — 사람이 손으로 고친 매핑을 자동 실행이 되돌리면 안 된다.
    try {
      await sql`
        insert into classnote_child_links (tenant_id, child_id, student_id, linked_by)
        values (${tenant}, ${p.childId}, ${p.studentId}, ${p.by})
        on conflict (tenant_id, child_id) do nothing`;
      applied++;
    } catch (e) {
      log(`[원아매핑] 원아 ${p.childId} 붙이기 실패(건너뜀): ${e.message}`);
    }
  }
  log(`[원아매핑] 원아 ${children.length}명 · 새로 붙임 ${applied}명 · 미확정 ${skipped.length}명`);
  return { ran: true, children: children.length, mapped: plan.length, applied, skipped: skipped.length, samples: skipped.slice(0, 10) };
}
