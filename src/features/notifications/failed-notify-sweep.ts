/**
 * 발송 실패 알림 **유실 보정** 순수 로직.
 *
 * 0143a 트리거는 best-effort다 — `exception when others then return NEW`로 알림 insert가 실패해도
 * 발송 상태 기록(본 UPDATE)을 막지 않는다. 그 설계 자체는 옳다(알림 때문에 워커가 같은 보고서에서
 * 계속 넘어지면 상태가 'queued'에 갇혀 **실패 사실 자체가 사라진다**). 대가는 **알림이 조용히 사라지는 것**:
 * 2026-07-28 실측, 같은 배치에서 failed 5건 중 2건만 알림이 생성됐다(김윤하 담당 3건 유실 — 원인 미확정,
 * 트리거가 예외를 삼켜 흔적이 없다). 재현 테스트(롤백 트랜잭션)에서는 정상 발화하므로 로직 결함은 아니다.
 *
 * → 트리거는 그대로 두고, 하루 1회 스윕이 **빠진 것만** 메운다. 실패 알림은 "울리면 진짜"여야 가치가 있고,
 *   반대로 안 울리면 강사는 학부모가 못 받은 걸 영원히 모른다(0143a가 애초에 해결하려던 문제).
 *
 * 중복 방지 키 = `학생명|MM-DD`. 트리거가 만드는 본문이 `{학생} · {MM-DD} — {사유}` 고정 형식이라
 * 본문에서 되뽑을 수 있다. 컬럼(notified_at)을 새로 두지 않은 이유: AFTER 트리거는 NEW를 저장할 수 없어
 * 행을 다시 UPDATE해야 하고(재귀 트리거 위험), 그 UPDATE도 같은 best-effort 구멍을 그대로 물려받는다.
 */

export type FailedReportRow = {
  id: string;
  studentName: string;
  /** YYYY-MM-DD */
  reportDate: string;
  teacherName: string | null;
  classId: string | null;
  error: string | null;
};

/** 중복 방지 키 — 트리거 본문과 스윕이 같은 규칙으로 만든다. */
export function notifyKey(studentName: string, reportDate: string): string {
  return `${studentName.trim()}|${reportDate.slice(5)}`;
}

/**
 * 기존 알림 본문에서 키 추출 — `{학생} · {MM-DD} — {사유}`.
 * 형식이 아니면 null(옛 알림·다른 문구는 중복 판정에 쓰지 않는다 = 안전 방향으로 실패해 한 번 더 알린다).
 */
export function parseNotifiedKey(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = /^(.+?) · (\d{2}-\d{2}) — /.exec(body.trim());
  return m ? `${m[1].trim()}|${m[2]}` : null;
}

/** 트리거(0143a)와 **같은 문구**. 두 표면이 갈라지면 원장·강사가 서로 다른 조치를 한다. */
export function buildFailureBody(row: FailedReportRow): string {
  const err = row.error ?? "";
  const hint = err.includes("학생 없음")
    ? "학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요."
    : err === ""
      ? "사유가 기록되지 않았습니다 — 발송 콘솔에서 확인하세요."
      : err;
  return `${row.studentName} · ${row.reportDate.slice(5)} — ${hint}`;
}

/** 알림이 없는 실패 건만 추린다. */
export function selectMissing(
  rows: readonly FailedReportRow[],
  notifiedKeys: ReadonlySet<string>,
): FailedReportRow[] {
  const seen = new Set(notifiedKeys);
  const out: FailedReportRow[] = [];
  for (const r of rows) {
    const key = notifyKey(r.studentName, r.reportDate);
    if (seen.has(key)) continue;
    seen.add(key); // 같은 스윕 안에서도 같은 학생·날짜를 두 번 만들지 않는다(과목 2행 등).
    out.push(r);
  }
  return out;
}
