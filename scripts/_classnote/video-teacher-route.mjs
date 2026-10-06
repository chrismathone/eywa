import postgres from "postgres";
import { BOARD_GROUPS } from "./classnote-admin-core.mjs";
import { resolveTenant } from "./classnote-core.mjs";
import { loadCommentedReport } from "./video-report-link.mjs";

const unique = (items) => [...new Set(items.filter(Boolean))];

/**
 * JJ 반인가 — 반 이름에 `JJ`가 든 개별 진도 반(예 "중등M 개별 JJ2K" · "초등M 초5 JJ1A" · "중등M 중2 JJPS").
 * 원장 2026-10-01 *"JJ 반을 제외한 해당 학생의 에이와와 매칭되는 담임 이름으로 업로드"* — 수학 수강생 191명 중 127명이 수학 반을
 * 둘 이상 다니는데 대부분 "정규반 + JJ 반"이다(JJ를 빼면 107명이 반 하나로 좁혀진다). 1인 보드 글에는 어느 반 숙제인지 없어서,
 * JJ를 빼지 않으면 그 학생들의 영상이 전부 "반이 여러 개"로 보류됐다.
 */
export const isJjClass = (className) => /JJ/.test(String(className ?? ""));

/**
 * 이름으로 학생을 추측하지 않는다. 게시 반 우선, 1인 보드는 기존 과목 매핑 사용.
 *
 * `report` — 그 영상이 **댓글로 달린 글의 보고서**(`video-report-link.mjs`가 DB로 확인한 `{ classId, homeworkDate }`, 원장 2026-10-06).
 *  · 그 보고서의 반이 곧 게시 반이다(1인 보드 글이라 반을 못 가르던 학생도 반이 정해진다 — JJ 제외 규칙보다 앞선다).
 *  · 반이 그 보고서의 반으로 정해졌을 때만 `homeworkDate`를 싣는다 → 영상 제출 현황이 그 숙제 칸에만 붙인다.
 *  · 🔴 학생이 **영상을 올린 날 그 반을 다니고 있지 않으면** 보고서를 쓰지 않는다(반을 옮긴 뒤 옛 글에 올린 영상 — 예전 판정 그대로).
 *    `classes`는 `loadVideoTeacher`가 영상 게시일(`postedAt`) 기준으로 읽은 수강 반이다 — 처리하는 날이 아니다.
 */
export function chooseVideoTeacher(input) {
  const classes = input.classes ?? [];
  const reportClassId = input.report?.classId && classes.some((c) => c.class_id === input.report.classId) ? input.report.classId : null;
  const route = chooseTeacher({ ...input, classes, reportClassId });
  return reportClassId && route.classId === reportClassId ? { ...route, homeworkDate: input.report.homeworkDate } : route;
}

function chooseTeacher({ video, tenantId, studentIds, boardClassIds, classes, student = null, reportClassId = null }) {
  const studentId = unique(studentIds).length === 1 ? studentIds[0] : null;
  const identity = { studentName: student?.name ?? null, school: student?.school ?? null, grade: student?.grade ?? null,
    classId: null, className: null };
  let subject = null;
  const hold = (reason) => ({ tenantId, studentId, subject, ...identity, teacherId: null, folderName: "담임 확인 필요", reason });
  if (unique(studentIds).length !== 1) return hold("학생 연결이 없거나 서로 충돌합니다.");
  const linked = reportClassId ? [reportClassId] : unique(boardClassIds);
  if (linked.length > 1) return hold("게시 반 연결이 여러 개입니다.");
  let matched;
  if (linked.length === 1) matched = classes.filter((c) => c.class_id === linked[0]);
  else {
    const group = Object.values(BOARD_GROUPS).find((g) => video.boardName?.startsWith(g.prefix))
      ?? (/^\[EIE\]\s*/i.test(video.boardName ?? "") ? BOARD_GROUPS.english : null);
    // EIE는 기존 영어 보드 규약. 과목 내 담임이 하나일 때만 사용하고 임의 그룹반 이름은 추측하지 않는다.
    if (!group) return hold("게시 반의 aywa 연결을 확인해야 합니다.");
    matched = classes.filter((c) => group.subjectKeys.includes(c.subject));
    // JJ 반은 담임 판정에서 뺀다 — 단 그 과목에 JJ 반뿐이면 그 반을 쓴다. 반 보드에 올라온 글(위 linked)은 그 반 그대로다.
    const regular = matched.filter((c) => !isJjClass(c.class_name));
    if (regular.length) matched = regular;
  }
  if (!matched.length) return hold("게시 반·과목에 현재 수강 중인 반이 없습니다.");
  const subjects = unique(matched.map((c) => c.subject));
  subject = subjects.length === 1 ? subjects[0] : null;
  // 반이 하나일 때만 반 이름을 쓴다(여러 개면 추측하지 않는다 — 파일명은 '반미정'). 보류(hold)도 올라가기는 한다:
  // 원장 2026-10-01 *"보류되는 건은 그냥 반 없이 올려 … 어차피 수집하는데 의미가 있기 때문 … 반_미정으로 업로드"*.
  const single = unique(matched.map((c) => c.class_id)).length === 1;
  if (single) {
    identity.classId = matched[0].class_id;
    identity.className = matched[0].class_name ?? null;
  }
  const several = "에이와 반 연결이 여러 개여서 반 이름을 확정할 수 없습니다.";
  if (matched.some((c) => !c.teacher_id || c.teacher_status !== "active" || !c.teacher_name?.trim()))
    return hold(single ? "현재 담임이 미지정이거나 비활성 상태입니다." : several);
  const teachers = unique(matched.map((c) => c.teacher_id));
  if (teachers.length !== 1) return hold(single ? "해당 반·과목의 담임이 여러 명입니다." : several);
  const teacher = matched[0];
  const suffix = Number(teacher.same_name_count) > 1 ? ` (${teacher.teacher_id.slice(0, 8)})` : "";
  // 반은 여러 개여도 담임이 한 사람이면 그 담임 폴더로 보낸다(반 이름만 비운다).
  return { tenantId, studentId, subject, ...identity, teacherId: teacher.teacher_id, folderName: `${teacher.teacher_name.trim()} 선생님${suffix}`,
    reason: !single ? "담임이 같은 반이 여러 개 — 반 이름 없이 담임 폴더"
      : reportClassId ? "보고서 글에 올린 영상 — 그 보고서 반의 현재 담임" : linked.length ? "게시 반의 현재 담임" : "게시 과목의 현재 담임" };
}

