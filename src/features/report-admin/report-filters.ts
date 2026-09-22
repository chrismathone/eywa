/**
 * 보고서 목록 필터 — 타입 + 상수(순수, 클라·서버 공용). "use server"(actions.ts)에서 비-async 값을
 * export할 수 없어(런타임 상수 IMPORT_FILTER) 여기로 분리. 5단계-2 Part C.
 */
import type { MentSource } from "@/features/onescreen/ment-source";

export type ReportListRow = {
  id: string;
  studentName: string;
  subject: string | null;
  /**
   * 반 이름(0134a `class_id` → `classes.class_name` 임베드). **내부 표시 전용** — 학부모 화면엔 반이 나오지 않는다(0134a).
   * ⚠️ 대부분 null이다: class_id는 0134a(2026-07-22) 이후 **aywa가 직접 쓴 보고서**에만 붙고, edutrix 이관분은
   * `subject`가 전부 NULL이라 반 추정(resolveReportClassId)이 구조적으로 불가하다(실측 2026-07: 1,520건 중 71건).
   * 그래서 목록은 없으면 "—"로 두고, 반 정렬 시 null을 뒤로 보낸다(반 있는 건이 위로 모임).
   */
  className: string | null;
  reportDate: string;
  /**
   * 실제 수업일(covers_date, 0136a) — 미리/몰아서 한 수업의 보고서를 그 수업일에 귀속시킨다.
   * 효과는 **분모 면제**: 그 (학생, 날짜)는 작성률 대상에서 빠진다(보고서 집계는 reportDate 그대로).
   * ⚠️ 내부 메타데이터 — 학부모 발송 페이로드에 넣지 않는다.
   */
  coversDate: string | null;
  /** covers_date 감사(0139a) — 누가·언제·왜 면제를 걸었는지. 지표를 빼주는 값이라 화면에 근거를 보여준다. */
  coversBy: string | null; // 지정자 이름(표시용)
  coversAt: string | null;
  coversNote: string | null;
  createdAt: string | null; // 작성/이관 등록 시각(timestamptz) — 정렬 최종 tiebreak(이관분은 cron 배치 시각으로 동일)
  sentAt: string | null; // 실제 학부모 발송 시각(classnote_sent_at) — 목록 hh:mm 표시 + 같은 날짜 내 최신 발송 정렬 키. 없으면 createdAt 폴백
  classnoteStatus: string | null;
  teacherName: string | null;
  shareToken: string | null;
  source: string | null; // edutrix_import=이관분(발송 아님) · onescreen=aywa 네이티브
  /**
   * 학부모 읽음 시각(classnote_read_at, 0122a — 연동 PC 워커가 ClassNote 피드에서 동기화).
   * ⚠️ null = "안 읽음"이 **아니다** — 매칭 키(edutrix_share_token) 없는 행은 동기화 자체가 안 된다.
   * 그래서 UI는 **양성 배지("읽음")만** 표시하고 "미읽음"은 표시하지 않는다(거짓 미확인 방지, 4단계에서 재론).
   */
  readAt: string | null;
  /**
   * 멘트 작성 방식(0214a) — auto/auto_edited/manual, null=도입 전·미상. 0214a 미적용이면 select에서
   * 빠져 undefined(목록은 그대로 동작 — 열 자체를 mentSourceReady로 숨긴다). 라벨은 ment-source.ts 단일 소스.
   */
  mentSource?: string | null;
};

