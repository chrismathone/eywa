"use client";

// 반 공지 — eywa 반에서 학생을 골라 각 학생의 ClassNote 개별 보드로 같은 내용을 일괄 발송.
// 반 구조는 eywa(여기)에 살고 ClassNote 1인 1반은 배달 레일(Edutrix NoticeWriteModal 패턴 계승).
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { listClassNotices, sendClassNotice, type NoticeClassOption, type NoticeRow } from "@/features/report-admin/server/notice-actions";

// 공지 상태 한글 라벨(raw 코드 UI 노출 금지) — 워커 처리 상태와 동기.
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  queued: { label: "발송 대기", cls: "text-text-dim" },
  processing: { label: "처리 중", cls: "text-text-dim" },
  success: { label: "발송 완료", cls: "text-primary" },
  partial: { label: "일부 실패", cls: "text-amber" },
  failed: { label: "발송 실패", cls: "text-danger" },
};

function fmtKst(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function NoticeFace({
  classes,
  initial,
  canSend,
}: {
  classes: NoticeClassOption[];
  initial: NoticeRow[];
  canSend: boolean;
}) {
  const subjects = useSubjectMaps();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [body, setBody] = useState(""); // 공통 내용
  const [individual, setIndividual] = useState<Record<string, string>>({}); // studentId → 개별 내용(공통 뒤 덧붙임)
  const [showIndividual, setShowIndividual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<NoticeRow[]>(initial);

  // 선택 반들의 재원생 합집합(학생이 두 반에 걸치면 1회) — 개별 내용 입력 박스의 소스이자 실제 대상 수.
  const selectedStudents = (() => {
    const seen = new Map<string, { id: string; name: string; grade: string | null; className: string }>();
    for (const c of classes) {
      if (!checked.has(c.id)) continue;
      for (const s of c.students) if (!seen.has(s.id)) seen.set(s.id, { ...s, className: c.name });
    }
    return [...seen.values()];
  })();
  const selectedCount = selectedStudents.length;
  const indivCount = selectedStudents.filter((s) => (individual[s.id] ?? "").trim()).length;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function refresh() {
    const res = await listClassNotices();
    if (res.ok) setRows(res.rows ?? []);
  }

  async function doSend(test: boolean) {
    // 개별 내용은 현재 선택된 학생 것만 추림(반 해제 후 남은 잔여 입력 제외).
    const indiv: Record<string, string> = {};
    for (const s of selectedStudents) {
      const t = (individual[s.id] ?? "").trim();
      if (t) indiv[s.id] = t;
    }
    setBusy(true);
    const res = await sendClassNotice({ classIds: [...checked], body, individual: indiv, test });
    setBusy(false);
    if (res.ok && res.dryRun) {
      toast.message("dry-run — '보고서 설정' 탭에서 'ClassNote 실제 발송'을 켜야 큐에 올라갑니다");
      return;
    }
    if (!res.ok) {
      toast.error(res.error ?? "공지 발송 요청에 실패했습니다");
      return;
    }
    const parts = [`${res.queued ?? 0}명 발송 대기(발송 PC가 순차 게시)`];
    if (!test && indivCount) parts.push(`개별 내용 ${indivCount}명`);
    const collisions = (res.skipped ?? []).filter((s) => s.reason === "name_collision");
    if (collisions.length) parts.push(`동명이인 제외 ${collisions.length}명(${collisions.map((s) => s.name).join(", ")})`);
    toast.success(parts.join(" · "));
    if (!test) {
      setBody("");
      setChecked(new Set());
      setIndividual({});
      setShowIndividual(false);
    }
    refresh();
  }

  return (
    <div className="space-y-6">
      <section className="bg-card border-line shadow-card rounded-lg border px-5 py-4">
        <div className="mb-3">
          <h2 className="text-foreground text-[15px] font-semibold">반 공지 발송</h2>
          <p className="text-text-faint text-[12px]">
            선택한 반의 재원생 각자의 ClassNote 알림장으로 같은 내용이 발송됩니다 · 학부모 미가입 학생은 수신 불가
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* 반 선택 */}
          <div className="border-line max-h-[360px] overflow-y-auto rounded-md border p-2">
            {classes.length === 0 ? (
              <p className="text-text-faint p-2 text-[12px]">발송 허용 과목의 활성 반이 없습니다.</p>
            ) : (
              classes.map((c) => (
                <label key={c.id} className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px]">
                  <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} disabled={!canSend} />
                  <span className="text-foreground min-w-0 flex-1 truncate">{c.name}</span>
                  {c.subject ? <span className="text-text-faint text-[11px]">{subjects.labelOf(c.subject)}</span> : null}
                  <span className="text-text-faint text-[11px]">{c.studentCount}명</span>
                </label>
              ))
            )}
          </div>

          {/* 공통 본문 + 개별 내용 + 발송 */}
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-text-dim mb-1 text-[11px] font-medium">공통 내용 (선택 반 재원생 모두에게)</p>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={!canSend}
                placeholder="공지 내용 (예: 다음 주 월요일은 학원 휴원입니다.)"
                className="border-line bg-card focus:border-primary min-h-[180px] w-full flex-1 resize-y rounded-md border p-3 text-[14px] outline-none"
              />
            </div>

            {/* 학생별 개별 내용 — 선택 학생 2명+일 때. 입력한 학생만 공통 뒤에 그 내용이 덧붙어 발송(없으면 공통 그대로). */}
            {canSend && selectedCount >= 2 ? (
              <div className="border-line rounded-md border">
                <button
                  type="button"
                  onClick={() => setShowIndividual((v) => !v)}
                  className="text-text-dim hover:bg-bg-soft flex w-full items-center justify-between px-3 py-2 text-[12px] font-medium"
                >
                  <span>학생별 개별 내용 추가 (선택){indivCount ? ` · ${indivCount}명 입력함` : ""}</span>
                  <span className="text-text-faint inline-flex items-center gap-0.5">
                    {showIndividual ? "접기" : "펼치기"}
                    <EyIcon name={showIndividual ? "chevronUp" : "chevronDown"} size={12} />
                  </span>
                </button>
                {showIndividual ? (
                  <div className="border-line max-h-[300px] space-y-2 overflow-y-auto border-t p-2">
                    <p className="text-text-faint px-1 text-[11px]">
                      입력한 학생은 <b>공통 내용 뒤에</b> 이 내용이 덧붙어 발송됩니다. 비우면 공통 내용만 나갑니다.
                    </p>
                    {selectedStudents.map((s) => (
                      <div key={s.id} className="flex items-start gap-2">
                        <span className="w-24 shrink-0 pt-1.5" title={`${s.name} · ${s.className}`}>
                          <span className="text-foreground block truncate text-[12px]">{s.name}</span>
                          <span className="text-text-faint block truncate text-[10px]">
                            {schoolGradeLabel(null, s.grade)} · {s.className}
                          </span>
                        </span>
                        <textarea
                          value={individual[s.id] ?? ""}
                          onChange={(e) => setIndividual((prev) => ({ ...prev, [s.id]: e.target.value }))}
                          rows={2}
                          placeholder="이 학생에게만 덧붙일 내용(선택)"
                          className="border-line bg-card focus:border-primary w-full resize-y rounded-md border px-2 py-1.5 text-[12px] outline-none"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {canSend ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy || !body.trim() || checked.size === 0} onClick={() => doSend(false)}>
                  발송 {selectedCount > 0 ? `(${selectedCount}명${indivCount ? ` · 개별 ${indivCount}` : ""})` : ""}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !body.trim()}
                  onClick={() => doSend(true)}
                  title="실 학부모에게 가지 않는 테스트 학생(학원이)의 알림장으로만 발송해 봅니다"
                >
                  테스트 발송(학원이)
                </Button>
                <span className="text-text-faint text-[12px]">발송 전 내용을 한 번 더 확인하세요 — 게시 후 회수는 발송 이력에서 요청</span>
              </div>
            ) : (
              <p className="text-text-faint text-[12px]">공지 발송 권한이 없습니다(열람 전용).</p>
            )}
          </div>
        </div>
      </section>

      {/* 발송 이력 */}
      <section className="bg-card border-line shadow-card rounded-lg border px-5 py-4">
        <h2 className="text-foreground mb-3 text-[15px] font-semibold">공지 발송 이력</h2>
        {rows.length === 0 ? (
          <p className="text-text-faint text-[13px]">아직 발송한 공지가 없습니다.</p>
        ) : (
          <div className="border-line overflow-x-auto rounded-md border">
            <table className="w-full min-w-[560px] text-left text-[12px]">
              <thead>
                <tr className="border-line text-text-faint border-b">
                  <th className="px-3 py-2 font-semibold">발송 시각</th>
                  <th className="px-3 py-2 font-semibold">내용</th>
                  <th className="px-3 py-2 font-semibold">대상</th>
                  <th className="px-3 py-2 font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = STATUS_LABEL[r.status] ?? { label: "기타", cls: "text-text-dim" };
                  const failNotes = (r.results ?? []).filter((x) => !x.ok);
                  return (
                    <tr key={r.id} className="border-line border-b last:border-b-0">
                      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{fmtKst(r.createdAt)}</td>
                      <td className="text-foreground max-w-[320px] truncate px-3 py-2" title={r.body}>
                        {r.body}
                      </td>
                      <td className="text-text-dim px-3 py-2">{r.targetCount}명</td>
                      <td className="px-3 py-2">
                        <span className={`text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                        {failNotes.length ? (
                          <span className="text-text-faint ml-1.5 text-[11px]" title={failNotes.map((f) => `${f.board}: ${f.note ?? ""}`).join("\n")}>
                            실패 {failNotes.length}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
