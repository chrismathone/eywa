/**
 * scripts/_classnote/cross-subject-teachers.mjs — 학부모 연락을 **그 보드를 못 보는 다른 과목 담당 선생님**에게도 알리기 위한 수신자 계산(0331a).
 *
 * 왜(실사고 2026-10-02 김근호): 아버지가 영어 반 글에 "두통있어서 오늘학원쉽니다"를 달았는데 그날 수업은 수학이었다.
 * 영어 보드는 영어 선생님만 보고(ClassNote), 에이와 벨은 수학 보드 글만 수학 담당에게 간다 → **수학 선생님은 알 길이 없었다.**
 * 반대도 같다(수학 보드에 쓴 결석 연락을 영어 선생님이 모른다). 원장 *"체킹가능하게 배선해야할거같네"*.
 *
 * 나눠 맡는다:
 *  - **누구에게**(여기, 워커) — 그 학생의 지금 담당 선생님 계산은 가드 8겹짜리 한 벌(notify-recipients)이 워커에 있다. 과목만 뒤집어 부른다.
 *  - **출결 연락인가**(앱) — AI 분류는 앱만 한다. 앱은 분류 결과가 출결일 때 원문 행에 적힌 사람(`cross_teacher_ids`)에게 벨을 넣는다.
 *    인사·감사 댓글은 다른 과목 담당에게 가지 않는다(그 보드 선생님에게 한 말이다).
 *
 * 받는 사람 = 그 학생이 **오늘 다니는, 글이 올라온 보드의 과목이 아닌** 운영 반의 담임·교시 담당·오늘 위임(`recipientsFor`의 재검증·상한 가드 그대로).
 * 같은 과목 담당은 넣지 않는다 — 수학 보드 글은 이미 원문 벨이 가고, 영어 보드는 선생님들이 ClassNote에서 직접 본다(원장 결정 2026-07-15).
 * 학생은 원문 행과 같은 축(원아 id → 학생, 0185a)으로 정하되, **다른 근거와 어긋나면 붙이지 않는다**(가드 (1) 학생 확정과 같은 취지):
 *   · 반 보드 판정(0302a)이 그 원아를 다른 학생으로 확정해 둔 경우(형제 — 실측 3명)
 *   · 1인 보드(`(과목)이름`)인데 보드의 이름이 연결된 학생의 이름과 다른 경우
 * 어긋난 연락은 종전대로 출결 알림을 켠 계정에게만 간다(담당 강사가 틀린 이름을 보고 출결을 찍지 않게).
 *
 * 🔴 여기 실패는 원문 저장·기존 벨을 막지 않는다(삼키고 로그) — 그때 그 연락은 종전대로 출결 알림을 켠 계정에게만 간다.
 */
import { BOARD_GROUPS } from "./classnote-admin-core.mjs";

/** 접두사 없는 보드(그룹반)의 과목 묶음 — 이 학원에서 접두사 없이 쓰는 보드는 수학 반 보드(0302a에 등록)와 영어 그룹반뿐이다. */
const UNPREFIXED_GROUP = BOARD_GROUPS.english;

/**
 * 글이 올라온 보드의 과목 키 묶음.
 * @param {string} className 보드 이름
 * @param {number|string|null} cls 보드 번호
 * @param {Set<number>} mathClassBoards 수학 반 보드 번호(0302a)
 */
export function boardSubjectKeys(className, cls, mathClassBoards) {
  const name = String(className ?? "");
  for (const g of Object.values(BOARD_GROUPS)) if (name.startsWith(g.prefix)) return g.subjectKeys;
  if (cls != null && cls !== "" && mathClassBoards.has(Number(cls))) return BOARD_GROUPS.math.subjectKeys;
  return UNPREFIXED_GROUP.subjectKeys;
}

const squash = (v) => String(v ?? "").split(/[ \t\r\n]+/).join("");

/**
 * 원아 링크로 정한 학생을 믿어도 되나 — 반 보드 판정과 어긋난 원아가 아니고, 1인 보드면 보드의 이름이 그 학생 이름과 같을 때만.
 * @param {{className?:string|null, childId?:number|string|null}} item
 * @param {{ conflicted:Set<number>, effectiveName:string }} ctx effectiveName = 연결된 학생의 ClassNote 이름(없으면 이름)
 */
export function crossStudentConfirmed(item, { conflicted, effectiveName }) {
  if (conflicted.has(Number(item?.childId))) return false;
  const name = String(item?.className ?? "");
  const group = Object.values(BOARD_GROUPS).find((g) => name.startsWith(g.prefix));
  if (!group) return true; // 그룹반·반 보드 — 보드 이름에 학생이 없다(원아 id가 유일한 근거)
  return !!effectiveName && squash(name) === squash(`${group.prefix}${effectiveName}`);
}

