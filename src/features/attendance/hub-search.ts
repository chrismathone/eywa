/**
 * 출석부 **진입 허브**의 학생 검색 — 판정·조립 순수 함수(Vitest).
 *
 * 원장 제보 2026-08-20: *"오늘의 출결에는 정상적으로 학생 검색이 들어갔는데, 월별 출석부에는 없네"* →
 * *"해당 선생님으로 진입해야 있네"* → *"진입하기 전에도 검색가능하도록 해주고, 검색한 채로 선생님
 * 출석부에 진입하면 [그 학생 줄만 남은 화면]이 되도록"*.
 *
 * 🔑 시트 안 검색([`search-context.tsx`](<../../app/(shell)/attendance/_components/search-context.tsx>))과
 *    **역할이 다르다**: 저건 이미 그려진 행을 좁히는 클라 필터고, 이건 "이 학생이 누구 반이지"를 푸는
 *    **진입 전 조회**다. 그래서 서버를 한 번 다녀오되, 이름 비교는 **같은 정규화**를 쓴다
 *    ([`student-search.ts`](./student-search.ts)) — 두 화면이 다른 규칙으로 찾으면 검색이 복불복이 된다.
 * 🔴 **권한 범위는 여기서 새로 정하지 않는다.** 이 모듈은 호출부가 넘긴 `classes`(= 이미 스코프가
 *    적용된 반 목록) 밖의 수강을 **버린다**. 강사(scoped)는 자기가 가르치는 반만 넘어오므로 남의 반
 *    학생은 구조적으로 결과에 못 든다([[#77]] — 화면 조건이 아니라 데이터가 잘려야 게이트다).
 * ⚠️ 결과에 싣는 값은 **화면이 그리는 것만**(이름·학교/학년·반·담당). 연락처·주소는 페이로드에 없다.
 */
import { formatDows, resolveAttendDows } from "./calendar";
import { matchesStudentSearch, normalizeSearchText } from "./student-search";

/** 한 번에 보여줄 결과 상한 — 넘으면 "앞 N건"이라고 **밝힌다**(잘라놓고 전부인 척 금지, [[#89]]). */
export const HUB_SEARCH_LIMIT = 20;

/** 검색어 길이 상한 — URL·쿼리로 흘러가는 값이라 여기서 자른다(표시도 이 길이를 넘지 않는다). */
export const HUB_SEARCH_MAX_QUERY = 40;

/** 결과 한 줄이 열 반 — 호출부가 **스코프를 적용한 뒤** 넘긴다. */
export type HubSearchClass = {
  id: string;
  className: string;
  /**
   * 과목 **내부 키**(`classes.subject`) — 그룹 머리글을 만들 재료.
   * 🔴 이 모듈은 키만 다룬다. 한글 라벨은 **학원설정이 단일 소스**라 화면이 `useSubjectMaps().labelOf`로
   *    만든다(여기에 라벨 맵을 만들면 그게 곧 "운영 enum 하드코딩"이다).
   */
  subject: string;
  /** 반 담임(`classes.teacher_id`). 자리(LAB·JJ)처럼 담임이 없는 반은 null. */
  teacherId: string | null;
  teacherName: string | null;
};

/** 조회가 돌려준 수강 한 줄(그 달과 겹치는 것만). */
export type HubSearchEnrollment = {
  classId: string;
  studentId: string;
  studentName: string;
  school: string | null;
  grade: string | null;
  /**
   * 분리등원(`enrollments.attendance_days`) — 비어 있으면 **반 운영 요일 전부**라는 뜻.
   * ⚠️ 선택 필드다(조회가 안 실어도 동작한다 = 라벨만 빈다).
   */
  attendanceDays?: readonly (string | null)[] | null;
};

/** 화면에 그리는 결과 한 줄 — `이름 · 학교/학년 · 반 이름 · 담당 강사`. */
export type HubSearchHit = {
  studentId: string;
  studentName: string;
  /** "경명여중1" 압축 표기(schoolGradeLabel) — 없으면 빈 문자열. */
  schoolGrade: string;
  classId: string;
  className: string;
  /** 과목 내부 키 — 화면이 이 값으로 묶고(`groupHitsBySubject`) 라벨은 학원설정에서 뽑는다. */
  subject: string;
  teacherName: string | null;
  /** 이 줄이 열 강사 출석부. null이면 호출부가 **반별** 링크로 떨어뜨린다. */
  linkTeacherId: string | null;
  /**
   * 그 학생이 **그 반에 실제로 오는 요일**("월·목") — 알 수 없으면 빈 문자열(호출부가 안 그린다).
   *
   * 🔴 반 운영 요일이 아니라 **학생별** 등원 요일이다(분리등원 704건 중 83건). 월별 출석부 시트가
   *    이름 아래에 그리는 값과 **같은 단일 소스**(`resolveAttendDows`+`formatDows`)로 만든다 —
   *    같은 화면에서 두 값이 다르면 그게 곧 버그다.
   */
  attendLabel: string;
};

