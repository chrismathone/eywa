import { uploadEventLabel, uploadFailureText } from "@/features/video-submit/upload-diagnostics";
import { uploadAttemptStatus, type HomeworkUploadAttempt } from "@/features/students/homework-upload-log";

const time = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso));
export function HomeworkUploadLog({ result }: { result: { ready: boolean; rows: HomeworkUploadAttempt[] } }) {
  return <section id="video-upload-log" className="border-line space-y-3 rounded-xl border p-4">
    <h3 className="font-bold">영상 업로드 기록</h3>
    <p className="text-text-dim text-sm">최근 30일의 시도 중 30건까지 표시합니다. 각 업로드의 결과이며, 다른 영상으로 제출한 숙제의 완료 상태와는 다를 수 있습니다.</p>
    {!result.ready ? <p role="status" className="text-danger text-sm">업로드 기록을 읽지 못했습니다. 잠시 뒤 다시 확인해 주세요.</p> : !result.rows.length ? <p className="text-text-dim text-sm">최근 업로드 시도가 없습니다.</p> :
      <ul className="divide-line divide-y">{result.rows.map(row => {
        const { last, lastError, history } = row.diagnostics;
        const completed = row.status === "completed" && row.hasVideo;
        return <li key={row.id} className="space-y-1 py-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>{row.className}{row.homeworkDate ? ` · ${row.homeworkDate} 숙제` : ""}</strong><strong className={completed ? "text-green" : "text-text-dim"}>{uploadAttemptStatus(row)}</strong></div>
          <p>{time(row.createdAt)} 시작 · {(row.bytes / 1048576).toFixed(1)}MB · 확인번호 {row.id.slice(0, 8)}</p>
          {last ? <p>마지막 기록: {time(last.receivedAt)} · {uploadEventLabel(last)} · {Math.min(100, Math.floor(last.sentBytes / Math.max(row.bytes, 1) * 100))}%</p>
            : !completed ? <p className="text-text-dim">중단 사유가 기록되지 않았습니다. 사용자 중단과 통신 오류를 구분할 수 없습니다.</p> : null}
          {lastError?.reason && !completed ? <p className="text-danger">{uploadFailureText(lastError.reason).label}. {uploadFailureText(lastError.reason).help}</p> : null}
          {history?.length ? <details><summary className="cursor-pointer">진행·오류 내역</summary><ol className="mt-2 space-y-1">{history.map(event => <li key={event.sequence}>{time(event.receivedAt)} · {uploadEventLabel(event)}{event.httpStatus ? ` (응답 ${event.httpStatus})` : ""}</li>)}</ol></details> : null}
        </li>;
      })}</ul>}
  </section>;
}
