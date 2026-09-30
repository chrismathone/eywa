import postgres from "postgres";
import { BOARD_GROUPS } from "./classnote-admin-core.mjs";
import { resolveTenant } from "./classnote-core.mjs";

const unique = (items) => [...new Set(items.filter(Boolean))];

/** 이름으로 학생을 추측하지 않는다. 게시 반 우선, 1인 보드는 기존 과목 매핑 사용. */
export function chooseVideoTeacher({ video, tenantId, studentIds, boardClassIds, classes, student = null }) {
  const studentId = unique(studentIds).length === 1 ? studentIds[0] : null;
  const identity = { studentName: student?.name ?? null, school: student?.school ?? null, grade: student?.grade ?? null,
    classId: null, className: null };
  let subject = null;
  const hold = (reason) => ({ tenantId, studentId, subject, ...identity, teacherId: null, folderName: "담임 확인 필요", reason });
  if (unique(studentIds).length !== 1) return hold("학생 연결이 없거나 서로 충돌합니다.");
  const linked = unique(boardClassIds);
  if (linked.length > 1) return hold("게시 반 연결이 여러 개입니다.");
  let matched;
  if (linked.length === 1) matched = classes.filter((c) => c.class_id === linked[0]);
  else {
    const group = Object.values(BOARD_GROUPS).find((g) => video.boardName?.startsWith(g.prefix))
      ?? (/^\[EIE\]\s*/i.test(video.boardName ?? "") ? BOARD_GROUPS.english : null);
    // EIE는 기존 영어 보드 규약. 과목 내 담임이 하나일 때만 사용하고 임의 그룹반 이름은 추측하지 않는다.
    if (!group) return hold("게시 반의 aywa 연결을 확인해야 합니다.");
    matched = classes.filter((c) => group.subjectKeys.includes(c.subject));
  }
  if (!matched.length) return hold("게시 반·과목에 현재 수강 중인 반이 없습니다.");
  const subjects = unique(matched.map((c) => c.subject));
  subject = subjects.length === 1 ? subjects[0] : null;
  if (unique(matched.map((c) => c.class_id)).length !== 1) return hold("에이와 반 연결이 여러 개여서 반 이름을 확정할 수 없습니다.");
  identity.classId = matched[0].class_id;
  identity.className = matched[0].class_name ?? null;
  if (matched.some((c) => !c.teacher_id || c.teacher_status !== "active" || !c.teacher_name?.trim()))
    return hold("현재 담임이 미지정이거나 비활성 상태입니다.");
  const teachers = unique(matched.map((c) => c.teacher_id));
  if (teachers.length !== 1) return hold("해당 반·과목의 담임이 여러 명입니다.");
  const teacher = matched[0];
  const suffix = Number(teacher.same_name_count) > 1 ? ` (${teacher.teacher_id.slice(0, 8)})` : "";
  return { tenantId, studentId, subject, ...identity, teacherId: teacher.teacher_id, folderName: `${teacher.teacher_name.trim()} 선생님${suffix}`,
    reason: linked.length ? "게시 반의 현재 담임" : "게시 과목의 현재 담임" };
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
    return chooseVideoTeacher({ video, tenantId, studentIds, boardClassIds, classes, student });
}
