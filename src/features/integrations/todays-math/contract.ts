import "server-only";
import { secretMatches } from "@/lib/http/secret-compare";

/**
 * 오늘의수학(testautocreator) 진도 연계 — **계약의 순수 로직**.
 *
 * 소비자: 오늘의수학이 이 두 라우트를 주기적으로 당겨 학생별 확인테스트를 낸다.
 *   GET /api/integrations/todays-math/roster
 *   GET /api/integrations/todays-math/progress?cursor=<token>
 *
 * 계약 SSOT 는 testautocreator 쪽 `docs/planning/tracks/plan-eywa-link.md`.
 * 여기 있는 것은 DB 를 안 만지는 부분 전부다(인증 비교·커서·응답 모양) —
 * aywa 컨벤션대로 순수 로직만 단위 테스트로 잠근다.
 *
 * ## 인증·키
 *
 * `TODAYS_MATH_API_KEY` — 이 연계 전용. CRON_SECRET 재사용 금지(회전이 따로
 * 돌아야 한다). **회전 절차**: 새 키를 양쪽(.env.local / 오늘의수학 Vercel env)에
 * 넣고 재시작 — 소비자가 하나뿐이라 중첩 키 인프라는 두지 않는다.
 * `TODAYS_MATH_TENANT_ID` — 이 키가 주는 데이터의 테넌트. 라우트는 모든 질의의
 * **모든 테이블**에 이 값을 강제한다(admin 클라이언트는 RLS 를 우회하므로
 * 한 조인만 새도 다른 학원 데이터가 나간다).
 *
 * ## 커서 — 왜 keyset 이 아니라 offset 인가
 *
 * 정렬 열에 `created_at`(timestamptz) 이 들어간다. keyset 동률 비교는 마이크로초
 * 직렬화가 한 자리만 어긋나도 행을 조용히 건너뛴다 — 성공적으로 렌더되는 오답과
 * 같은 부류다. 대신 **정렬을 (report_date, created_at, id) ASC 로 고정**하고
 * offset 을 불투명 토큰에 감춘다. 새 보고서는 정렬 끝에 붙으므로(늦게 쓴 과거
 * 날짜 보고서만 중간에 낀다) 스캔 중 표류는 드물고, 소비자는 ⑴ (id,unit) 멱등
 * upsert ⑵ 매일 전량 재실행으로 수렴한다. 토큰이 불투명하므로 나중에 keyset 으로
 * 바꿔도 계약은 안 바뀐다.
 */

/** 페이지 크기 — B2(PostgREST 1000행 절단)보다 확실히 작게. */
export const PROGRESS_PAGE_SIZE = 500;

const CURSOR_PREFIX = "tmv1:";

/** offset → 불투명 커서. */
export function encodeCursor(offset: number): string {
  return Buffer.from(`${CURSOR_PREFIX}${offset}`, "utf8").toString("base64url");
}

/**
 * 불투명 커서 → offset. 못 읽으면 null — 400 으로 이어져야 한다.
 * (조용히 0으로 내려가면 소비자는 «중복 전량»을 받고도 성공으로 읽는다.)
 */
export function decodeCursor(token: string | null): number | null {
  if (token === null || token === "") return 0;
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!decoded.startsWith(CURSOR_PREFIX)) return null;
  const payload = decoded.slice(CURSOR_PREFIX.length);
  // 🔴 `Number("")` 는 0 이다 — 빈 페이로드가 «첫 페이지»로 통과하면 깨진
  //    커서를 받은 소비자가 전량을 중복으로 받고도 성공으로 읽는다. 숫자만 허용.
  if (!/^\d{1,10}$/.test(payload)) return null;
  return Number(payload);
}

/**
 * Bearer 키 검증. 키 미설정이면 **무조건 거부** — env 를 빠뜨린 배포가
 * 문을 열어 두는 fail-open 을 막는다.
 *
 * 라우트는 «키 미설정»(503, 기능 꺼짐)과 «키 불일치»(401)를 **구분해서** 낸다 —
 * 상담 반출(`/api/exports/consultations`) 선례. 같으면 소비자가 «내 키가
 * 틀렸다»와 «아직 배포가 안 됐다»를 못 가른다.
 */
export function isAuthorized(header: string | null, expectedKey: string | undefined): boolean {
  if (!expectedKey) return false;
  return secretMatches(header, `Bearer ${expectedKey}`);
}

/** 로스터 응답의 학생 한 행 — 계약 모양. 연락처·성적·상담·수납은 **없다**. */
export interface RosterStudent {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  status: "enrolled";
  classes: Array<{ id: string; name: string; startDate: string | null }>;
}

export interface RosterResponse {
  generatedAt: string;
  total: number;
  students: RosterStudent[];
}

export interface ProgressRow {
  id: string;
  studentId: string;
  reportDate: string;
  createdAt: string;
  progress: string;
  /**
   * 어느 반 수업의 진도인가 — **nullable.** 0134a(2026 중반)에 생긴 컬럼이라
   * 옛 보고서의 91% 는 null 이다(실측 16,390 중 1,494만 값 있음). 소비자는
   * null 이면 학생의 주반으로 귀속시키고, 값이 있으면 그 반을 쓴다.
   * ⚠️ 이 두 컬럼은 **drizzle schema.ts 에 없다** — 운영 DB 에만 있다
   * (information_schema 로 확인, 2026-08-21). 파생물을 정본으로 읽지 말 것.
   */
  classId: string | null;
  /** 보강 수업이면 그 보강 반(0171a). 실측 14건. */
  makeupClassId: string | null;
}

export interface ProgressResponse {
  total: number;
  rows: ProgressRow[];
  nextCursor: string | null;
}

/**
 * 다음 커서 — 이번 페이지가 꽉 찼을 때만 잇는다.
 * total 과의 비교로 잇지 않는 이유: 스캔 중 삽입되면 total 이 낡아,
 * «마지막 페이지가 정확히 500행»일 때 한 페이지를 조용히 잃는다.
 */
export function nextCursorFor(offset: number, pageRowCount: number): string | null {
  return pageRowCount === PROGRESS_PAGE_SIZE ? encodeCursor(offset + pageRowCount) : null;
}

/** 두 라우트 공통 응답 헤더 — 학생 데이터라 캐시 어디에도 남기지 않는다. */
export const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;
