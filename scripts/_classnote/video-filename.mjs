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

/** 표시 이름만 바꾼다. 중복 판정은 별도의 원본 ID·해시를 계속 사용한다. */
export function videoFilename(video, route) {
  if (!route.studentId || !route.studentName?.trim() || !route.classId || !route.className?.trim())
    throw new Error("에이와 학생·반 연결을 확인해야 파일 이름을 정할 수 있습니다.");
  const date = new Date(video.postedAt ?? "");
  if (!Number.isFinite(date.getTime())) throw new Error("클래스노트 원본 업로드 날짜가 없습니다.");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const parts = [route.studentName, route.className, videoSchoolGrade(route.school, route.grade), day].map(part);
  if (parts.some((p) => !p)) throw new Error("파일 이름에 사용할 에이와 정보를 확인하세요.");
  return `${parts.join("_")}.mp4`;
}