export type ReportListFilters = {
  from?: string;
  to?: string;
  status?: string;
  /** 강사 **정확 일치**(뷰 설정 드롭다운 — 옵션은 최근 60일 보고서에서 뽑는다). */
  teacher?: string;
  /**
   * 담임 이름 **부분검색**(목록 툴바 입력칸). `teacher`(드롭다운 정확일치)와 **따로 둔다** —
   * 드롭다운까지 부분일치로 바꾸면 "김은정"을 골랐는데 "김은수"가 함께 걸린다.
   * 이름은 `lesson_reports.teacher_name` 컬럼에 그대로 있어 조인 없이 ilike 한 줄이면 된다
   * (학생 이름과 달리 id 해석이 필요 없다 = `.in()` 상한 문제도 없다).
   */
  teacherName?: string;
  subject?: string;
  /**
   * 학생 이름 부분검색(회수 탭의 주 진입점 — "주준호 건 회수"처럼 **이름으로 먼저 찾는다**).
   * 이름 → student_id 해석 후 `.in()`으로 거른다. 너무 넓은 검색어는 서버가 상한을 알리고 좁히길 요구한다
   * (거대 `.in()`은 URL 414로 조용히 실패하므로 — B3/[[#53]]).
   */
  student?: string;
  /**
   * 반 필터(0134a class_id). 옵션 목록은 0147a RPC가 **최근 창에 실제 보고서가 붙은 반만** 준다
   * (반 149개 전체를 띄우면 대부분 0건이라 못 쓴다). 반이 없는 이관분은 이 필터를 걸면 당연히 빠진다.
   */
  classId?: string;
  /**
   * 읽음 필터. "read"=읽음 기록 있음. "unread"=**판정 가능한 미읽음만** —
   * 발송 성공(success) + 매칭 키 있음(edutrix분은 edutrix_share_token 필요, native분은 항상 매칭 가능)
   * + 읽음 기록 없음. 매칭 키 없는 옛 이관분은 동기화 자체가 안 되므로 "안읽음"에 안 섞는다(거짓 미확인 방지).
   */
  read?: "read" | "unread";
  /**
   * 멘트 작성 방식 필터(0214a) — 강사 필터와 조합하면 "그 선생님이 직접 쓴 멘트만"이 된다(말투 코퍼스 검수).
   * 도입 후 저장분에만 라벨이 있다 — 옛 보고서는 어떤 값으로도 안 걸린다(뷰 설정이 문구로 안내).
   */
  mentSource?: MentSource;
  page?: number;
  /** 헤더 클릭 정렬. 없으면 기본 정렬(수업일 최신 → 발송시각 → 등록시각). */
  sort?: ReportSortKey;
  dir?: "asc" | "desc";
};

/**
 * 서버 정렬 가능한 열 — lesson_reports 컬럼 + **to-one 임베드 1개(반 이름)**.
 * ⚠️ '학생'과 '과목'을 일부러 뺐다: 학생 이름은 이 표에 없는 값(students 조인)이고, 과목은 저장값이
 * 내부 키(`math`)라 그대로 정렬하면 화면의 한글 라벨(수학·영어) 순서와 어긋난다 — 헤더는 한글로
 * 보여 주면서 로마자 키 순으로 줄 세우면 "정렬이 이상하다"가 된다. 둘 다 별도 설계 후에 연다.
 *
 * ⚠️ '반'만 예외로 연 이유(2026-07-24 원장 요청): 학생 이름과 달리 **PostgREST가 to-one 임베드 컬럼으로
 * 부모를 정렬**해 준다(`order=classes(class_name)`) — 실측으로 확인했다. 반 이름은 저장값 자체가 한글
 * 표시명이라 과목 같은 라벨 불일치도 없다. 즉 학생·과목을 막았던 두 이유가 반에는 해당하지 않는다.
 */
export const REPORT_SORT_KEYS = ["date", "teacher", "status", "read", "class"] as const;
export type ReportSortKey = (typeof REPORT_SORT_KEYS)[number];

type OrderSpec = { column: string; ascending: boolean; nullsFirst: boolean };

/**
 * 정렬 상태 → PostgREST `.order()` 목록(순수, Vitest). 목록이 **서버 페이지네이션**이라 정렬도 서버에서
 * 해야 한다 — 화면에서 정렬하면 "보고 있는 30건 안에서만" 정렬되고 사용자는 전체가 정렬된 줄 안다.
 *
 * 규약 두 가지:
 *  ① 빈 값은 방향과 무관하게 **뒤로**(`nullsFirst:false`) — 화면 정렬 규약(`lib/table/sort`)과 같게.
 *  ② 마지막에 항상 `report_date`·`created_at` tiebreak — 동률이 페이지마다 뒤바뀌면 페이지를 넘길 때
 *     같은 행이 두 번 보이거나 사라진다(서버 페이징의 고전적 함정).
 *
 * ⚠️ 한글 정렬은 DB 콜레이션이 한다(브라우저 `localeCompare("ko")` 아님). 강사 이름처럼 **순 한글**은
 * 유니코드 한글 음절 블록이 가나다 순이라 결과가 같지만, 로마자·한글이 섞이면 순서가 갈린다
 * (PG=로마자 먼저 / ICU ko=한글 먼저). 그래서 이 목록은 **한 화면 안에서 서버 정렬만** 쓴다.
 */
