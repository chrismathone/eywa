/** 독립 배포 워커용. 학교·학년 표기는 앱의 schoolGradeLabel과 동일하다. */
export function videoSchoolGrade(school, grade) {
  const s = String(school ?? "").trim();
  const g = String(grade ?? "").trim();
  if (!s || !g) return s || g || "학교학년미등록";
  if (/^[3-7]\s*세$/.test(g) || /^(미취학|유치)/.test(g)) return s.includes(g) ? s : `${s} ${g}`;
  return s + (g.match(/\d+/)?.[0] ?? g);
}

const part = (value) => String(value).normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f_]/g, " ")
  .replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 80);

/** 반을 하나로 못 정한 영상의 반 자리 — 파일명 구분자(`_`)를 넣지 않는다. */
export const UNKNOWN_CLASS = "반미정";

/**
 * 표시 이름만 바꾼다. 중복 판정은 별도의 원본 ID·해시를 계속 사용한다.
 * 🔑 반이나 학생을 못 정해도 이름은 지어 준다(원장 2026-10-01 *"반_미정으로 업로드시켜 … 수집하는데 의미가 있기 때문"*) —
 *    예전엔 여기서 던져서 그 영상이 15분마다 재시도만 하고 Drive에 올라가지 못했다. 반 자리 = `반미정`,
 *    학생 연결이 없으면 학생 자리 = `미연결 <ClassNote 보드 이름>`. 없는 값을 지어내지는 않는다.
 */
export function videoFilename(video, route) {
  const date = new Date(video.postedAt ?? "");
  if (!Number.isFinite(date.getTime())) throw new Error("클래스노트 원본 업로드 날짜가 없습니다.");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const linked = !!route.studentId && !!route.studentName?.trim();
  const who = linked ? route.studentName : `미연결 ${video.boardName ?? ""}`;
  const klass = route.classId && route.className?.trim() ? route.className : UNKNOWN_CLASS;
  const parts = [who, klass, videoSchoolGrade(linked ? route.school : null, linked ? route.grade : null), day].map(part);
  if (parts.some((p) => !p)) throw new Error("파일 이름에 사용할 에이와 정보를 확인하세요.");
  return `${parts.join("_")}.mp4`;
}
