import { DEFAULT_LEDGER_FILTERS, type LedgerFilters } from "./ledger";
import { isVideoHomeworkRange } from "./ledger-roster";
import { isVideoHomeworkDate } from "./types";
import { parseMulti } from "@/lib/multi-value";

/**
 * 영상 제출 현황의 조회 기간 — 주소의 `date`·`from`·`to` → 시작·끝(오늘을 넘지 않는다 · 한 번에 366일까지, 넘으면 끝 달 1일부터).
 * 관리자 화면(`/lesson-reports/video-homework`)과 강사 화면(`/onescreen/video-homework`)이 같은 규칙을 쓴다.
 */
export function ledgerPeriod(param: (name: string) => string, today: string) {
  const requestedDate = param("date"), requestedFrom = param("from"), requestedTo = param("to");
  const checkDate = requestedDate && isVideoHomeworkDate(requestedDate) && requestedDate <= today ? requestedDate : today;
  const toDate = requestedTo && isVideoHomeworkDate(requestedTo) && requestedTo <= today ? requestedTo : checkDate;
  const requestedStart = requestedFrom && isVideoHomeworkDate(requestedFrom) && requestedFrom <= toDate
    ? requestedFrom : `${toDate.slice(0, 7)}-01`;
  const rangeTooLong = !isVideoHomeworkRange(requestedStart, toDate);
  const fromDate = rangeTooLong ? `${toDate.slice(0, 7)}-01` : requestedStart;
  return { fromDate, toDate, rangeTooLong };
}

/**
 * 주소에 남은 필터 → 처음 필터. 이 기간에 없는 반(다른 기간에서 골라 둔 반)은 버린다 — 버튼은 '전체 반'인데 목록이 비는 일이 없게.
 * 강사도 같다 — 이 기간에 숙제를 낸 강사(`teachers`, 관리자 화면만)가 아니면 전체로(선택지에 없는 id가 화면에 새지 않게).
 */
export function ledgerInitialFilters(param: (name: string) => string, activeClasses: ReadonlySet<string>, teachers?: ReadonlySet<string>): LedgerFilters {
  return { ...DEFAULT_LEDGER_FILTERS, teacher: teachers?.has(param("teacher")) ? param("teacher") : "all",
    classIds: parseMulti(param("class"), "all").filter((id) => activeClasses.has(id)), subject: param("subject") || "all",
    school: param("school") || "all", grade: param("grade") || "all", query: param("q"),
    status: ["submitted", "missing", "unchecked"].includes(param("status")) ? param("status") as LedgerFilters["status"] : "all",
    sort: ["missing", "completion"].includes(param("sort")) ? param("sort") as LedgerFilters["sort"] : "name",
  };
}
