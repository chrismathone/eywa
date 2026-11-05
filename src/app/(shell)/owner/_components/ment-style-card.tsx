"use client";

// 학원 운영 > AI 멘트 > **강사 말투** — 0214a 코퍼스(직접 작성·자동작성 후 수정)를 접은 강사별 프로파일 목록 + [지금 갱신].
// 주간 갱신은 cron(일요일 20:00 KST)이 같은 빌드를 돈다. 표가 아직 없으면(0262a 미적용) 그 사실만 말하고 버튼을 잠근다([[#95]]).
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MENT_STYLE_MIN_SAMPLES, MENT_STYLE_WINDOW_DAYS } from "@/features/onescreen/ment-style";
import { rebuildMentStylesNow, type MentStyleView } from "@/features/onescreen/server/ment-style-actions";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }) : "—");

export function MentStyleCard({ initial, canEdit = true }: { initial: MentStyleView; canEdit?: boolean }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  async function onRebuild() {
    setBusy(true);
    let res: Awaited<ReturnType<typeof rebuildMentStylesNow>>;
    try {
      res = await rebuildMentStylesNow();
    } catch {
      // 강사 수만큼 AI를 부르는 긴 액션이라 네트워크·타임아웃으로 reject될 수 있다 — 버튼이 영영 '갱신 중…'이면 안 된다.
      toast.error("갱신 요청이 끊겼습니다 — 잠시 후 목록을 다시 열어 확인하세요");
      return;
    } finally {
      setBusy(false);
    }
    if (!res.ok || !res.summary) {
      toast.error(res.error ?? "갱신에 실패했습니다");
      return;
    }
    const built = res.summary.teachers.filter((t) => t.outcome === "built").map((t) => t.teacherName);
    const skipped = res.summary.teachers.filter((t) => t.outcome === "unchanged").length;
    const thin = res.summary.teachers.filter((t) => t.outcome === "insufficient").map((t) => t.teacherName);
    const bad = res.summary.teachers.filter((t) => t.outcome === "rejected" || t.outcome === "failed");
    toast.success(
      [
        built.length ? `갱신 ${built.length}명(${built.join("·")})` : "갱신할 변동이 없습니다",
        skipped ? `변동 없음 ${skipped}명` : null,
        thin.length ? `표본 부족 ${thin.length}명(${thin.join("·")})` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    // 사유 원문(DB·AI 영문)은 감사로그 metadata에 있다 — 화면엔 한글 요약만(raw 노출 금지).
    for (const t of bad) toast.error(`${t.teacherName}: ${t.outcome === "rejected" ? `프로파일 반려(${t.reason ?? "검증 탈락"})` : "갱신 실패 — 감사로그에서 사유 확인"}`);
    if (res.view) setView(res.view);
  }

  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-foreground text-sm font-bold">
          강사 말투
          <span className="text-text-faint ml-2 text-xs font-medium">
            직접 쓰거나 고친 멘트(최근 {MENT_STYLE_WINDOW_DAYS}일 · {MENT_STYLE_MIN_SAMPLES}건 이상)로 선생님마다 말투를 접어 자동작성에 붙입니다 · 매주 일요일 저녁 자동 갱신
          </span>
        </h2>
        {/* 읽기 권한이면 [지금 갱신]을 그리지 않는다(갱신 액션 = canWriteTenant(ai_ment)). 일요일 자동 갱신은 그대로. */}
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={onRebuild} disabled={busy || view.tableMissing}>
            {busy ? "갱신 중…" : "지금 갱신"}
          </Button>
        ) : null}
      </div>

      {view.tableMissing ? (
        <p className="bg-amber/10 text-amber rounded-md px-3 py-2 text-xs leading-relaxed break-keep">
          강사 말투 표(0262a)가 아직 적용되지 않았습니다 — 마이그레이션을 적용하면 다음 일요일부터 자동으로 만들어집니다. 그 전까지 자동작성은 종전과 같습니다.
        </p>
      ) : view.error ? (
        <p className="bg-danger/10 text-danger rounded-md px-3 py-2 text-xs leading-relaxed break-keep" title={view.error}>
          강사 말투 목록을 불러오지 못했습니다.
        </p>
      ) : view.rows.length === 0 ? (
        <p className="text-text-faint text-xs">{canEdit ? "아직 만들어진 말투가 없습니다 — [지금 갱신]을 누르거나 일요일 자동 갱신을 기다리세요." : "아직 만들어진 말투가 없습니다 — 일요일 자동 갱신을 기다리세요."}</p>
      ) : (
        <ul className="divide-line divide-y">
          {view.rows.map((r) => (
            <li key={r.teacherId} className="py-2">
              <button
                type="button"
                onClick={() => setOpen(open === r.teacherId ? null : r.teacherId)}
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              >
                <span className="text-foreground text-sm font-bold">{r.teacherName}</span>
                <span className="text-text-dim text-xs">
                  표본 {r.sampleCount}건(직접 {r.manualCount} · 수정 {r.editedCount}) · {when(r.builtAt)} 갱신
                  {r.builtBy === "cron" ? " · 자동" : r.builtBy === "save" ? " · 저장 때 자동" : ""}
                </span>
              </button>
              {open === r.teacherId ? (
                <dl className="text-text-dim mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-relaxed break-keep">
                  <dt className="font-bold">어조</dt>
                  <dd>{r.profile.tone}</dd>
                  <dt className="font-bold">문장</dt>
                  <dd>{r.profile.sentence}</dd>
                  {r.profile.length ? (
                    <>
                      <dt className="font-bold">길이</dt>
                      <dd>{r.profile.length}</dd>
                    </>
                  ) : null}
                  {r.profile.phrases.length ? (
                    <>
                      <dt className="font-bold">자주 쓰는 표현</dt>
                      <dd>{r.profile.phrases.map((p) => `“${p}”`).join(", ")}</dd>
                    </>
                  ) : null}
                  {r.profile.closing ? (
                    <>
                      <dt className="font-bold">마무리</dt>
                      <dd>{r.profile.closing}</dd>
                    </>
                  ) : null}
                  {r.profile.caution ? (
                    <>
                      <dt className="font-bold">쓰지 않는 표현</dt>
                      <dd>{r.profile.caution}</dd>
                    </>
                  ) : null}
                  {r.profile.edits?.length ? (
                    <>
                      <dt className="font-bold">늘 고치는 것</dt>
                      <dd>{r.profile.edits.join(" · ")}</dd>
                    </>
                  ) : null}
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