/** DB는 SELECT만. 모든 조인은 지점으로 제한한다. DB 오류를 미분류로 숨기지 않는다. */
export async function resolveVideoTeacher(video) {
  if (!process.env.DATABASE_URL) throw new Error("담임 자동 분류에는 DATABASE_URL 설정이 필요합니다.");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    const tenantId = await resolveTenant(sql);
    return await loadVideoTeacher(sql, tenantId, video);
  } finally { await sql.end(); }
}

export async function loadVideoTeacher(sql, tenantId, video) {
    if (!/^[1-9]\d*$/.test(video.childId ?? ""))
      return chooseVideoTeacher({ video, tenantId, studentIds: [], boardClassIds: [], classes: [] });
    const boardId = /^[1-9]\d*$/.test(video.boardId ?? "") ? video.boardId : null;
    const [links, boards] = await Promise.all([
      sql`select student_id from classnote_child_links where tenant_id = ${tenantId} and child_id = ${video.childId}
        union select student_id from classnote_class_board_members
          where tenant_id = ${tenantId} and board_id = ${boardId} and child_id = ${video.childId} and status = 'ok'
        union select student_id from classnote_student_links
          where tenant_id = ${tenantId} and board_id = ${boardId} and child_id = ${video.childId}`,
      sql`select class_id from classnote_class_boards where tenant_id = ${tenantId} and board_id = ${boardId}`,
    ]);
    const studentIds = unique(links.map((r) => r.student_id));
    const boardClassIds = boards.map((r) => r.class_id);
    let classes = [];
    let student = null;
    if (studentIds.length === 1) {
      const at = new Date(video.postedAt || Date.now());
      const today = at.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      [student] = await sql`select name, school, grade from students where tenant_id=${tenantId} and id=${studentIds[0]}`;
      classes = await sql`select c.id as class_id, c.class_name, c.subject, c.teacher_id,
          u.display_name as teacher_name, u.status as teacher_status,
          (select count(*) from users names where names.tenant_id = ${tenantId}
            and names.status = 'active' and names.display_name = u.display_name) as same_name_count
        from enrollments e
        join students s on s.id = e.student_id and s.tenant_id = ${tenantId}
        join classes c on c.id = e.class_id and c.tenant_id = ${tenantId}
        left join users u on u.id = c.teacher_id and u.tenant_id = ${tenantId}
        where e.tenant_id = ${tenantId} and e.student_id = ${studentIds[0]} and not coalesce(e.on_hold, false)
          and (e.start_date is null or e.start_date <= ${today}) and (e.end_date is null or e.end_date >= ${today})
          and (c.closed_at is null or c.closed_at >= ${today})`;
    }
    // 보고서 글에 댓글로 올린 영상이면 그 보고서(이 학생 · 영상 과제 있음)를 확인한다 — 아니면 null(예전 판정).
    const report = studentIds.length === 1 ? await loadCommentedReport(sql, tenantId, video, studentIds[0]) : null;
    return chooseVideoTeacher({ video, tenantId, studentIds, boardClassIds, classes, student, report });
}
