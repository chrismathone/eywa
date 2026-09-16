"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { loadTextbookDetail, saveTextbook, setTextbookActive } from "@/features/textbooks/server/actions";
import type { TextbookDetail } from "@/features/textbooks/types";
import { DialogShell, Field, FIELD, FormError, SELECT, useRun } from "./form-bits";
import { CoverField } from "./cover-field";
import { LessonsEditor } from "./lessons-editor";

/**
 * 교재 등록·수정 + 차수 표.
 *
 * 🔑 **표지와 차수 표는 교재가 저장된 뒤에만** 나온다 — 둘 다 `textbook_id`가 있어야 저장되는 값이라,
 *    등록 화면에서 미리 받으면 갈 곳 없는 입력이 된다(첨부 orphan 방지와 같은 규약).
 * 🔴 차수 표는 `sessionCount`가 정하는 **1..N 전부**를 세운다 — 행이 있어야만 보이면 아무것도 못 적는다.
 * ⚠️ 읽기는 메뉴 접근이면 되고(강사는 readonly로 차수를 **본다**), 저장 버튼만 `canWrite`가 정한다.
 */
export function TextbookDialog({
  mode,
  textbookId,
  skillAreas,
  canWrite,
  onClose,
}: {
  mode: "create" | "edit";
  textbookId: string | null;
  skillAreas: SkillAreaSetting[];
  canWrite: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { busy, error, setError, run } = useRun();
  const [id, setId] = useState<string | null>(textbookId);
  const [detail, setDetail] = useState<TextbookDetail | null>(null);
  const [loading, setLoading] = useState(mode === "edit");

  const [title, setTitle] = useState("");
  const [skillArea, setSkillArea] = useState<string>(skillAreas[0]?.key ?? "");
  const [pageTime, setPageTime] = useState("");
  const [sessionCount, setSessionCount] = useState(0);

  useEffect(() => {
    if (!textbookId) return;
    let alive = true;
    void loadTextbookDetail(textbookId).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.detail) {
        setError("교재를 찾을 수 없습니다");
        return;
      }
      setDetail(res.detail);
      setTitle(res.detail.textbook.title);
      setSkillArea(res.detail.textbook.skillArea ?? "");
      setPageTime(res.detail.textbook.pageTime ?? "");
      setSessionCount(res.detail.textbook.sessionCount);
    });
    return () => {
      alive = false;
    };
  }, [textbookId, setError]);

  async function reload(nextId: string) {
    const res = await loadTextbookDetail(nextId);
    if (res.ok && res.detail) {
      setDetail(res.detail);
      setSessionCount(res.detail.textbook.sessionCount);
    }
  }

  async function onSaveBasics() {
    const res = await run(
      () =>
        saveTextbook({
          id,
          subject: "english",
          skillArea: skillArea || null,
          title,
          pageTime: pageTime || null,
          sessionCount,
        }),
      id ? "교재를 수정했습니다" : "교재를 등록했습니다",
    );
    if (!res || !("id" in res)) return;
    setId(res.id);
    await reload(res.id);
  }

  const active = detail?.textbook.isActive ?? true;

  return (
    <DialogShell
      title={mode === "create" && !id ? "교재 등록" : `교재 — ${detail?.textbook.title ?? title}`}
      description="구분·페이지/시간은 영어 강사 시트의 계획 줄에 그대로 들어가는 값입니다."
      onClose={onClose}
      size="xl"
    >
      <div className="flex flex-col gap-4">
        <FormError error={error} />

        {loading ? (
          <p className="text-text-dim py-6 text-center text-xs">불러오는 중…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
              {id ? (
                <CoverField
                  textbookId={id}
                  initialUrl={detail?.coverUrl ?? null}
                  canWrite={canWrite}
                  onChanged={() => router.refresh()}
                />
              ) : (
                <p className="text-text-faint bg-bg-soft rounded-lg px-3 py-2 text-xs">
                  표지 사진은 교재를 저장한 뒤 올릴 수 있습니다.
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="교재이름" className="sm:col-span-2">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    disabled={!canWrite}
                    placeholder="예: 내신콘서트"
                    className={FIELD}
                  />
                </Field>
                <Field label="구분" hint="계획 줄의 '구분'에 들어갑니다. 줄마다 바꿀 수 있습니다.">
                  <select
                    value={skillArea}
                    onChange={(e) => setSkillArea(e.target.value)}
                    disabled={!canWrite}
                    className={SELECT}
                  >
                    <option value="">미지정</option>
                    {skillAreas.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="페이지/시간" hint="예: 35분 · 104p — 시트의 같은 칸에 들어갑니다.">
                  <input
                    value={pageTime}
                    onChange={(e) => setPageTime(e.target.value)}
                    maxLength={40}
                    disabled={!canWrite}
                    className={FIELD}
                  />
                </Field>
                <Field label="차수" hint="이 교재를 몇 번에 나눠 나가는지(최대 200).">
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={sessionCount}
                    onChange={(e) => setSessionCount(Number(e.target.value))}
                    disabled={!canWrite}
                    className={`${FIELD} num`}
                  />
                </Field>
              </div>
            </div>

            {canWrite ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={busy} onClick={() => void onSaveBasics()}>
                  {busy ? "저장 중…" : id ? "교재 저장" : "교재 등록"}
                </Button>
                {id ? (
                  <Button
                    type="button"
                    variant={active ? "destructive" : "outline"}
                    disabled={busy}
                    onClick={() => {
                      if (
                        active &&
                        !window.confirm("이 교재를 폐지할까요? 목록에서 감춰지고, 이미 시트에 적힌 이름은 그대로 남습니다.")
                      ) {
                        return;
                      }
                      void run(() => setTextbookActive(id, !active), active ? "폐지했습니다" : "되살렸습니다").then((r) => {
                        if (r) void reload(id);
                      });
                    }}
                  >
                    {active ? "폐지" : "되살리기"}
                  </Button>
                ) : null}
                <span className="text-text-faint ml-auto text-xs">
                  {id ? "차수 표는 아래에서 따로 저장합니다." : "저장하면 차수 표가 열립니다."}
                </span>
              </div>
            ) : null}

            {id && detail ? (
              <LessonsEditor
                textbookId={id}
                lessons={detail.lessons}
                sessionCount={detail.textbook.sessionCount}
                canWrite={canWrite}
                onSaved={() => {
                  void reload(id);
                  toast.success("차수를 저장했습니다");
                }}
              />
            ) : null}
          </>
        )}
      </div>
    </DialogShell>
  );
}
