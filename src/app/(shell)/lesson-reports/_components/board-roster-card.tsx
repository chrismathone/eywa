// 반 구성 점검 — eywa 반 로스터 ↔ ClassNote 반 보드 원아.
//
// 영어는 학생 1인 보드가 아니라 반 보드로 운영돼, 반을 옮기거나 신입이 들어와도 ClassNote가
// 따라오지 않으면 그 학생은 **발송이 조용히 실패**한다. 이 화면이 그 어긋남을 사실 그대로 보여준다.
// ⚠️ 자동 수정은 없다 — ClassNote 배정은 학부모 초대가 얽혀 있어 사람이 판단해야 한다.

import type { BoardRosterView } from "@/features/report-admin/server/board-roster-queries";
import type { ClassCheck } from "@/features/report-admin/board-roster-diff";

const STATUS_LABEL: Record<ClassCheck["status"], string> = {
  ok: "정상",
  issues: "확인 필요",
  empty_board: "보드 비어 있음",
  no_board: "보드 없음",
  dup_board: "보드 이름 중복",
};

function StatusPill({ status }: { status: ClassCheck["status"] }) {
  const tone =
    status === "ok"
      ? "bg-primary-soft text-primary"
      : status === "issues"
        ? "bg-amber/20 text-amber"
        : "bg-danger/20 text-danger";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{STATUS_LABEL[status]}</span>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-bg-soft rounded-2xl px-4 py-3">
      <p className="micro text-text-faint">{label}</p>
      <p className={`num text-[22px] font-bold ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
}

export function BoardRosterCard({ view }: { view: BoardRosterView }) {
  // 스냅샷이 없으면 "문제 없음"처럼 보이면 안 된다 — 아직 아무것도 모른다는 사실을 그대로 말한다.
  if (!view.syncedAt)
    return (
      <div className="bg-card shadow-card rounded-2xl p-6">
        <p className="text-foreground text-[15px] font-bold">아직 점검 자료가 없습니다</p>
        <p className="text-text-dim mt-1 text-[13px] break-keep">
          ClassNote 반 구성은 연동 PC의 워커가 하루 한 번(새벽 5시 이후) 가져옵니다. 워커가 최소 한 번 돈 뒤에 결과가
          표시됩니다. 계속 비어 있으면 연동 PC가 꺼져 있는지 확인해 주세요.
        </p>
      </div>
    );

  const { summary: s, checks } = view;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="점검한 반" value={s.classes} />
        <Stat label="어긋난 반" value={s.classesWithIssue} tone={s.classesWithIssue ? "text-amber" : undefined} />
        <Stat label="발송 가능" value={s.ok} tone="text-primary" />
        <Stat label="보드에 없음" value={s.missing} tone={s.missing ? "text-danger" : undefined} />
        <Stat label="오발송 위험" value={s.conflict} tone={s.conflict ? "text-danger" : undefined} />
      </div>

      <p className="text-text-faint text-[11px] break-keep">
        ClassNote 기준 시각 {new Date(view.syncedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · 하루 1회 갱신.
        <b>보드에 없음</b>은 발송이 실패한다는 뜻이고(다른 학생에게 가지는 않습니다), <b>오발송 위험</b>은 같은 이름의
        원아가 둘인데 생년이 달라 남의 아이에게도 갈 수 있다는 뜻입니다.
      </p>

      <div className="space-y-2">
        {checks.map((c) => (
          <div key={c.classId} className="bg-card shadow-card rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-foreground text-[14px] font-bold">{c.className}</span>
              {c.teacher ? <span className="text-text-dim text-[12px]">{c.teacher}</span> : null}
              <StatusPill status={c.status} />
              {c.board ? (
                <span className="text-text-faint text-[11px] break-all">→ {c.board.name}</span>
              ) : null}
            </div>

            {c.status === "no_board" ? (
              <p className="text-danger mt-2 text-[12px] break-keep">
                ClassNote에 이 반의 보드가 없습니다 — 재원생 {c.problems}명 전원 발송 불가. 보드를 만들거나 반 이름을
                맞춰 주세요.
              </p>
            ) : c.status === "dup_board" ? (
              <p className="text-danger mt-2 text-[12px] break-keep">
                같은 이름의 보드가 둘 이상이라 대상을 특정할 수 없습니다. ClassNote에서 하나로 정리해 주세요.
              </p>
            ) : c.status === "empty_board" ? (
              <p className="text-danger mt-2 text-[12px] break-keep">
                보드에 연결된 원아가 한 명도 없습니다 — 재원생 {c.students.length}명 전원 발송 불가. 학부모 초대·반 배정이
                필요합니다.
              </p>
            ) : null}

            {c.students.some((v) => v.kind !== "ok") ? (
              <ul className="mt-2 space-y-1">
                {c.students
                  .filter((v) => v.kind !== "ok")
                  .map((v) => (
                    <li key={v.student} className="text-[12px] break-keep">
                      {v.kind === "missing" ? (
                        <>
                          <span className="text-danger font-bold">{v.student}</span>
                          <span className="text-text-dim"> — 보드에 없습니다(발송 실패)</span>
                          {v.hint ? (
                            <span className="text-text-dim">
                              . 보드의 <b>{v.hint}</b>와 같은 학생인지 확인해 주세요 — 맞다면 학생 정보의 ClassNote 이름에
                              «{v.hint}»를 넣으면 해결됩니다.
                            </span>
                          ) : null}
                        </>
                      ) : v.kind === "conflict" ? (
                        <>
                          <span className="text-danger font-bold">{v.student}</span>
                          <span className="text-text-dim">
                            {" "}
                            — 이름이 같은 원아가 {v.children.length}명인데 생년이 다릅니다({v.children.join(", ")}). 남의
                            아이에게 갈 수 있어 확인이 필요합니다.
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-foreground font-bold">{v.student}</span>
                          <span className="text-text-faint">
                            {" "}
                            — 계정이 둘입니다({v.children.join(", ")}). 같은 학생이라 양쪽 모두에 게시됩니다.
                          </span>
                        </>
                      )}
                    </li>
                  ))}
              </ul>
            ) : null}

            {c.extras.length ? (
              <p className="text-text-dim mt-2 text-[12px] break-keep">
                보드에만 있는 원아: <span className="text-foreground">{c.extras.join(", ")}</span> — 이 반 재원생이
                아닙니다. 강사가 반 보드에 직접 쓴 글은 이들에게도 갑니다.
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
