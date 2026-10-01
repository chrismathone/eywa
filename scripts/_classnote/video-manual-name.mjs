import { filenamePart, UNKNOWN_CLASS, videoSchoolGrade } from "./video-filename.mjs";

/**
 * 담임 폴더에 **사람이 직접 올린** 숙제 영상의 파일 이름을 읽어 학생·반을 정한다 — 순수 함수(Vitest).
 *
 * 원장 2026-10-01 *"따로 클래스노트에 업로드가 힘들어서 개별로 드라이브에 제출하는 경우에도 매핑 … 양식은 클래스노트 자동 업로드와 맞출 예정"*.
 * 양식 = 자동 업로드와 같은 `학생_반_학교학년_날짜.확장자`(video-filename `videoFilename`). 사람이 친 이름이라 앞뒤 공백·전각 밑줄·
 * 날짜 모양(`2026-10-01`·`20261001`·`2026.10.01`)·복사본 꼬리표(` (1)`) 정도만 너그럽게 읽고, 그 이상은 추측하지 않는다.
 *
 * 🔴 학생은 **이름 + 학교학년이 같은 한 명**일 때만. 둘 이상이면 그 날짜에 수강 기록이 있는 한 명으로만 좁힌다(퇴원한 옛 동명이인과
 *    지금 학생을 가르는 유일한 근거). 그래도 여럿이거나 없으면 '확인 필요' — 이름만으로 고르지 않는다.
 * 🔴 반은 그 학생이 **그 날짜에** 다닌 반 중 이름이 같은 **하나**일 때만. 반 칸을 적었는데 못 찾으면 반 없이 넣지 않고 '확인 필요' —
 *    적은 반을 조용히 버리면 장부(반으로 분류된 영상만 센다)에서 그 영상이 소리 없이 빠진다.
 */

const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "avi", "mkv", "webm", "3gp", "3g2", "wmv", "mts", "m2ts", "mpg", "mpeg", "hevc"];
const EXTENSION = new RegExp(`\\.(${VIDEO_EXTENSIONS.join("|")})$`, "i");

/**
 * 이 날짜 이전에 만들어진 파일은 양식을 못 읽으면 조용히 넘긴다(확인 필요 목록에 올리지 않는다).
 * 2026-10-01 실측: `허주연 선생님` 폴더에 9/17~9/21에 손으로 올린 18개가 `반 이름.mp4` 꼴로 있다 — 양식이 생기기 전 파일이라
 * 목록을 영구히 차지하게 두지 않는다. 이름을 양식대로 고치면 그때부터는 날짜와 무관하게 읽는다.
 */
export const MANUAL_NAME_SINCE = "2026-10-01T00:00:00+09:00";

/** 비교용 열쇠 — 자동 이름과 같은 칸 정규화 뒤 공백·대소문자만 무시한다(`칠성초 3` = `칠성초3`, `lt4` = `LT4`). */
export const matchKey = (value) => filenamePart(value ?? "").replace(/\s+/g, "").toLowerCase();

/** 폐지 반 이름 꼬리표 — 종강한 반은 이름을 비켜 둔다(`PJ2` → `PJ2 (~2026-07)`, gotchas #120). */
const withoutRetiredSuffix = (name) => String(name ?? "").replace(/\s*\(~\d{4}-\d{2}\)\s*$/, "");

/** 영상 파일인가 — Drive 바로가기·문서(`application/vnd.google-apps.*`)는 이름이 `.mp4`여도 아니다. */
export function isVideoFile(file) {
  const mime = String(file?.mimeType ?? "");
  if (mime.startsWith("application/vnd.google-apps.")) return false;
  return mime.startsWith("video/") || EXTENSION.test(String(file?.name ?? "").trim());
}

