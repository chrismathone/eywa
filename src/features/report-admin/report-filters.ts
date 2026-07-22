/**
 * 보고서 목록 필터 — 타입 + 상수(순수, 클라·서버 공용). "use server"(actions.ts)에서 비-async 값을
 * export할 수 없어(런타임 상수 IMPORT_FILTER) 여기로 분리. 5단계-2 Part C.
 */

export type ReportListRow = {
  id: string;
  studentName: string;
  subject: string | null;
  reportDate: string;
  /**
   * 실제 수업일(covers_date, 0135a) — 미리/몰아서 한 수업의 보고서를 그 수업일에 귀속시킨다.
   * 효과는 **분모 면제**: 그 (학생, 날짜)는 작성률 대상에서 빠진다(보고서 집계는 reportDate 그대로).
   * ⚠️ 내부 메타데이터 — 학부모 발송 페이로드에 넣지 않는다.
   */
  coversDate: string | null;
  createdAt: string | null; // 작성/이관 등록 시각(timestamptz) — 정렬 최종 tiebreak(이관분은 cron 배치 시각으로 동일)
  sentAt: string | null; // 실제 학부모 발송 시각(classnote_sent_at) — 목록 hh:mm 표시 + 같은 날짜 내 최신 발송 정렬 키. 없으면 createdAt 폴백
  classnoteStatus: string | null;
  teacherName: string | null;
  shareToken: string | null;
  source: string | null; // edutrix_import=이관분(발송 아님) · onescreen=eywa 네이티브
  /**
   * 학부모 읽음 시각(classnote_read_at, 0122a — 연동 PC 워커가 ClassNote 피드에서 동기화).
   * ⚠️ null = "안 읽음"이 **아니다** — 매칭 키(edutrix_share_token) 없는 행은 동기화 자체가 안 된다.
   * 그래서 UI는 **양성 배지("읽음")만** 표시하고 "미읽음"은 표시하지 않는다(거짓 미확인 방지, 4단계에서 재론).
   */
  readAt: string | null;
};

export type ReportListFilters = {
  from?: string;
  to?: string;
  status?: string;
  teacher?: string;
  subject?: string;
  /**
   * 읽음 필터. "read"=읽음 기록 있음. "unread"=**판정 가능한 미읽음만** —
   * 발송 성공(success) + 매칭 키 있음(edutrix분은 edutrix_share_token 필요, native분은 항상 매칭 가능)
   * + 읽음 기록 없음. 매칭 키 없는 옛 이관분은 동기화 자체가 안 되므로 "안읽음"에 안 섞는다(거짓 미확인 방지).
   */
  read?: "read" | "unread";
  page?: number;
  /** 헤더 클릭 정렬. 없으면 기본 정렬(수업일 최신 → 발송시각 → 등록시각). */
  sort?: ReportSortKey;
  dir?: "asc" | "desc";
};

/**
 * 서버 정렬 가능한 열 — **lesson_reports에 실제로 있는 컬럼만.**
 * ⚠️ '학생'과 '과목'을 일부러 뺐다: 학생 이름은 이 표에 없는 값(students 조인)이고, 과목은 저장값이
 * 내부 키(`math`)라 그대로 정렬하면 화면의 한글 라벨(수학·영어) 순서와 어긋난다 — 헤더는 한글로
 * 보여 주면서 로마자 키 순으로 줄 세우면 "정렬이 이상하다"가 된다. 둘 다 별도 설계 후에 연다.
 */
export const REPORT_SORT_KEYS = ["date", "teacher", "status", "read"] as const;
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
 * 목록 기본 조회 범위 = **이번 달**(원장 지시 2026-07-21).
 *
 * ⚠️ 왜 전체 기간이 기본이면 안 되는가(실측): lesson_reports 17,346행에 2년치가 섞여 있어 '강사' 열로
 * 정렬하면 **1페이지 30줄이 전부 권나현/2026-05-06~07**이고 최근 30일 건은 0건이었다. 정렬을 눌러도
 * 쓸 수 있는 화면이 안 나온다 — 범위를 달로 끊어야 "이 달 안에서 강사순"이라는 **의미 있는 정렬**이 된다.
 * (성능은 부차적 효과: 전체 기간 12.0ms → 한 달 2.6ms.)
 *
 * 서버 첫 페인트(page.tsx)와 클라 초기 state가 **같은 함수**를 써야 첫 화면이 어긋나지 않는다.
 */
export function defaultReportFilters(todayYmd: string): ReportListFilters {
  const month = todayYmd.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { page: 0, from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
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
