// scripts/_classnote/math-class-boards-load.mjs — 수학 반 보드 계획의 **조회부**(aywa DB + ClassNote GET).
// 판정은 class-board-plan.mjs(순수). 이 파일은 읽기만 한다 — 쓰기는 provision-math-class-boards.mjs.
// 🔴 보호자 전화 값은 반환 계획·로그에 싣지 않는다(판정 입력으로만 쓴다).
import { fetchBoardChildren, fetchBoards, fetchChildDetail } from "./classnote-admin-core.mjs";
import { kstSchoolYear } from "./board-safety.mjs";
import { personalBoardName, planClassBoards } from "./class-board-plan.mjs";
import { CONFIRMED_LINK, confirmedPairKey } from "./child-identity.mjs";

const norm = (s) => String(s ?? "").replace(/\s/g, "");

/**
 * **대상 반** 조건(SQL 조각) — 활성 수학(math·subject_1) · 보고서 발송 반 · 종강 제외. 반 별칭은 `c`.
 * 동기화(loadAywa)와 자동 동기화의 대조(auto-sync-load.mjs)가 **같은 조각**을 쓴다 — 두 곳에 따로 적으면 한쪽만 바뀐 날
 * 대조는 "달라졌다"는데 동기화는 그 반을 대상 밖으로 보고 아무것도 안 한다(되풀이 요청).
 * 🔴 종강 제외(원장 2026-09-29 — 종강 반 6개를 만들었다가 지웠다). aywa는 종강을 is_active가 아니라 closed_at(종강일)에 적는다.
 *    판정 = overlap.ts isLiveSlot과 같은 축(closed_at < 오늘이면 종강).
 * 🔴 보고서 미발송 반(`report_optout` — JJ 자리 반)은 **대상이 아니다**(원장 2026-11-04 *"JJ 미발송반은 클래스노트 반배정도 할 필요없음"* —
 *    11-03 'JJ 맞춤'(연결·배정·해제를 에이와 수강대로)을 되돌렸다). 연결·학생 배정·해제·담임 연결을 하지 않고, 남은 옛 연결은 정기 동기화가
 *    걷는다(math-class-boards-db.mjs). class-board-plan.mjs의 `reportOptout` 분기는 이 조각을 지난 반에선 쓰이지 않는다.
 *    🔴 원스크린 C.N 아이콘의 대상 반(src/features/onescreen/server/classnote-match.ts)도 같은 조건이다 — 가드 classnote-target-guard.test.ts.
 */
export const targetClassWhere = (sql, tenant, today) =>
  sql`c.tenant_id = ${tenant} and c.is_active and not c.report_optout and c.subject in ('math', 'subject_1') and (c.closed_at is null or c.closed_at >= ${today})`;

/**
 * **오늘 그 반에 다니는 재원생** 수강 조건(SQL 조각) — 수강 별칭은 `e`. 테스트 학생·재원이 아닌 학생은 뺀다.
 * 🔴 지점 필터(`e.tenant_id`)를 함께 건다 — 수강 인덱스는 (tenant_id, class_id)·(tenant_id, student_id)라 반 id만으로 조인하면
 *    앞 칸이 빠져 전 지점 수강을 훑는다(자동 동기화가 1분마다 이 조각을 쓴다).
 * 🔴 수업 시작 전·휴원 중인 수강은 ClassNote 배정 대상이 아니다(원장 2026-11-05 *"수업 시작전이거나 휴원 중인 학생은 클래스노트 배정을
 *    하지말것. 수업배정이 되는 순간 동기화 작동하게"*). 시작 전 = `start_date > 오늘`(종전부터) · 휴원 = 학생 상태 휴원(종전부터) **또는
 *    그 수강만 휴원·대기**(`e.on_hold` — 과목별 휴원·시간표 '대기', 2026-11-05 추가). 자동 동기화도 이 조각을 써서, 시작일이 되거나
 *    휴원이 풀리면 '새 학생'으로 잡혀 그 반만 동기화한다(밤사이 시작은 새벽 5시 정기 동기화). 이미 배정된 휴원생의 원아는 떼지 않는다
 *    (자동 해제는 '열린 수강' — 휴원·시작 전 포함 — 을 따로 본다 · 원장 2026-11-03).
 */