/**
 * 검색 한 번의 결과 — 서버(조회)와 화면(그리기)이 함께 쓰는 모양.
 * ⚠️ **순수 모듈에 둔다** — 클라 컴포넌트가 `server-only` 모듈에서 타입을 끌어오면 import 한 줄만
 *    잘못 써도 빌드가 깨진다([[#61]]). 값이 아니라 모양이라 여기가 제자리다.
 */
export type HubSearchResult = {
  hits: HubSearchHit[];
  /** 상한에 걸렸나 — 화면이 "앞 N건만" 문구를 띄운다. */
  truncated: boolean;
  limit: number;
  /** 0건 문구가 말할 **찾은 범위**("8월 담당 반" / "8월 출석부"). 권한 이야기는 하지 않는다. */
  where: string;
  /** 조회가 실패했을 때만(한글) — 목록이 조용히 비지 않게. */
  error?: string;
};

/**
 * 대조에 쓰는 **정리된 검색어** — DB(`ilike`)와 화면(JS 재판정)이 **같은 문자열**을 본다.
 *
 * 🔴 `%`·`_`·`*`·`\`는 **와일드카드라 지운다** — 사용자가 친 글자가 조용히 "아무거나"가 되면 엉뚱한
 *    학생이 상한을 채우고 정작 찾는 아이가 밀린다. 🔴 지운 결과를 **양쪽이 함께** 써야 한다: DB만
 *    지우면 "DB는 찾았는데 JS가 버려서 '없습니다'"가 된다.
 * ⚠️ 공백은 [`normalizeSearchText`](./student-search.ts)가 지운다(시트 검색과 같은 규칙 — 새 정규화 금지).
 *    그래서 DB 이름 자체에 공백이 있는 학생은 안 걸릴 수 있다(알려진 한계 — 정규화 컬럼이 없다).
 */
export function hubSearchTerm(query: string): string {
  return normalizeSearchText(query.slice(0, HUB_SEARCH_MAX_QUERY)).replace(/[%_*\\]/g, "");
}

/**
 * 수강을 "지금 듣고 있나"로 판정할 **기준일** — 원장 2026-08-24: *"지나간 수업은 검색할 필요 없음.
 * 현재 수강중인 수업만 검색되어야함"*(최하림 검색에 8/4에 끝난 반 2개가 섞여 5줄이 뜬 화면).
 *
 * 🔑 종전 조건은 "그 달과 **겹치는** 수강"이라 8/4 종료도 8월과 겹쳐서 통과했다. 이제는 기준일 하루로
 *    좁혀 학생 상세의 세 칸(수강 중 / 배정 예정 / 지난 수업)과 **같은 뜻**이 되게 한다.
 * ⚠️ 기준일은 오늘이되 **보고 있는 달 안으로 접는다** — 지난 달을 열어 검색할 때 오늘로 재면 그때
 *    다니던 반이 통째로 사라진다(그 달엔 '지난 수업'이 아니었다). 그래서 지난 달은 그 달 말일,
 *    다음 달은 그 달 1일이 기준이 된다.
 */
export function hubEnrollmentAsOf(today: string, from: string, to: string): string {
  if (today < from) return from;
  if (today > to) return to;
  return today;
}

/** DB에 넘길 `ilike` 패턴 — 검색어가 비었으면 null(조회 자체를 하지 않는다). */
export function hubSearchPattern(query: string): string | null {
  const term = hubSearchTerm(query);
  return term.length > 0 ? `%${term}%` : null;
}

/**
 * 이 줄이 열 출석부의 주인 — **보는 사람이 강사면 언제나 자기 출석부**.
 *
 * 🔴 강사에게 담임(남) id로 링크를 걸면 그 사람 시트가 **자기 담당 반 중 그 담임이 가르치는 반**으로만
 *    잘려 열린다(교시를 나눠 맡는 영어에서 특히). 강사는 애초에 남의 강사 시트를 볼 수 없으므로,
 *    강사 스코프에서는 목적지를 자기 시트로 고정하고 `q`가 그 학생 줄만 남긴다.
 */
