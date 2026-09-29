// scripts/_classnote/math-class-boards-load.mjs — 수학 반 보드 계획의 **조회부**(aywa DB + ClassNote GET).
// 판정은 class-board-plan.mjs(순수). 이 파일은 읽기만 한다 — 쓰기는 provision-math-class-boards.mjs.
// 🔴 보호자 전화 값은 반환 계획·로그에 싣지 않는다(판정 입력으로만 쓴다).
import { fetchBoardChildren, fetchBoards } from "./classnote-admin-core.mjs";
import { kstSchoolYear } from "./board-safety.mjs";
import { personalBoardName, planClassBoards } from "./class-board-plan.mjs";

const norm = (s) => String(s ?? "").replace(/\s/g, "");

/** aywa 대상 반·학생. 대상 반 = 활성 수학(math·subject_1) · 보고서 발송 반 · 특강 제외 · 종강 제외. */
export async function loadAywa(sql, tenant) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  // 특강 판정 = 앱 단일소스 isSpecialLecture(src/features/classes/special-lecture.ts)와 같다 — is_special 또는 이름에 '특강'.
  const classRows = await sql`
    select c.id, c.class_name,
      coalesce(array_agg(distinct e.student_id) filter (where e.student_id is not null), '{}') as student_ids
    from classes c
    left join enrollments e on e.class_id = c.id
      and (e.end_date is null or e.end_date >= ${today}) and (e.start_date is null or e.start_date <= ${today})
      and exists (select 1 from students s where s.id = e.student_id and s.status = 'enrolled' and not coalesce(s.is_test, false))
    where c.tenant_id = ${tenant} and c.is_active and not c.report_optout and c.subject in ('math', 'subject_1')
      and not coalesce(c.is_special, false) and strpos(c.class_name, '특강') = 0
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
      boardNames: (x.enrollments ?? []).filter((e) => !e.date_left).map((e) => e.class_name ?? ""),
    }));
  }, centerId);
  if (!adm.length) throw new Error("운영관리 명부가 비었다 — 전화 대조 없이는 계획하지 않는다");
  return new Map(adm.map((a) => [a.childId, { phone: a.phone, boardNames: a.boardNames }]));
}

/** 1인 보드 id — 학생 유효이름으로(공백 무시 정확 일치). 0개·2개 이상이면 null. */
export function personalBoardId(boards, studentName) {
  const want = norm(personalBoardName(studentName));
  const hit = boards.filter((b) => norm(b.name) === want);
  return hit.length === 1 ? hit[0].id : null;
}

/** 반 ↔ 보드 연결표(0302a) — 반 이름이 바뀌어도 이 번호로 같은 보드를 찾는다. 표가 없으면 빈 지도. */
export async function loadLinkedBoards(sql, tenant) {
  const rows = await sql`select class_id, board_id from classnote_class_boards where tenant_id = ${tenant}`.catch(() => []);
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
  const liveIds = new Set(boards.map((b) => Number(b.id)));
  for (const id of linkedBoardByClass.values()) if (liveIds.has(Number(id))) need.add(Number(id));
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
