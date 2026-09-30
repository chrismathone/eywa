// scripts/_classnote/math-class-boards-load.mjs — 수학 반 보드 계획의 **조회부**(aywa DB + ClassNote GET).
// 판정은 class-board-plan.mjs(순수). 이 파일은 읽기만 한다 — 쓰기는 provision-math-class-boards.mjs.
// 🔴 보호자 전화 값은 반환 계획·로그에 싣지 않는다(판정 입력으로만 쓴다).
import { fetchBoardChildren, fetchBoards } from "./classnote-admin-core.mjs";
import { kstSchoolYear } from "./board-safety.mjs";
import { personalBoardName, planClassBoards } from "./class-board-plan.mjs";

const norm = (s) => String(s ?? "").replace(/\s/g, "");

/** aywa 대상 반·학생. 대상 반 = 활성 수학(math·subject_1) · 보고서 발송 반 · 종강 제외(특강 포함 — 원장 2026-09-30). */
export async function loadAywa(sql, tenant) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  // 특강도 반 보드를 만든다(원장 2026-09-30 *"특강도 그냥 클래스노트에 반을 만드는게 가장 베스트"*) — 가드(원아 출처·전화·생년·
  // 동명이인)는 정규 반과 똑같이 탄다(class-board-plan.mjs). 보고서 제목은 앱이 '[특강] 수업보고서'로 붙인다.
  const classRows = await sql`
    select c.id, c.class_name,
      coalesce(array_agg(distinct e.student_id) filter (where e.student_id is not null), '{}') as student_ids
    from classes c
    left join enrollments e on e.class_id = c.id
      and (e.end_date is null or e.end_date >= ${today}) and (e.start_date is null or e.start_date <= ${today})
      and exists (select 1 from students s where s.id = e.student_id and s.status = 'enrolled' and not coalesce(s.is_test, false))
    where c.tenant_id = ${tenant} and c.is_active and not c.report_optout and c.subject in ('math', 'subject_1')
      -- 🔴 종강 제외(원장 2026-09-29 — 종강 반 6개를 만들었다가 지웠다). aywa는 종강을 is_active가 아니라
      --    closed_at(종강일)에 적는다. 판정 = overlap.ts isLiveSlot과 같은 축(closed_at < 오늘이면 종강).
      and (c.closed_at is null or c.closed_at >= ${today})
    group by c.id, c.class_name
    order by c.class_name`;
  const studentRows = await sql`
    select id, name, classnote_name, grade, parent_phone, student_phone, home_phone, other_phone
    from students where tenant_id = ${tenant}`;
  const students = new Map(
    studentRows.map((s) => [
      s.id,
      {
        id: s.id,
        // ClassNote 유효이름 = classnote_name 오버라이드 || name(발송 워커와 같은 규약)
        name: (s.classnote_name?.trim() || s.name || "").trim(),
        grade: s.grade,
        phones: [s.parent_phone, s.student_phone, s.home_phone, s.other_phone],
      },
    ]),
  );
  const classes = classRows.map((c) => ({ classId: c.id, className: c.class_name, studentIds: c.student_ids }));
  return { classes, students };
}

/** 운영관리 명부 — 원아 id → { 보호자 전화, 현재 소속 보드명[] }. 비면 throw(전화 대조 없이는 계획하지 않는다). */
export async function fetchAdmissions(page, centerId) {
  const adm = await page.evaluate(async (cid) => {
    const r = await fetch(`/api/v1_2/centers/${cid}/admissioninfos?name=&page_size=2000`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`admissioninfos ${r.status}`);
    const j = await r.json();
    return (Array.isArray(j) ? j : (j.results ?? [])).map((x) => ({
      childId: x.child_id,
      phone: x.basic_info?.carer1_phone ?? null,
      birth: x.basic_info?.child_date_birth ?? null, // 관리자 화면의 생년월일(학부모 프로필 date_birth와 따로 산다)
      boardNames: (x.enrollments ?? []).filter((e) => !e.date_left).map((e) => e.class_name ?? ""),
    }));
  }, centerId);
  if (!adm.length) throw new Error("운영관리 명부가 비었다 — 전화 대조 없이는 계획하지 않는다");
  return new Map(adm.map((a) => [a.childId, { phone: a.phone, birth: a.birth, boardNames: a.boardNames }]));
}