export function hubLinkTeacherId(
  klass: Pick<HubSearchClass, "teacherId">,
  viewerTeacherId: string | null,
): string | null {
  return viewerTeacherId ?? klass.teacherId;
}

/**
 * 등원요일 라벨의 **요일 수** — 정렬 1차 키. 빈 라벨(그 달 슬롯 0)은 0이라 **맨 뒤**로 간다.
 * ⚠️ 라벨을 그대로 세는 이유 = 화면에 보이는 것과 정렬 근거가 **같은 값**이어야 하기 때문
 *    (요일 배열을 따로 실어 나르면 둘이 갈릴 자리가 하나 더 생긴다).
 */
export function attendDowCount(attendLabel: string | undefined | null): number {
  return (attendLabel ?? "")
    .split("·")
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/**
 * 결과 정렬 — **요일 많은 수업 → 적은 수업**(원장 2026-08-24), 그다음 이름(가나다) → 반 이름.
 *
 * 🔴 요일 수가 1차인 이유: 한 학생이 여러 반이면 이름·학교·담임이 전부 같아 보여서, 사람이 줄을 고르는
 *    실제 단서가 요일뿐이다. 주 3일 정규 반이 주 1일 개별 반보다 먼저 서야 눈이 덜 헤맨다.
 * ⚠️ 2·3차(이름·반 이름)를 빼지 말 것 — 요일 수가 같은 줄이 흔해서(JJ2L·JJ2N 둘 다 '수') 안 그러면
 *    같은 검색이 매번 다른 순서로 그려진다.
 */
export function sortHubHits<T extends { studentName: string; className: string; attendLabel?: string }>(
  hits: readonly T[],
): T[] {
  return [...hits].sort(
    (a, b) =>
      attendDowCount(b.attendLabel) - attendDowCount(a.attendLabel) ||
      a.studentName.localeCompare(b.studentName, "ko") ||
      a.className.localeCompare(b.className, "ko"),
  );
}

/**
 * 과목별로 묶는다 — 머리글 + 구분선의 재료(원장 2026-08-24 *"과목 라벨을 붙이라는 소리임"*).
 *
 * 🔴 **순서는 인자로 받는다**(`order` = 학원설정 과목 순서). 이 모듈은 서버·클라 공용 순수 모듈이라
 *    설정을 직접 읽으면 안 되고, 코드에 과목 순서를 적으면 그게 곧 "운영 enum 하드코딩"이다.
 * ⚠️ 설정에 없는 과목 키는 **맨 뒤**로 보내되 사라지지 않게 한다(폐기된 키의 반이 조용히 증발하면
 *    "검색이 학생을 못 찾는다"가 된다). 그들끼리는 **처음 나온 순서**를 지킨다.
 * ⚠️ 그룹 안 순서는 건드리지 않는다 — 이미 `sortHubHits`가 정한 순서다.
 */
export function groupHitsBySubject<T extends { subject: string }>(
  hits: readonly T[],
  order: readonly string[],
): { subject: string; hits: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const h of hits) {
    const list = groups.get(h.subject);
    if (list) list.push(h);
    else groups.set(h.subject, [h]);
  }
  const rank = new Map(order.map((s, i) => [s, i]));
  return [...groups.entries()]
    .map(([subject, list], i) => ({ subject, hits: list, at: rank.get(subject) ?? order.length + i }))
    .sort((a, b) => a.at - b.at)
    .map(({ subject, hits: list }) => ({ subject, hits: list }));
}

/** 그룹이 미등록 과목일 때 쓰는 표시 이름 — raw 키가 화면에 새지 않게(#raw 코드 노출 금지). */
export const HUB_SUBJECT_FALLBACK = "기타";

/**
 * 그룹 머리글 문자열 — 라벨은 **학원설정이 단일 소스**라 `labelOf`를 인자로 받는다.
 * 🔴 `labelOf`가 키를 **그대로** 돌려주면(설정·레거시 어디에도 없는 키) 화면에 `subject_3`가 뜬다 →
 *    그럴 땐 `기타`. 과목 키는 전부 ascii라(`math`·`subject_1`) "라벨 == 키"는 곧 미등록이라는 뜻이다.
 */
