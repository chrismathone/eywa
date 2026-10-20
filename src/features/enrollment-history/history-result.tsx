import type { checkEnrollmentHistory } from "./server/actions";
type Result = Exclude<Awaited<ReturnType<typeof checkEnrollmentHistory>>, { error: string }>;
export function HistoryResult({ result }: { result: Result }) {
  const e = result.evidence;
  return <div className="space-y-3 text-sm">
    {result.message ? <p role="alert">{result.message}</p> : null}
    <p className="font-bold">{result.repeated ? "반복 문의 이력 확인 필요" : e.matchedRecords ? "이전 일정 기록을 확인해 주세요" : "조회 범위에서 동일인으로 연결할 기록을 확인하지 못했습니다"}</p>
    <p>이름·연락처 일치 일정 {e.matchedRecords}건 · 오늘 이전 {e.priorRecords}건 · 서로 다른 날짜 {e.visitDates}일</p>
    <p className="text-text-dim">동명이인 등 확인 후보 {e.ambiguous}건 · 취소 {e.cancelled}건 · 중복 제외 {e.duplicates}건. 일정 수는 실제 완료된 상담 횟수가 아닙니다.</p>
    <p>{result.registration === "found" ? "에이와에서 이름·연락처가 일치하는 등록 이력이 있습니다. 동일 학생인지 확인해 주세요."
      : result.registration === "unavailable" ? "에이와 등록 이력을 읽지 못했습니다. 등록 여부는 확인이 필요합니다."
      : "조회 가능한 에이와 학생 기록에서 등록 근거를 찾지 못했습니다. 미등록으로 확정하지 말고 이전 이름·연락처와 등록 이관 여부도 확인해 주세요."}</p>
    {result.repeated ? <p>상담 전 이전 미등록 사유와 이번 문의에서 달라진 점을 확인하세요. 상담 후 에이와의 ‘후속 연락일·내용’과 ‘미등록 사유’에 담당자의 확인 결과를 남겨 주세요.</p> : null}
    {e.rows.length ? <details open={result.repeated}>
      <summary className="cursor-pointer font-bold">근거 일정 {e.rows.length}건 보기</summary>
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">{e.rows.map(r => <li key={r.key}>
        <span>{r.date} · {r.source} · {r.cancelled ? "취소" : r.match === "name_phone" ? "이름·연락처 일치 후보" : "이름만 일치 · 동일인 확인 필요"}</span>
        {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="ml-2 underline">원본 일정</a> : null}
      </li>)}</ul>
    </details> : null}
    <p className="text-text-dim text-xs">조회 범위 {result.from}~{result.through} · 최근 5분 이내 조회 결과. 학교·학년 변경은 동일인 배제 근거로 사용하지 않습니다. 연락처 변경·잘못된 일정 제목·접근할 수 없는 기록은 누락될 수 있습니다.</p>
  </div>;
}