/** 1인 보드 id — 학생 유효이름으로(공백 무시 정확 일치). 0개·2개 이상이면 null. */
export function personalBoardId(boards, studentName) {
  const want = norm(personalBoardName(studentName));
  const hit = boards.filter((b) => norm(b.name) === want);
  return hit.length === 1 ? hit[0].id : null;
}

/**
 * 종강 반 중 **ClassNote 보드가 아직 살아 있어** 연결을 지킬 반(원장 2026-09-30 *"종강은 클래스노트에 반이 살아있는 한은
 * 계속 보내고, 이후에 반이 사라지면 반 선택이 뜨도록"*). 새 보드는 만들지 않는다(종강 반 생성 제외는 그대로) — 이미 있는
 * 연결만 남긴다. 판정은 순수 `closedClassesToKeep`(class-board-plan.mjs).
 */
export async function loadClosedLinked(sql, tenant) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const rows = await sql`select c.id from classes c
    join classnote_class_boards b on b.tenant_id = c.tenant_id and b.class_id = c.id
    where c.tenant_id = ${tenant} and c.is_active and not c.report_optout and c.subject in ('math', 'subject_1')
      and c.closed_at is not null and c.closed_at < ${today}`;
  // 🔴 조회 실패는 throw — 빈 목록으로 삼키면 동기화가 종강 반 연결을 **전부 지운다**(되돌릴 수 없다).
  return rows.map((r) => r.id);
}

/**
 * 반 ↔ 보드 연결표(0302a) — 반 이름이 바뀌어도 이 번호로 같은 보드를 찾는다. 표가 없으면 빈 지도.
 * `strict` = 조회 실패를 throw(종강 반 연결 지키기처럼 **빈 지도가 삭제로 이어지는** 자리 — 삼키면 연결이 전부 지워진다).
 */
export async function loadLinkedBoards(sql, tenant, { strict = true } = {}) {
  // 기본값 strict(개명 감사 G9) — 이 지도가 비면 계획이 이름으로 후퇴한다. 삼키고 싶은 호출자만 strict:false로.
  const q = sql`select class_id, board_id from classnote_class_boards where tenant_id = ${tenant}`;
  const rows = strict ? await q : await q.catch(() => []);
  return new Map(rows.map((r) => [r.class_id, Number(r.board_id)]));
}

/** 전체 계획을 새로 만든다(매 실행 최신 — 계획을 파일에서 읽어 실행하지 않는다). */
export async function loadPlan(page, centerId, { classes, students }, { linkedBoardByClass = new Map() } = {}) {
  const boards = await fetchBoards(page, centerId);
  const admissions = await fetchAdmissions(page, centerId);
  const need = new Set();
  for (const sid of new Set(classes.flatMap((c) => c.studentIds))) {
    const id = personalBoardId(boards, students.get(sid)?.name ?? "");
    if (id != null) need.add(id);
  }
  for (const c of classes) for (const b of boards) if (b.name === c.className) need.add(b.id);
  // 연결된 보드(이름이 바뀌었을 수 있다)도 원아를 읽는다 — 안 읽으면 '이미 배정' 판정이 비어 전원 다시 배정하려 든다.
  // 🔑 **이번 계획의 반**에 연결된 보드만 읽는다(2026-09-30 지금 동기화 — 반 하나를 볼 때 전 반 보드를 읽지 않게).
  //    다른 반에 연결된 보드의 원아는 계획이 쓰지 않는다(같은 이름 보드가 남의 반 연결이면 원아와 무관하게 막는다).
  const liveIds = new Set(boards.map((b) => Number(b.id)));
  for (const c of classes) {
    const id = linkedBoardByClass.get(c.classId);
    if (id != null && liveIds.has(Number(id))) need.add(Number(id));
  }
  const membersByBoard = new Map();
  let failed = 0;
  for (const id of need) {
    try {
      membersByBoard.set(id, await fetchBoardChildren(page, centerId, id));
    } catch {
      failed++; // undefined로 남겨 "조회 실패" 보류가 되게 한다
    }
  }
  const plans = planClassBoards({ classes, students, boards, membersByBoard, admissions, schoolYear: kstSchoolYear(), linkedBoardByClass });
  return { plans, boards, membersByBoard, admissions, failed, lookedUp: need.size };
}
