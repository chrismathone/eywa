import { uploadEventLabel, uploadFailureText } from "@/features/video-submit/upload-diagnostics";
import { uploadAttemptStatus, type HomeworkUploadAttempt } from "@/features/students/homework-upload-log";

const time = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso));
export function HomeworkUploadLog({ result }: { result: { ready: boolean; rows: HomeworkUploadAttempt[] } }) {
  return <section id="video-upload-log" className="border-line space-y-2 rounded-xl border p-4">
    <h3 className="font-bold">영상 업로드 기록</h3>
    <p className="text-text-dim text-sm">최근 30일 · 30건까지 · 줄을 누르면 자세히. 업로드 한 번의 결과라 숙제 완료 여부와 다를 수 있습니다.</p>
    {!result.ready ? <p role="status" className="text-danger text-sm">업로드 기록을 읽지 못했습니다. 잠시 뒤 다시 확인해 주세요.</p> : !result.rows.length ? <p className="text-text-dim text-sm">최근 업로드 시도가 없습니다.</p> :
      <ul className="divide-line divide-y">{result.rows.map(row => {
        const { last, lastError, history } = row.diagnostics;
        const completed = row.status === "completed" && row.hasVideo;
        // 한 줄 요약 → 눌러서 펼침(원장 2026-10-19 *"학생 영상 제출 로그 간략하게 1행으로. 눌러서 확대"*).
        return <li key={row.id} className="text-sm">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
              <span className="text-text-dim shrink-0 transition group-open:rotate-90" aria-hidden>▸</span>
              <span className="text-text-dim shrink-0 tabular-nums">{time(row.createdAt)}</span>
              <span className="min-w-0 flex-1 truncate">{row.className}{row.homeworkDate ? ` · ${row.homeworkDate} 숙제` : ""} · {(row.bytes / 1048576).toFixed(1)}MB</span>
              <strong className={`shrink-0 ${completed ? "text-green" : lastError?.reason ? "text-danger" : "text-text-dim"}`}>{uploadAttemptStatus(row)}</strong>
            </summary>
            <div className="space-y-1 pb-3 pl-5">
              <p>확인번호 {row.id.slice(0, 8)}</p>
              {last ? <p>마지막 기록: {time(last.receivedAt)} · {uploadEventLabel(last)} · {Math.min(100, Math.floor(last.sentBytes / Math.max(row.bytes, 1) * 100))}%</p>
                : !completed ? <p className="text-text-dim">중단 사유가 기록되지 않았습니다. 사용자 중단과 통신 오류를 구분할 수 없습니다.</p> : null}
              {lastError?.reason && !completed ? <p className="text-danger">{uploadFailureText(lastError.reason).label}. {uploadFailureText(lastError.reason).help}</p> : null}
              {history?.length ? <ol className="text-text-dim space-y-0.5">{history.map(event => <li key={event.sequence}>{time(event.receivedAt)} · {uploadEventLabel(event)}{event.httpStatus ? ` (응답 ${event.httpStatus})` : ""}</li>)}</ol> : null}
            </div>
          </details>
        </li>;
      })}</ul>}
  </section>;
}
