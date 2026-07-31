// 데이터베이스(서식 저장소) 목록 정렬 — 순수(Vitest). ⚠️ server-only 금지(페이지·헤더가 공용) [[#61]].
//
// ⚠️ **서버 페이지네이션 목록이라 정렬도 서버에서** 한다(50건씩 끊겨 오므로 화면 정렬은 "보고 있는 50건
// 안에서만" 정렬되고 사용자는 전체가 정렬된 줄 안다 — 화면이 사실과 다른 말을 하게 된다).
// 수업보고서 목록의 `reportOrderSpecs`와 같은 규약이며, 3단 순환(오름→내림→해제)은 `lib/table/sort`가 단일 소스.
//
// ⚠️ 트레이드오프(기록): 서버 정렬이라 한글 순서는 **Postgres 콜레이션**(en_US.UTF-8)을 따른다 —
//    브라우저 `localeCompare("ko")`와 로마자·한글 혼재에서 갈린다("New 인재원 이력서"가 "직원 이력서"보다
//    앞). 순 한글끼리는 일치(2026-07-21 실측). 페이지네이션이 있는 한 이 쪽이 유일하게 정직한 선택이다.

type OrderSpec = { column: string; ascending: boolean; nullsFirst: boolean };

/**
 * 정렬 가능한 열. **표시 라벨과 정렬 기준이 같은 열만 연다.**
 * · `name`=title · `size`=file_size · `date`=created_at · `uploader`=등록자(to-one 임베드)
 *
 * 🔴 '분류'·'유형'은 일부러 안 연다:
 *   · 분류는 저장값이 내부 키(`hr`·`cat_7`)라 헤더는 한글인데 로마자 키 순으로 줄 선다(수업보고서 '과목'과
 *     같은 이유). 게다가 왼쪽 폴더가 이미 분류 필터라 실익도 없다. 열려면 `document_categories.sort_order`
 *     기준으로 정렬할 설계(FK+임베드)가 먼저다.
 *   · 유형은 DB 컬럼이 아니라 kind+확장자+form_type+링크 호스트로 **화면에서 만드는 라벨**이라 정렬할 값 자체가 없다.
 */
export const DOCUMENT_SORT_KEYS = ["name", "size", "date", "uploader"] as const;
export type DocumentSortKey = (typeof DOCUMENT_SORT_KEYS)[number];

export type DocumentSort = { key: DocumentSortKey; dir: "asc" | "desc" } | null;

export function isDocumentSortKey(v: string): v is DocumentSortKey {
  return (DOCUMENT_SORT_KEYS as readonly string[]).includes(v);
}

/** URL 파라미터(`?sort=name&dir=desc`) → 정렬 상태. 알 수 없는 값은 정렬 없음(기본 순서). */
export function parseDocumentSort(sortRaw?: string, dirRaw?: string): DocumentSort {
  const key = (sortRaw ?? "").trim();
  if (!isDocumentSortKey(key)) return null;
  return { key, dir: dirRaw === "desc" ? "desc" : "asc" };
}

/**
 * 정렬 상태 → PostgREST `.order()` 목록.
 *
 * ⚠️ 마지막은 **유일값(id)** 이어야 페이징이 결정적이다 — 이관분은 한 배치의 created_at이 밀리초까지 같아
 *    id 없이는 동률 행이 50건을 넘을 때 페이지마다 순서가 달라져 같은 문서가 두 번 보이거나 통째로 누락된다.
 *
 * ⚠️ 정렬을 누르면 **고정(pinned) 우선을 뗀다.** 붙여두면 '이름' 정렬인데 고정된 'ㅎ' 문서가 'ㄱ' 위에 남아
 *    정렬이 고장난 것처럼 보인다. 고정은 기본 순서(정렬 해제)에서만 위로 — 해제가 3단 순환에 있는 이유다.
 */
export function documentOrderSpecs(sort: DocumentSort): OrderSpec[] {
  // 동률 tiebreak — 값이 같은 행끼리도 페이지마다 순서가 고정되도록.
  const tiebreak: OrderSpec[] = [
    { column: "created_at", ascending: false, nullsFirst: false },
    { column: "id", ascending: false, nullsFirst: false },
  ];
  if (!sort) {
    // 기본: 고정(자주 쓰는 서식) 먼저 → 최신순.
    return [{ column: "pinned", ascending: false, nullsFirst: false }, ...tiebreak];
  }
  const asc = sort.dir === "asc";
  switch (sort.key) {
    case "name":
      return [{ column: "title", ascending: asc, nullsFirst: false }, ...tiebreak];
    case "size":
      // 파일이 아닌 문서(작성 문서·폼·링크)는 크기가 없다 → 방향과 무관하게 뒤로(`lib/table/sort` 규약 ①).
      return [{ column: "file_size", ascending: asc, nullsFirst: false }, ...tiebreak];
    case "uploader":
      // **to-one 임베드 정렬** — PostgREST `order=uploader(display_name)`는 부모 행을 조인 컬럼으로 줄 세운다.
      // ⚠️ 임베드 **별칭**(`uploader:uploaded_by(...)`)을 써야 한다 — 테이블명 `users(display_name)`은
      //    "not an embedded resource"로 거부된다(2026-07-31 실측).
      // ⚠️ `.order(col, { referencedTable })`와 다르다 — 그건 임베드 배열 내부만 정렬하고 부모 순서는 그대로다.
      return [{ column: "uploader(display_name)", ascending: asc, nullsFirst: false }, ...tiebreak];
    case "date":
      // created_at이 정렬 열 자신이라 tiebreak에서 중복 제거(id만 남긴다).
      return [{ column: "created_at", ascending: asc, nullsFirst: false }, tiebreak[1]!];
  }
}