export function hubSubjectHeading(subject: string, labelOf: (key: string) => string): string {
  const key = (subject ?? "").trim();
  if (!key) return HUB_SUBJECT_FALLBACK;
  const label = (labelOf(key) ?? "").trim();
  return !label || label === key ? HUB_SUBJECT_FALLBACK : label;
}

/**
 * 조회 결과 → 화면 줄. **스코프 밖 반은 버리고**, 같은 (반·학생)은 한 줄로 합치고, 상한으로 자른다.
 *
 * `more`는 조회가 **상한을 채웠는지**(더 있을 수 있는지)다 — 청크 조회는 청크마다 상한을 걸어서,
 * 합친 뒤 길이만 보면 "더 있는데 없다"고 말할 수 있다.
 */
export function buildHubHits(input: {
  query: string;
  enrollments: readonly HubSearchEnrollment[];
  /** 🔴 **이미 스코프가 적용된** 반들 — 여기 없는 반의 수강은 결과에서 사라진다(권한 이중 방어). */
  classes: readonly HubSearchClass[];
  /** 그 반 라벨을 만들 때 쓰는 압축 표기 함수(schoolGradeLabel) — 서버·테스트가 같은 것을 넘긴다. */
  schoolGradeOf: (school: string | null, grade: string | null) => string;
  /**
   * 반 id → 그 달에 **살아있는** 수업요일. 안 넘기면 등원요일 라벨만 빈다(결과는 그대로).
   * 🔴 넘기는 쪽이 **만료된 배치를 걸러서** 준다([[#88]] — `class_schedules`는 운영 이력을 함께 담는다).
   */
  classDows?: ReadonlyMap<string, readonly number[]>;
  viewerTeacherId?: string | null;
  limit?: number;
  more?: boolean;
}): { hits: HubSearchHit[]; truncated: boolean } {
  const limit = input.limit ?? HUB_SEARCH_LIMIT;
  const term = hubSearchTerm(input.query);
  // 🔴 빈 검색어는 **아무것도 안 내놓는다** — 시트 검색("비면 전부 통과")과 뜻이 반대다. 여기서 전부
  //    통과시키면 빈 칸에 학원 전체 명단이 쏟아진다.
  if (!term) return { hits: [], truncated: false };
  const byClass = new Map(input.classes.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const hits: HubSearchHit[] = [];
  for (const e of input.enrollments) {
    const klass = byClass.get(e.classId);
    if (!klass) continue; // 🔴 스코프 밖 — 조회가 새더라도 여기서 잘린다.
    // 최종 이름 판정은 시트 검색과 **같은 함수**(공백·대소문자 무시) + DB와 **같은 정리된 검색어**.
    if (!matchesStudentSearch(term, [e.studentName])) continue;
    const key = `${e.classId}|${e.studentId}`;
    if (seen.has(key)) continue; // 같은 반 재등록(수강 행 2개)은 한 줄.
    seen.add(key);
    hits.push({
      studentId: e.studentId,
      studentName: e.studentName,
      schoolGrade: input.schoolGradeOf(e.school, e.grade),
      classId: klass.id,
      className: klass.className,
      subject: klass.subject,
      teacherName: klass.teacherName,
      linkTeacherId: hubLinkTeacherId(klass, input.viewerTeacherId ?? null),
      // 시트(matrix-row)가 이름 아래에 그리는 것과 **같은 값**. 반 요일을 모르면 빈 문자열이다.
      attendLabel: formatDows(resolveAttendDows(e.attendanceDays, input.classDows?.get(klass.id) ?? [])),
    });
  }
  const sorted = sortHubHits(hits);
  return {
    hits: sorted.slice(0, limit),
    truncated: (input.more ?? false) || sorted.length > limit,
  };
}

/**
 * 0건일 때의 한 줄 — **왜 비었는지**를 사람 말로 밝힌다(빈 목록만 두면 "고장났다"로 읽힌다).
 * ⚠️ 권한 이야기를 하지 않는다 — `where`는 "담당 반"·"이번 달 출석부"처럼 **찾은 범위**만 말한다.
 */
export function hubEmptyMessage(query: string, where: string): string {
  return `‘${query.trim()}’ 이름의 학생을 ${where}에서 찾지 못했습니다.`;
}

/** 상한에 걸렸을 때의 한 줄 — 잘랐다는 사실과 좁히는 방법을 함께 말한다. */
export function hubTruncatedNote(limit: number = HUB_SEARCH_LIMIT): string {
  return `앞 ${limit}건만 표시합니다 — 이름을 더 입력하면 좁혀집니다.`;
}