export function reportOrderSpecs(sort?: ReportSortKey, dir: "asc" | "desc" = "asc"): OrderSpec[] {
  const asc = dir === "asc";
  // ⚠️ 마지막은 **유일값(id)** 이어야 페이징이 결정적이다. 이관분은 한 INSERT 배치의 created_at이
  // 밀리초까지 동일해, id가 없으면 같은 날짜·같은 시각 행이 30건을 넘을 때 페이지마다 순서가 달라져
  // 같은 보고서가 두 번 보이거나 통째로 건너뛰어진다(적대 검증 확정).
  const tiebreak: OrderSpec[] = [
    { column: "report_date", ascending: false, nullsFirst: false },
    { column: "created_at", ascending: false, nullsFirst: false },
    { column: "id", ascending: false, nullsFirst: false },
  ];
  switch (sort) {
    case "date":
      return [{ column: "report_date", ascending: asc, nullsFirst: false }, tiebreak[1]!, tiebreak[2]!];
    case "teacher":
      return [{ column: "teacher_name", ascending: asc, nullsFirst: false }, ...tiebreak];
    case "status":
      return [{ column: "classnote_status", ascending: asc, nullsFirst: false }, ...tiebreak];
    case "read":
      return [{ column: "classnote_read_at", ascending: asc, nullsFirst: false }, ...tiebreak];
    case "class":
      // ⚠️ **to-one 임베드 정렬** — PostgREST의 `order=classes(class_name)`(부모를 조인 컬럼으로 줄 세운다).
      // supabase-js의 `.order(col)`은 col 문자열을 그대로 붙이므로 이 형태가 그대로 나가고, 괄호는 URL
      // 인코딩(%28/%29)돼도 서버가 디코드한다(2026-07-24 실측: raw·인코딩 둘 다 HTTP 200 + 정렬 정확).
      // ⚠️ `.order(col, { referencedTable: "classes" })`와 **다르다** — 그건 임베드된 행을 정렬할 뿐
      //    부모 순서를 바꾸지 않는다. 반드시 이 합성 컬럼 형태를 쓸 것.
      // 반 없는 행(이관분 대다수)은 규약 ①대로 방향과 무관하게 뒤로 → 반 있는 건이 위로 모인다.
      return [{ column: "classes(class_name)", ascending: asc, nullsFirst: false }, ...tiebreak];
    default:
      // 기본: 같은 수업일 내 최신 발송이 위로. 이관분은 created_at이 cron 배치 시각으로 전부 같아
      // 실제 발송시각(classnote_sent_at)을 먼저 본다.
      return [
        { column: "report_date", ascending: false, nullsFirst: false },
        { column: "classnote_sent_at", ascending: false, nullsFirst: false },
        { column: "created_at", ascending: false, nullsFirst: false },
        { column: "id", ascending: false, nullsFirst: false },
      ];
  }
}

// 상태 필터 특수값: 발송 이력 없는 이관분(edutrix_import). classnote_status가 아니라 source로 거른다.
export const IMPORT_FILTER = "__import__";

/**
 * 상태 필터 특수값: **미발송**(저장만 하고 발송 이력이 없는 native 보고서) = `classnote_status IS NULL`.
 *
 * 🔴 `.eq("classnote_status", …)`로는 표현할 수 없어(NULL은 등호로 안 잡힌다) 별도 값이 필요하다.
 *    이게 없으면 "미발송 N건"이라는 알림·카드에서 목록으로 넘어와도 **그 N건만 골라 볼 방법이 없다**
 *    (이번 달 전체를 눈으로 훑어야 했다 — 원장 제보 2026-09-09의 절반이 그것이다).
 * ⚠️ 이관분(edutrix_import)은 제외한다 — 그쪽은 Edutrix가 이미 학부모에게 보낸 것이라 '미발송'이 아니다.
 */
