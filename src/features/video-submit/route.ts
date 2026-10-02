/**
 * 제출 링크 영상의 **담임 폴더·파일 이름·보고서 줄** 판정(순수) — 서버·테스트 공용.
 *
 * 🔑 워커 자동 업로드와 **한 벌**이다: 파일 이름은 워커 모듈 [`videoFilename`](../../../scripts/_classnote/video-filename.mjs)을
 *    그대로 부르고, 담임 판정은 워커 `chooseVideoTeacher`의 "게시 반이 하나로 정해진 경우"와 같은 규칙을 옮겼다
 *    (같은 결과는 `route.test.ts`가 워커 함수와 나란히 돌려 잠근다 — 둘이 갈라지면 테스트가 깨진다).
 */
import { videoFilename } from "../../../scripts/_classnote/video-filename.mjs";
import { isVideoHomeworkEnabled, type VideoHomeworkPolicy } from "@/features/video-homework/policy";

/** 워커 `loadVideoTeacher`가 읽는 반 한 줄과 같은 모양(snake_case 그대로 — 나란히 비교한다). */
export type VideoClassRow = {
  class_id: string;
  class_name: string | null;
  subject: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
  teacher_status: string | null;
  same_name_count: number;
};
export type VideoStudent = { id: string; name: string | null; school: string | null; grade: string | null };

export type LinkVideoRoute = {
  tenantId: string;
  studentId: string;
  subject: string | null;
  studentName: string | null;
  school: string | null;
  grade: string | null;
  classId: string;
  className: string | null;
  teacherId: string | null;
  folderName: string;
  reason: string;
  rootId: string;
};

export const LINK_ROUTE_REASON = "제출 링크";
/** 워커와 같은 폴더 이름 — 담임을 못 정하면 이 폴더로(반 이름은 그대로 남긴다). */
export const UNASSIGNED_FOLDER = "담임 확인 필요";

/** 링크는 반을 안다 — 그 반의 지금 담임 폴더. 담임이 없거나 퇴사·이름 없음이면 '담임 확인 필요'(워커와 같다). */
export function linkVideoRoute(input: { tenantId: string; rootId: string; student: VideoStudent; klass: VideoClassRow }): LinkVideoRoute {
  const { tenantId, rootId, student, klass } = input;
  const base = {
    tenantId, studentId: student.id, subject: klass.subject ?? null,
    studentName: student.name ?? null, school: student.school ?? null, grade: student.grade ?? null,
    classId: klass.class_id, className: klass.class_name ?? null, rootId,
  };
  if (!klass.teacher_id || klass.teacher_status !== "active" || !klass.teacher_name?.trim())
    return { ...base, teacherId: null, folderName: UNASSIGNED_FOLDER, reason: `${LINK_ROUTE_REASON} — 현재 담임이 미지정이거나 비활성 상태입니다.` };
  const suffix = Number(klass.same_name_count) > 1 ? ` (${klass.teacher_id.slice(0, 8)})` : "";
  return { ...base, teacherId: klass.teacher_id, folderName: `${klass.teacher_name.trim()} 선생님${suffix}`, reason: LINK_ROUTE_REASON };
}

/** 워커 폴더 등록부(0315a `classnote_video_folders.route_key`)와 같은 열쇠 — 같은 담임이면 워커가 쓰는 그 폴더에 들어간다. */
export const teacherFolderKey = (route: Pick<LinkVideoRoute, "tenantId" | "teacherId">, centerId: string): string =>
  `${route.tenantId}:${centerId}:${route.teacherId ?? "unassigned"}`;

/**
 * Drive 표시 이름 — 워커와 같은 `학생_반_학교학년_날짜` + 그 영상의 확장자. 날짜 = 올리기 시작한 시각의 한국 날짜.
 * (워커는 ClassNote가 주는 mp4만 다뤄 `.mp4`로 짓는다 — 링크는 폰 원본(.mov 등)이라 확장자만 갈아 끼운다.)
 */
export function linkVideoFilename(route: LinkVideoRoute, startedAt: Date, ext: string): string {
  const name = videoFilename({ postedAt: startedAt.toISOString() }, route) as string;
  const safeExt = /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : ".mp4";
  return name.replace(/\.mp4$/, safeExt);
}

/**
 * 수업보고서 글에 '영상 제출' 줄을 붙이나 — **한 함수**(나중에 "모든 보고서"로 넓힐 땐 여기만 바꾼다).
 * 원장 2026-10-01 *"영상 제출 링크를 함께 붙이자"* · 기본 범위: 그 보고서가 '영상 과제 있음'(0308a `video_homework = true`)이고
 * 그 반이 영상 숙제 검사 대상(학원 설정 `videoHomeworkPolicy`)일 때만. 영어(템플릿 모드 — `/r`과 같은 판정)·취소된 보고서·반 없는 보고서는 아니다.
 *
 * 원장 2026-10-02 *"체크하면 '영상 첨부 링크 넣기' 토글이 하나 더 생기는걸로"* — 강사가 그 행에서 **링크 넣기를 켰을 때만**
 * (0328a `video_submit_link = true`). 고르지 않았거나(null) 끈(false) 보고서엔 붙지 않는다.
 * `"no_column"` = 그 칸이 아직 없다(SQL 적용 전, #95) → 고를 길이 없으니 10-01 규칙 그대로(영상 과제 있음이면 붙임).
 */
export function reportGetsVideoLink(input: {
  videoHomework: boolean | null | undefined;
  submitLink: boolean | null | "no_column";
  reportSubject: string | null | undefined;
  revoked: boolean;
  classId: string | null | undefined;
  classSubject: string | null | undefined;
  grade: string | null | undefined;
  policy: VideoHomeworkPolicy;
}): boolean {
  if (input.videoHomework !== true || input.revoked || !input.classId || !input.classSubject) return false;
  if (input.submitLink !== "no_column" && input.submitLink !== true) return false;
  if (input.reportSubject === "english") return false;
  return isVideoHomeworkEnabled(input.policy, { classId: input.classId, subjectKey: input.classSubject, grade: input.grade });
}