/** 운영 중인 반의 과목 전부에서 `own`을 뺀 나머지. */
export function otherSubjectKeys(allSubjects, own) {
  const skip = new Set(own);
  return [...new Set(allSubjects)].filter((s) => s && !skip.has(s));
}

async function loadMathClassBoards(sql, tenant) {
  try {
    const rows = await sql`
      select b.board_id from classnote_class_boards b
      join classes c on c.id = b.class_id and c.tenant_id = b.tenant_id
      where b.tenant_id = ${tenant} and c.subject in ${sql(BOARD_GROUPS.math.subjectKeys)}`;
    return new Set(rows.map((r) => Number(r.board_id)));
  } catch (e) {
    if (e?.code === "42P01") return new Set(); // 반 보드 표가 없는 DB — 접두사로만 가른다
    throw e;
  }
}

/** 반 보드 판정(확정)과 원아 링크가 서로 다른 학생을 가리키는 원아 — 어느 쪽이 맞는지 모르니 이 원아의 연락은 다른 과목 담당에게 보내지 않는다. */
async function loadConflictedChildren(sql, tenant) {
  try {
    const rows = await sql`
      select distinct m.child_id from classnote_class_board_members m
      join classnote_child_links l on l.tenant_id = m.tenant_id and l.child_id = m.child_id
      where m.tenant_id = ${tenant} and m.status = 'ok' and m.child_id is not null and l.student_id <> m.student_id`;
    return new Set(rows.map((r) => Number(r.child_id)));
  } catch (e) {
    if (e?.code === "42P01") return new Set();
    throw e;
  }
}

/**
 * 원문 저장 항목마다 `crossTeacherIds`(다른 과목 지금 담당의 계정 id 목록)를 붙인다. 항목을 **제자리에서** 고친다.
 * @param {Array<{childId?:number|null, cls?:number|null, className?:string|null, crossTeacherIds?:string[]}>} items
 * @param {Map<number,string>} childToStudent 원아 id → 학생 id
 * @param {{ recipientsFor: Function, log?: Function }} deps recipientsFor = 피드 코어의 수신자 계산(재검증·상한·담임 폴백 포함)
 */
export async function attachCrossTeachers(sql, tenant, items, childToStudent, { recipientsFor, log = console.log }) {
  try {
    const withStudent = [];
    for (const it of items ?? []) {
      const childId = Number(it?.childId);
      const studentId = Number.isFinite(childId) ? childToStudent.get(childId) : null;
      if (studentId) withStudent.push({ it, studentId });
    }
    if (!withStudent.length) return;
    const [mathClassBoards, subjectRows, conflicted, nameRows] = await Promise.all([
      loadMathClassBoards(sql, tenant),
      sql`select distinct subject from classes where tenant_id = ${tenant} and is_active`,
      loadConflictedChildren(sql, tenant),
      sql`select id, name, classnote_name from students where tenant_id = ${tenant} and id = any(${[...new Set(withStudent.map((w) => w.studentId))]})`,
    ]);
    const allSubjects = subjectRows.map((r) => r.subject);
    const effectiveName = new Map(nameRows.map((r) => [r.id, String(r.classnote_name || r.name || "").trim()]));
    // 보드 과목 묶음별로 한 번씩만 계산한다(대부분 한 폴에 한두 건).
    const byGroup = new Map();
    for (const w of withStudent) {
      if (!crossStudentConfirmed(w.it, { conflicted, effectiveName: effectiveName.get(w.studentId) ?? "" })) {
        log(`[출결] 다른 과목 담당에게는 알리지 않음 — 원아 연결과 보드가 어긋남(${w.it.className ?? "보드 이름 없음"})`);
        continue;
      }
      const own = boardSubjectKeys(w.it.className, w.it.cls, mathClassBoards);
      const key = [...own].sort().join(",");
      if (!byGroup.has(key)) byGroup.set(key, { own, list: [] });
      byGroup.get(key).list.push(w);
    }
    for (const { own, list } of byGroup.values()) {
      const keys = otherSubjectKeys(allSubjects, own);
      if (!keys.length) continue;
      const rec = await recipientsFor(sql, tenant, [...new Set(list.map((w) => w.studentId))], keys, log);
      for (const w of list) {
        const ids = rec.byStudent.get(w.studentId)?.ids ?? [];
        if (ids.length) w.it.crossTeacherIds = [...new Set(ids)];
      }
    }
  } catch (e) {
    log(`[출결] ⚠️ 다른 과목 담당 선생님 계산 실패 — 이번 연락은 출결 알림을 켠 계정에게만 갑니다: ${String(e?.message ?? e).slice(0, 200)}`);
  }
}