export const UNSENT_FILTER = "__unsent__";

/**
 * 목록 기본 조회 범위 = **이번 달**(원장 지시 2026-07-21).
 *
 * ⚠️ 왜 전체 기간이 기본이면 안 되는가(실측): lesson_reports 17,346행에 2년치가 섞여 있어 '강사' 열로
 * 정렬하면 **1페이지 30줄이 전부 권나현/2026-05-06~07**이고 최근 30일 건은 0건이었다. 정렬을 눌러도
 * 쓸 수 있는 화면이 안 나온다 — 범위를 달로 끊어야 "이 달 안에서 강사순"이라는 **의미 있는 정렬**이 된다.
 * (성능은 부차적 효과: 전체 기간 12.0ms → 한 달 2.6ms.)
 *
 * 서버 첫 페인트(page.tsx)와 클라 초기 state가 **같은 함수**를 써야 첫 화면이 어긋나지 않는다.
 */
export function defaultReportFilters(todayYmd: string, status?: string): ReportListFilters {
  const month = todayYmd.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  // 주소로 받은 상태(`?status=…`)는 **첫 페인트와 클라 초기 state가 같은 값**을 써야 한다 —
  // 한쪽만 반영하면 열자마자 목록이 한 번 바뀐다(기간 기본값이 그래서 여기 있다).
  return { page: 0, from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}`, status: status || undefined };
}

/**
 * 뷰 설정 트리거에 띄울 **걸린 필터 개수**(순수, Vitest).
 *
 * ⚠️ 왜 필요한가: 필터를 팝오버 안으로 넣으면 **걸려 있는지가 화면에서 사라진다** — 시간표 뷰 설정이
 * "필터가 걸린 동안엔 트리거에 항상 배지"를 타협 불가 규칙으로 둔 것과 같은 이유다(조용히 걸린 필터가
 * "왜 안 보이지"를 만든다).
 *
 * ⚠️ **기간은 세지 않는다**(2026-07-24 적대검수로 수정). 배지의 뜻은 "화면에 안 보이는 필터가 걸렸다"인데,
 * 기간은 팝오버 **밖** 월 이동 칩에 "2026년 6월"/"전체 기간"/"직접 지정"으로 **항상 그대로 보인다**.
 * 기간을 세면 지난달을 볼 때마다 배지가 상시 점등돼, 팝오버를 열어도 강사·과목·상태·읽음이 전부 '전체'라
 * 원인을 못 찾고, 배지를 끄려 '초기화'하면 보려던 달까지 되돌아간다 = 진짜 숨은 필터와 구분이 사라진다.
 * ⚠️ 정렬(sort/dir)도 세지 않는다 — 줄 세우기는 **무엇이 보이는지**를 바꾸지 않고, 표 헤더 화살표로 드러난다.
 */
export function activeReportFilterCount(f: ReportListFilters): number {
  let n = 0;
  if (f.teacher) n++;
  if (f.subject) n++;
  if (f.status) n++;
  if (f.read) n++;
  if (f.classId) n++;
  if (f.mentSource) n++;
  return n;
}

/**
 * 관리자 최초 발송 가능 행 — **미발송(발송 이력 없음)** + 이관분 아님. 목록 체크박스 활성 판정용(순수).
 * 서버 액션(sendClassnoteForUnsent)의 하드필터와 동일 조건 — 이미 발송·큐잉된 행(queued/processing/
 * success/failed/…)은 여기서도 서버에서도 거부라 **중복발송이 구조적으로 불가**(재발송은 큐 카드의 별도 버튼).
 * 취소(revoked)·과목 게이트·too_old는 목록 행에 정보가 없어 서버에서만 걸러진다(제외 건수로 안내).
 */
export function isAdminSendable(row: Pick<ReportListRow, "classnoteStatus" | "source">): boolean {
  return !row.classnoteStatus && row.source !== "edutrix_import";
}