export const currentEnrollmentOn = (sql, tenant, today) =>
  sql`e.tenant_id = ${tenant} and (e.end_date is null or e.end_date >= ${today}) and (e.start_date is null or e.start_date <= ${today})
      and not coalesce(e.on_hold, false)
      and exists (select 1 from students s where s.id = e.student_id and s.status = 'enrolled' and not coalesce(s.is_test, false))`;

/**
 * aywa 대상 반·학생. 대상 반 = 활성 수학(math·subject_1) · 보고서 발송 반 · 종강 제외(특강 포함 — 원장 2026-09-30 · 미발송 JJ 반 제외 — 2026-11-04).
 * 학생은 지점 전체(자동 해제가 퇴원생의 원아도 본다) — `status`(휴원 가드)·`isTest`(1인 보드 해제 제외)를 함께 싣는다.
 */
export async function loadAywa(sql, tenant) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  // 특강도 반 보드를 만든다(원장 2026-09-30 *"특강도 그냥 클래스노트에 반을 만드는게 가장 베스트"*) — 가드(원아 출처·전화·생년·
  // 동명이인)는 정규 반과 똑같이 탄다(class-board-plan.mjs). 보고서 제목은 앱이 '[특강] 수업보고서'로 붙인다.
  const classRows = await sql`
    select c.id, c.class_name, c.report_optout,
      coalesce(array_agg(distinct e.student_id) filter (where e.student_id is not null), '{}') as student_ids
    from classes c
    left join enrollments e on e.class_id = c.id and ${currentEnrollmentOn(sql, tenant, today)}
    where ${targetClassWhere(sql, tenant, today)}
    group by c.id, c.class_name, c.report_optout
    order by c.class_name`;
  const students = await loadBoardStudents(sql, tenant);
  const classes = classRows.map((c) => ({ classId: c.id, className: c.class_name, studentIds: c.student_ids, ...(c.report_optout ? { reportOptout: true } : {}) }));
  return { classes, students };
}

/**
 * 지점 학생 전체(퇴원 포함) — 학생 id → { 유효이름 · 학년 · 전화 4칸 · 상태 · 테스트 여부 }. 원아 신분 가드(②③⑦)의 재료.
 * 수학 반 보드 동기화(`loadAywa`)와 영어 반 방 발송 가드(english-guard-load.mjs)가 같은 조회를 쓴다.
 * 🔴 SQL 본문을 한 글자도 바꾸지 말 것 — 연동 앱 질의 목록은 본문으로 조회를 알아본다(바뀌면 웹 배포가 먼저 나가야 한다).
 * 🔴 전화 값은 대조에만 쓴다 — 로그로 찍지 말 것.
 */
export async function loadBoardStudents(sql, tenant) {
  const studentRows = await sql`
    select id, name, classnote_name, grade, parent_phone, student_phone, home_phone, other_phone, status::text as status, coalesce(is_test, false) as is_test
    from students where tenant_id = ${tenant}`;
  return new Map(
    studentRows.map((s) => [
      s.id,
      {
        id: s.id,
        // ClassNote 유효이름 = classnote_name 오버라이드 || name(발송 워커와 같은 규약)
        name: (s.classnote_name?.trim() || s.name || "").trim(),
        grade: s.grade,
        phones: [s.parent_phone, s.student_phone, s.home_phone, s.other_phone],
        status: s.status ?? null,
        isTest: s.is_test === true,
      },
    ]),
  );
}

/**
 * 운영관리 명부 — 원아 id → { 보호자 전화, 생년, 원아 이름, 현재 소속 보드명[] }. 비면 throw(전화 대조 없이는 계획하지 않는다).
 * 원아 이름(`name`) = 관리자 화면의 원아 이름 — 원아 연결(0185a)을 만든 바로 그 이름이라, 연결로 가져온 원아의 ⑥(이름 연속성)을
 * 이 값으로 건다(반 보드에 아직 없는 신입 원아는 다른 이름 출처가 없다 — class-board-plan.mjs `linkMembers`).
 */
