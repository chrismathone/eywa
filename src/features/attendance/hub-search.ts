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
import { matchesStudentSearch, normalizeSearchText } from "./student-search";

/** 한 번에 보여줄 결과 상한 — 넘으면 "앞 N건"이라고 **밝힌다**(잘라놓고 전부인 척 금지, [[#89]]). */
export const HUB_SEARCH_LIMIT = 20;

/** 검색어 길이 상한 — URL·쿼리로 흘러가는 값이라 여기서 자른다(표시도 이 길이를 넘지 않는다). */
export const HUB_SEARCH_MAX_QUERY = 40;

/** 결과 한 줄이 열 반 — 호출부가 **스코프를 적용한 뒤** 넘긴다. */
export type HubSearchClass = {
  id: string;
  className: string;
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
};

/** 화면에 그리는 결과 한 줄 — `이름 · 학교/학년 · 반 이름 · 담당 강사`. */
export type HubSearchHit = {
  studentId: string;
  studentName: string;
  /** "경명여중1" 압축 표기(schoolGradeLabel) — 없으면 빈 문자열. */
  schoolGrade: string;
  classId: string;
  className: string;
  teacherName: string | null;
  /** 이 줄이 열 강사 출석부. null이면 호출부가 **반별** 링크로 떨어뜨린다. */
  linkTeacherId: string | null;
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

/** 결과 정렬 — 이름(가나다) → 반 이름. 한 학생이 여러 반이면 나란히 선다. */
export function sortHubHits<T extends { studentName: string; className: string }>(hits: T[]): T[] {
  return [...hits].sort(
    (a, b) =>
      a.studentName.localeCompare(b.studentName, "ko") || a.className.localeCompare(b.className, "ko"),
  );
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
      teacherName: klass.teacherName,
      linkTeacherId: hubLinkTeacherId(klass, input.viewerTeacherId ?? null),
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