/** `2026-10-01` · `2026.10.01` · `2026. 10. 1.` · `2026/10/01` · `20261001`. 실제 없는 날(2/30)은 거절. */
export function parseLooseDate(raw) {
  const text = String(raw ?? "").trim();
  const m = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?$/.exec(text) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const fail = (reason) => ({ ok: false, reason });

/** 파일 이름 → 네 칸. `today` = KST `YYYY-MM-DD`(오늘 이후 날짜는 오타로 본다). */
export function parseManualVideoName(name, { today }) {
  let base = String(name ?? "").normalize("NFC").trim(); // macOS에서 올린 이름은 자모가 풀린(NFD) 채로 온다
  base = base.replace(EXTENSION, "").replace(/＿/g, "_").replace(/\s*\(\d{1,3}\)$/, "").trim();
  const fields = base.split("_").map((field) => field.trim());
  if (fields.length !== 4 || fields.some((field) => !matchKey(field)))
    return fail("파일 이름이 ‘학생_반_학교학년_날짜’ 네 칸이 아닙니다.");
  const [student, klass, schoolGrade, rawDate] = fields;
  const date = parseLooseDate(rawDate);
  if (!date) return fail("날짜를 읽지 못했습니다(예: 2026-10-01).");
  if (today && date > today) return fail("날짜가 오늘 이후입니다.");
  if (/^미연결(\s|$)/.test(student)) return fail("학생 칸에 에이와 학생 이름이 없습니다(미연결).");
  return { ok: true, student, className: matchKey(klass) === matchKey(UNKNOWN_CLASS) ? null : klass, schoolGrade, date };
}

/** 학생 이름 끝의 동명이인 접미사(A·B·C…)를 뗀 이름 — 앱 `baseNameOf`(src/features/students/name-suffix.ts)와 같은 규칙. */
const baseNameOf = (name) => String(name ?? "").trim().replace(/[A-Z]$/, "");

/**
 * 파일 이름에 맞는 학생 후보(상태 무관) — 이름이 같은 학생 + **접미사만 다른** 학생(`김근우` ↔ `김근우A`, 학교학년 같음).
 * 둘을 함께 돌려주는 이유 = 접미사를 빠뜨린 이름이 원래 이름의 학생에게 조용히 붙지 않게 판정에서 대조하려고(DB 수강도 함께 읽는다).
 */
export function namedStudents(parsed, students) {
  if (!parsed?.ok) return [];
  const who = matchKey(parsed.student);
  const sg = matchKey(parsed.schoolGrade);
  return students.filter((s) => matchKey(videoSchoolGrade(s.school, s.grade)) === sg
    && (matchKey(s.name) === who || matchKey(baseNameOf(s.name)) === who));
}

/**
 * 그 날짜에 실제로 다니던 수강인가 — 앱 `isEnrollmentActiveOn`(src/features/enrollments/eligibility.ts)과 같은 규칙:
 * 휴원 제외 · 반이동으로 끝난 수강은 끝난 날부터 새 반(반열림) · 일반 종료는 종료일 포함 · 종강한 반은 종강일까지(영상 워커 담임 판정과 같다).
 */
const activeOn = (e, date) => !e.on_hold && (!e.start_date || e.start_date <= date)
  && !(e.end_date && (e.is_transferred ? e.end_date <= date : e.end_date < date)) && (!e.closed_at || e.closed_at >= date);

/**
 * 직접 올린 파일 하나의 판정(같은 내용 중복은 `markDuplicate`가 따로 본다).
 * @param parsed parseManualVideoName 결과
 * @param students namedStudents 결과(또는 지점 전체 — 여기서 다시 거른다). `{ id, name, school, grade, status, enrolled_at, withdrawn_at }`
 * @param enrollments 후보 학생들의 수강 `{ student_id, class_id, start_date, end_date, is_transferred, on_hold, closed_at, class_name, subject, teacher_id }`
 *   (날짜는 `YYYY-MM-DD` 문자열)
 * @param folder `{ teacherId, unregistered? }` — 파일이 놓인 폴더(사람이 고른 자리 = 의도). '담임 확인 필요'·등록되지 않은 폴더면 teacherId null.
 */
export function decideManualVideo({ parsed, students, enrollments, folder }) {
  const review = (reason, extra = {}) => ({ status: "review", studentId: null, studentName: null, school: null, grade: null,
    classId: null, className: null, subject: null, teacherId: null, reason, ...extra });
  if (!parsed?.ok) return review(parsed?.reason ?? "파일 이름을 읽지 못했습니다.");
  const pool = namedStudents(parsed, students);
  const who = matchKey(parsed.student);
  const exact = pool.filter((s) => matchKey(s.name) === who);
  const suffixed = pool.filter((s) => matchKey(s.name) !== who); // 접미사만 다른 학생(`김근우A`)
  if (!exact.length) return review(suffixed.length
    ? "에이와 이름과 다릅니다 — 동명이인 접미사(A·B)까지 적어 주세요." : "에이와에 같은 이름·학교학년 학생이 없습니다.");
  const onDate = (student) => enrollments.filter((e) => e.student_id === student.id && activeOn(e, parsed.date));
  // 그 날짜에 학원생이었나 — 그날 수강, 또는 (퇴원 처리로 수강 기록이 지워졌어도) 등록일~퇴원일 안. 퇴원생이 아니면 학원생으로 본다.
  const member = (s) => s.status !== "withdrawn" || onDate(s).length > 0
    || (!!s.withdrawn_at && parsed.date <= s.withdrawn_at && (!s.enrolled_at || s.enrolled_at <= parsed.date));
  let student = exact[0];
  let narrowed = false;
  if (exact.length > 1) {
    const attending = exact.filter((s) => onDate(s).length);
    if (attending.length !== 1) return review("같은 이름·학교학년 학생이 여러 명입니다.");
    [student] = attending;
    narrowed = true;
  }
  // 퇴원 뒤 날짜를 옛 학생에게 붙이면 아직 에이와에 없는 같은 이름 새 학생의 영상을 가로챈다.
  if (!member(student)) return review("퇴원한 학생이고 그 날짜에 학원생이었던 기록이 없습니다.");
  const want = parsed.className ? matchKey(parsed.className) : null;
  const classesOf = (s) => new Map(onDate(s)
    .filter((e) => matchKey(e.class_name) === want || matchKey(withoutRetiredSuffix(e.class_name)) === want)
    .map((e) => [e.class_id, e]));
  // 🔴 접미사만 다른 학생이 그 날짜에 학원생이면, 접미사 없는 이름은 둘 중 누구인지 이름만으로 모른다 — 반으로만 가른다.
  const rivals = suffixed.filter(member);
  if (rivals.length) {
    if (!want) return review("이름이 같은 학생(접미사 A·B 다름)이 또 있어 반까지 적어 주세요.");
    if (rivals.some((s) => classesOf(s).size)) return review("같은 반에 이름이 같은 학생(접미사 A·B 다름)이 있습니다 — 접미사까지 적어 주세요.");
  }
  let klass = null;
  if (want) {
    const matched = classesOf(student);
    if (!matched.size) {
      // 휴원은 날짜 없는 지금 상태라 휴원 전 영상도 여기서 막힌다 — 사유를 사실대로(안전한 쪽으로만 틀린다).
      const paused = enrollments.some((e) => e.student_id === student.id && e.on_hold && activeOn({ ...e, on_hold: false }, parsed.date)
        && (matchKey(e.class_name) === want || matchKey(withoutRetiredSuffix(e.class_name)) === want));
      return review(paused ? "그 반 수강이 지금 휴원 중이라 반을 정하지 않았습니다 — 반미정으로 올리거나 휴원을 풀면 다시 확인합니다."
        : "그 날짜에 이 이름의 반을 다닌 기록이 없습니다(반 이름은 지금 에이와 이름으로).");
    }
    if (matched.size > 1) return review("같은 이름의 반이 여러 개입니다.");
    [klass] = matched.values();
  }
  const teacherId = folder?.teacherId ?? null;
  const notes = [klass ? "파일 이름으로 학생·반 확인" : "파일 이름으로 학생 확인(반미정)"];
  if (narrowed) notes.push("같은 이름 학생 중 그 날짜 수강생");
  if (rivals.length) notes.push("접미사만 다른 학생은 반으로 구분");
  if (folder?.unregistered) notes.push("에이와가 만든 담임 폴더가 아니어서 담임은 기록하지 않음");
  else if (!teacherId) notes.push("담임 확인 필요 폴더");
  else if (klass && klass.teacher_id && klass.teacher_id !== teacherId) notes.push("반 담임과 다른 선생님 폴더 — 올린 폴더 기준");
  return { status: "uploaded", studentId: student.id, studentName: student.name, school: student.school ?? null, grade: student.grade ?? null,
    classId: klass?.class_id ?? null, className: klass?.class_name ?? null, subject: klass?.subject ?? null, teacherId,
    reason: notes.join(" · ") };
}

/** '같은 영상이 이미 있다' 사유 — 워커 늦은 중복 정리 SQL(video-manual-scan)과 같은 문구. */
export const DUPLICATE_REASON = "이미 보관된 같은 영상이 있습니다(따로 세지 않습니다).";

/**
 * 같은 내용(MD5·크기)의 영상이 이미 있으면 이 파일은 세지 않는다 — 단 **같은 학생**이고 그 행이 이미 반까지 정해졌거나
 * 이 파일도 반을 모를 때만. 학생이 다르거나(쌍둥이가 같은 영상) 그 행이 학생·반을 못 정한 ClassNote 수집분이면
 * 이 파일이 더 많이 아는 쪽이라 그대로 센다(장부는 반이 정해진 영상만 세므로 두 번 세지지 않는다).
 * @param sameContent `{ id, student_id, class_id }[]` — 같은 MD5·크기, 확인 필요가 아닌 다른 행(오래된 순)
 */
export function markDuplicate(decision, sameContent) {
  if (decision.status !== "uploaded") return decision;
  const original = sameContent.find((row) => row.student_id === decision.studentId && (row.class_id != null || decision.classId == null));
  if (!original) return decision;
  return { status: "review", studentId: null, studentName: null, school: null, grade: null, classId: null, className: null,
    subject: null, teacherId: null, reason: DUPLICATE_REASON, duplicateOf: original.id };
}

/** 영상 게시 시각 — 파일 이름엔 날짜뿐이라 KST 정오로 둔다(UTC로 잘라 읽어도 같은 날짜로 남는다). */
export const manualPostedAt = (date) => `${date}T12:00:00+09:00`;