export async function fetchAdmissions(page, centerId) {
  const adm = await page.evaluate(async (cid) => {
    // 판정 입력이라 캐시를 쓰지 않는다(2026-11-03 리뷰 B9 — 퇴원처리·해제가 읽은 직후의 명부를 다시 본다).
    const r = await fetch(`/api/v1_2/centers/${cid}/admissioninfos?name=&page_size=2000`, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) throw new Error(`admissioninfos ${r.status}`);
    const j = await r.json();
    return (Array.isArray(j) ? j : (j.results ?? [])).map((x) => {
      // 🔴 배정 칸이 배열이 아니면(칸이 사라짐·모양이 바뀜) 소속을 **모른다** — 빈 배열로 두면 '소속 없음'으로 읽혀 가드가 조용히 꺼진다(B3).
      //    안 떠난 줄 중 보드 번호(`belong_to_class`)가 없는 줄이 하나라도 있으면 **보드 번호 목록(boards·allBoards)만** 모른다
      //    (칸 이름이 바뀌면 배정이 '없음'으로 읽혀 퇴원처리 ⑧을 통과한다 · R6). 보드 이름 목록(boardNames)은 그대로 둔다 — 그것까지 null이면
      //    배정 쪽이 확인된 원아까지 '소속 보드를 읽지 못함'으로 보류해 지금 다니는 학생의 수학 발송이 막힌다(2차 리뷰 F1).
      const list = Array.isArray(x.enrollments) ? x.enrollments : null;
      const idsKnown = list ? !list.some((e) => !e?.date_left && e?.belong_to_class == null) : false;
      const info = x.basic_info ?? {};
      return {
        childId: x.child_id,
        phone: info.carer1_phone ?? null,
        // 보호자 전화 전부(carer1~4 — 2026-11-03 실측: 침산은 carer1만 채워져 있다). 형제 대조·다른 집 판정이 모두 본다(B7).
        phones: Object.keys(info).filter((k) => /^carer\d+_phone$/.test(k)).sort().map((k) => info[k]).filter(Boolean),
        birth: info.child_date_birth ?? null, // 관리자 화면의 생년월일(학부모 프로필 date_birth와 따로 산다)
        name: info.child_name ?? null,
        boardNames: list ? list.filter((e) => !e.date_left).map((e) => e.class_name ?? "") : null,
        // 해제 쪽 '남는 배정'(마지막 배정 가드 · 1인 보드 후보) = **승인된 것만**(`is_approved === true` — null·칸 없음은 안 셈, 리뷰 A2).
        boards: idsKnown ? list.filter((e) => !e.date_left && e.is_approved === true && e.belong_to_class != null)
          .map((e) => ({ id: Number(e.belong_to_class), name: e.class_name ?? "" })) : null,
        // 퇴원처리 쪽 '막는 배정' = **안 떠난 배정 전부**(승인 대기 포함 — 누가 그 원아로 반 보드 가입을 요청한 것이다, 리뷰 B5).
        //   의미가 반대다: 해제는 '남는 것'을 적게(모르면 떼지 않게), 퇴원처리는 '막는 것'을 많게(모르면 내리지 않게) 센다.
        allBoards: idsKnown ? list.filter((e) => !e.date_left && e.belong_to_class != null)
          .map((e) => ({ id: Number(e.belong_to_class), name: e.class_name ?? "", approved: e.is_approved === true })) : null,
      };
    });
  }, centerId);
  if (!adm.length) throw new Error("운영관리 명부가 비었다 — 전화 대조 없이는 계획하지 않는다");
  return new Map(adm.map((a) => [a.childId, { phone: a.phone, phones: a.phones, birth: a.birth, name: a.name, boardNames: a.boardNames, boards: a.boards, allBoards: a.allBoards }]));
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

/**
 * 원장 확인 연결(0185a `linked_by = 'confirmed'` · 원장 2026-11-05) — `학생 id:원아 id` 열쇠 모음(child-identity.mjs `confirmedPairKey`).
 * 사람이 확인한 연결은 운영관리 명부(학부모가 입소 때 낸 기본정보)의 이름·보호자 전화만 대조에서 뺀다 — 수학 반 보드 계획과 영어 반 방 발송이
 * 같은 조회를 쓴다. 🔴 조회 실패는 throw(빈 모음으로 삼키지 않는다 — 수학 동기화는 원아 연결과 같은 규칙으로 그날을 건너뛰고, 영어 발송은 재시도로 둔다).
 * @returns {Promise<Set<string>>}
 */
export async function loadConfirmedChildPairs(sql, tenant) {
  const rows = await sql`select child_id, student_id from classnote_child_links where tenant_id = ${tenant} and linked_by = ${CONFIRMED_LINK}`;
  return new Set(rows.map((r) => confirmedPairKey(r.student_id, r.child_id)));
}

/**
 * 반 보드에서 원아 확인을 마친 학생(0302a status ok) — 학생 id → [{id, name, boardIds}](원아 중복 없이 · 기록된 반 보드 번호들).
 * 1인 보드가 없거나 빈 학생의 원아 판정 출처(원장 2026-11-02 — 1인 보드 원아 배정 해제 · 12월 보드 삭제, class-board-plan.mjs ①).
 * 🔴 조회 실패 = null(throw 아님) — 호출부가 정한다: 반 보드 동기화는 그날을 건너뛴다(대신 출처 없이 돌면 1인 보드가 빈 학생을
 *    전부 보류로 적어 **기록 자체를 지운다**), 1인 보드 준비는 수학을 그날 건너뛴다(비운 1인 보드를 다시 채우지 않게).
 */
export async function loadVerifiedChildren(sql, tenant) {
  const rows = await sql`select student_id, child_id, child_name, board_id from classnote_class_board_members
    where tenant_id = ${tenant} and status = 'ok' and child_id is not null`.catch(() => null);
  if (!Array.isArray(rows)) return null;
  const out = new Map();
  for (const r of rows) {
    const id = Number(r.child_id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const list = out.get(r.student_id) ?? [];
    let entry = list.find((c) => c.id === id);
    if (!entry) list.push((entry = { id, name: r.child_name ?? "", boardIds: [] }));
    const bid = Number(r.board_id);
    if (Number.isSafeInteger(bid) && bid > 0 && !entry.boardIds.includes(bid)) entry.boardIds.push(bid);
    out.set(r.student_id, list);
  }
  return out;
}

/**
 * 원아 연결 출처 원아의 학부모 프로필(이름·생년) — 이번에 읽은 보드에 **없는** 연결 원아만(신입 · 일부 반만 보는 지금 동기화)
 * 원아 상세(`/api/v1/children/{id}` GET)로 읽는다(원장 2026-11-02 A안 · 적대적 리뷰). 계획이 ⑥을 명부 이름 + 프로필 이름 **둘 다**로
 * 걸기 위해서다 — 명부 이름은 연결을 만든 바로 그 입력이라 형제끼리 뒤바뀐 명부를 혼자서는 못 잡는다. 못 읽으면 null(그 학생만 보류).
 * 연결 출처를 쓸 일이 없는 원아(확인 기록이 있는 학생 · 이번 계획 밖 학생 · 명부에 없는 원아)는 읽지 않는다 — 보통 하루 몇 건.
 * @returns {Promise<Map<number,{name:string,date_birth:string|null}|null>>}
 */
async function loadLinkProfiles(page, { classes, membersByBoard, admissions, verifiedChildren, childLinks }) {
  const out = new Map();
  if (!childLinks?.size) return out;
  const planStudents = new Set(classes.flatMap((c) => c.studentIds));
  const seen = new Set();
  for (const list of membersByBoard.values()) if (Array.isArray(list)) for (const x of list) seen.add(Number(x.id));
  for (const [cid, sid] of childLinks) {
    const id = Number(cid);
    if (!Number.isSafeInteger(id) || id <= 0 || out.has(id)) continue;
    if (!planStudents.has(sid) || seen.has(id) || !admissions.get(id)) continue;
    if ((verifiedChildren?.get?.(sid) ?? []).length) continue;
    try {
      const d = await fetchChildDetail(page, id);
      out.set(id, { name: String(d?.name ?? ""), date_birth: d?.date_birth ?? null });
    } catch {
      out.set(id, null);
    }
  }
  return out;
}

/**
 * 전체 계획을 새로 만든다(매 실행 최신 — 계획을 파일에서 읽어 실행하지 않는다).
 * `childLinks`(원아 id → 학생 id, 0185a — class-board-release-load.mjs `loadChildLinks`) = 확인 기록이 아예 없는 학생의 원아 출처
 * (원장 2026-11-02 A안). 원아 이름·생년은 운영관리 명부에서, 학부모 프로필은 읽은 보드 또는 원아 상세 GET(`loadLinkProfiles`)에서.
 * `formerFamily` = 보고서 미발송 반(JJ)의 같은 이름 보드 채택이 낯선 원아 때문에 막혔을 때, 그 원아가 **이 반의 지난 학생**인지 확인하는
 * 콜백(`(cands, {admissions, membersByBoard}) => Promise<Map<반, Set<원아>>>` — 동기화가 해제 판정 한 벌로 넘긴다). 없으면 종전대로 보류.
 * `confirmedPairs` = 원장 확인 연결(`loadConfirmedChildPairs`) — 없으면 확인 없음(명부 이름·보호자 전화까지 다 대조).
 */
export async function loadPlan(page, centerId, { classes, students }, { linkedBoardByClass = new Map(), verifiedChildren = null, verifiedOwnerScope = null, childLinks = null, confirmedPairs = null, formerFamily = null } = {}) {
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
  // 확인 기록의 반 보드(원장 2026-11-02) — 1인 보드가 빈 학생은 "기록된 그 반 보드에 지금도 있는 원아"로 판정하므로 그 보드를 읽는다
  // (일부 반만 보는 지금 동기화에서 다른 반 보드에 있는 원아를 놓치지 않게). 지워진 보드는 읽지 않는다(조회 실패 = 동기화 중단).
  for (const sid of new Set(classes.flatMap((c) => c.studentIds)))
    for (const v of verifiedChildren?.get?.(sid) ?? []) for (const bid of v.boardIds ?? []) if (liveIds.has(Number(bid))) need.add(Number(bid));
  const membersByBoard = new Map();
  let failed = 0;
  for (const id of need) {
    try {
      membersByBoard.set(id, await fetchBoardChildren(page, centerId, id));
    } catch {
      failed++; // undefined로 남겨 "조회 실패" 보류가 되게 한다
    }
  }
  const childProfiles = await loadLinkProfiles(page, { classes, membersByBoard, admissions, verifiedChildren, childLinks });
  const input = { classes, students, boards, membersByBoard, admissions, schoolYear: kstSchoolYear(), linkedBoardByClass, verifiedChildren, verifiedOwnerScope, childLinks, childProfiles, confirmedPairs };
  let plans = planClassBoards(input);
  // 미발송 반(JJ)의 같은 이름 보드 — 낯선 원아가 이 반의 지난 학생인지 확인하고 다시 계획한다(원장 2026-11-03 · class-board-plan.mjs `adoptCandidate`).
  const cands = formerFamily ? plans.filter((p) => p.board.adoptCandidate).map((p) => ({ classId: p.classId, className: p.className, ...p.board.adoptCandidate })) : [];
  if (cands.length) plans = planClassBoards({ ...input, formerFamilyByClass: await formerFamily(cands, { admissions, membersByBoard }) });
  return { plans, boards, membersByBoard, admissions, failed, lookedUp: need.size };
}
