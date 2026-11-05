"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  loadTextbookDetail,
  saveTextbook,
  saveTextbookLessons,
  deleteTextbook,
  type LessonPatch,
} from "@/features/textbooks/server/actions";
import {
  issueTextbookCoverTicket,
  registerTextbookCover,
  removeTextbookCover,
} from "@/features/textbooks/server/cover-actions";
import type { TextbookDetail } from "@/features/textbooks/types";
import { DialogShell, Field, FIELD, FormError, SELECT } from "./form-bits";
import { CoverField } from "./cover-field";
import { LessonsEditor, type LessonValue } from "./lessons-editor";
import { GradeTermField } from "./grade-term-field";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

const MAX_SESSIONS = 200;

/**
 * 삭제 확인 문구 — **무엇이 사라지고 무엇이 남는지**를 그대로 적는다.
 * 🔑 "이미 시트에 적힌 것은 남는다"가 핵심이다 — 이 한 줄이 없으면 아무도 지우지 못한다(그리고
 *    실제로 남는다: 시트는 교재이름을 자유 텍스트로 든다).
 */
function deleteWarning(title: string, filledLessons: number, planCount: number | null): string {
  const lines = [`'${title || "(이름 없음)"}' 교재를 삭제할까요?`, ""];
  if (filledLessons > 0) lines.push(`· 차수별 진도·과제 ${filledLessons}개가 함께 지워집니다.`);
  // ⚠️ 0이라고 "배정 없음"이라 단정하지 않는다 — 이 수는 목록을 연 시점의 값이라 그 사이에 생겼을 수 있다.
  //    셀 수 없었거나(null) 0이면 **숫자 없이** 알린다(빠뜨린 문장이 곧 거짓 안심이 된다).
  if (planCount !== null && planCount > 0) lines.push(`· 배정 ${planCount}건이 함께 지워집니다.`);
  else lines.push("· 이 교재를 태우고 있는 반 배정이 있으면 함께 지워집니다.");
  lines.push("· 이미 시트에 적힌 교재이름·진도·과제는 그대로 남습니다.", "", "되돌릴 수 없습니다.");
  return lines.join("\n");
}

/**
 * 교재 등록·수정 — **한 화면, 저장 버튼 하나**.
 *
 * 🔴 원장 2026-09-16: *"등록하고 그러면 차수랑 이미지 넣는 부분까지하면 2단계를 쓸대없이 거쳐야함 —
 *    바로 표지사진 넣을수있고 차수 숫자 입력하면 온체인지로 바로 갯수에맞게 나오게 … 바로 교재등록해서
 *    쓸수있게"*. 그전엔 ① 기본정보 저장 → ② 표지·차수의 두 단계였다. 표지 업로드에 `textbook_id`가
 *    필요하고 차수 행이 서버 조회에서 왔다는 **구현 사정**이 화면에 새어 나온 것이다.
 * 🔑 이제 화면은 전부 로컬 상태로 그리고, [저장]이 순서대로 한 번에 처리한다:
 *    교재 저장 → (표지 있으면) 올리고 연결 → (바뀐 차수 있으면) 저장.
 * ⚠️ 중간에 실패하면 **닫지 않는다** — 교재는 이미 저장됐고 `id`가 잡혀 있어 다시 누르면 이어서 된다.
 */
export function TextbookDialog({
  mode,
  textbookId,
  skillAreas,
  subject: listSubject,
  canWrite,
  planCount,
  onClose,
}: {
  mode: "create" | "edit";
  textbookId: string | null;
  skillAreas: SkillAreaSetting[];
  /** 새로 등록할 때의 과목(목록에서 고른 과목). 수정은 그 교재의 과목을 그대로 유지한다. */
  subject: string;
  canWrite: boolean;
  /** 이 교재를 태우고 있는 반 배정 수 — 삭제 확인 문구에만 쓴다. 셀 수 없었으면 null([[#89]]). */
  planCount: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(textbookId);
  const [loading, setLoading] = useState(mode === "edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  // 🔴 수정 저장이 과목을 바꾸지 않게 — 불러온 교재의 과목으로 덮는다.
  const [subject, setSubject] = useState(listSubject);
  const [skillArea, setSkillArea] = useState<string>(skillAreas[0]?.key ?? "");
  const hasAreas = skillAreas.length > 0;
  const [pageTime, setPageTime] = useState("");
  const [sessionCount, setSessionCount] = useState(0);
  const [gradeTerm, setGradeTerm] = useState("");

  /** 아직 안 올린 표지 / '지우기' 예약 / 이미 저장된 표지 주소. */
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverCleared, setCoverCleared] = useState(false);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  /** 차수 값(로컬) + 서버에서 온 기준값(바뀐 것만 보내려고). */
  const [lessons, setLessons] = useState<Map<number, LessonValue>>(new Map());
  const [baseline, setBaseline] = useState<Map<number, LessonValue>>(new Map());

  const applyDetail = useCallback((d: TextbookDetail) => {
    setTitle(d.textbook.title);
    setSubject(d.textbook.subject);
    setSkillArea(d.textbook.skillArea ?? "");
    setPageTime(d.textbook.pageTime ?? "");
    setSessionCount(d.textbook.sessionCount);
    setGradeTerm(d.textbook.gradeTerm ?? "");
    setCoverUrl(d.coverUrl);
    setCoverFile(null);
    setCoverCleared(false);
    const next = new Map<number, LessonValue>();
    for (const l of d.lessons) next.set(l.lessonNo, { progress: l.progress ?? "", homework: l.homework ?? "" });
    setLessons(next);
    setBaseline(new Map(next));
  }, []);

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
      applyDetail(res.detail);
    });
    return () => {
      alive = false;
    };
  }, [textbookId, applyDetail]);

  /** 그릴 차수 번호 — 1..sessionCount + 범위 밖에 남아 있는 옛 행. */
  const lessonNos = useMemo(() => {
    const nos: number[] = [];
    for (let n = 1; n <= sessionCount; n += 1) nos.push(n);
    for (const n of [...lessons.keys()].sort((a, b) => a - b)) if (n > sessionCount) nos.push(n);
    return nos;
  }, [sessionCount, lessons]);

  const onLessonChange = useCallback((no: number, field: "progress" | "homework", value: string) => {
    setLessons((prev) => {
      const next = new Map(prev);
      next.set(no, { ...(next.get(no) ?? { progress: "", homework: "" }), [field]: value });
      return next;
    });
  }, []);

  /** 저장할 차수 = 기준값과 다른 것만(안 건드린 행의 updated_by까지 흔들지 않게). */
  function changedLessons(): LessonPatch[] {
    const out: LessonPatch[] = [];
    for (const [no, v] of lessons) {
      const b = baseline.get(no) ?? { progress: "", homework: "" };
      if (b.progress === v.progress && b.homework === v.homework) continue;
      out.push({ lessonNo: no, progress: v.progress || null, homework: v.homework || null });
    }
    return out;
  }

  async function onSave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // ① 교재 본체
      const saved = await saveTextbook({
        id,
        subject,
        skillArea: skillArea || null,
        title,
        pageTime: pageTime || null,
        sessionCount,
        gradeTerm: subject === "math" ? gradeTerm || null : null,
      });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      const nextId = saved.id;
      setId(nextId);

      // ② 표지 — 새로 고른 게 있으면 올리고, '지우기'만 눌렀으면 지운다.
      if (coverFile) {
        const ext = coverFile.name.includes(".")
          ? coverFile.name.split(".").pop()!
          : (coverFile.type.split("/")[1] ?? "jpg");
        const tk = await issueTextbookCoverTicket({
          textbookId: nextId,
          contentType: coverFile.type || "image/jpeg",
          size: coverFile.size,
          ext,
        });
        if (!tk.ok) {
          setError(tk.error);
          return;
        }
        await uploadToTicket(tk.ticket, coverFile);
        const reg = await registerTextbookCover({ textbookId: nextId, path: tk.ticket.path });
        if (!reg.ok) {
          setError(reg.error);
          return;
        }
      } else if (coverCleared && coverUrl) {
        const rm = await removeTextbookCover(nextId);
        if (!rm.ok) {
          setError(rm.error);
          return;
        }
      }

      // ③ 차수 — 바뀐 칸만
      const patches = changedLessons();
      if (patches.length > 0) {
        const res = await saveTextbookLessons(nextId, patches);
        if (!res.ok) {
          setError(res.error);
          return;
        }
      }

      toast.success(id ? "교재를 저장했습니다" : "교재를 등록했습니다");
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  const filled = [...lessons.values()].filter((v) => v.progress.trim() || v.homework.trim()).length;

  return (
    <DialogShell
      title={mode === "create" && !id ? "교재 등록" : `교재 — ${title || "(이름 없음)"}`}
      description={
        listSubject === "math"
          ? "수학 강사 시트에서 반 교재·학생 교재로 배정합니다."
          : "구분·페이지/시간은 영어 강사 시트의 계획 줄에 그대로 들어가는 값입니다."
      }
      onClose={onClose}
      size="xl"
    >
      <div className="flex flex-col gap-4">
        <FormError error={error} />
        {/* 읽기 권한은 이미 있는 교재만 연다 — 칸이 차 있어 placeholder가 안 보이니 한 줄로 알린다(write-lock.ts). */}
        {!canWrite ? <p className="text-text-dim bg-bg-soft rounded-lg px-3 py-2 text-xs">{writeLockedNote("textbooks")}</p> : null}

        {loading ? (
          <p className="text-text-dim py-6 text-center text-xs">불러오는 중…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
              <CoverField
                initialUrl={coverUrl}
                file={coverFile}
                cleared={coverCleared}
                canWrite={canWrite}
                onPick={(f) => {
                  setCoverFile(f);
                  setCoverCleared(false);
                }}
                onClear={() => {
                  setCoverFile(null);
                  setCoverCleared(true);
                }}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="교재이름" className="sm:col-span-2">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    disabled={!canWrite}
                    placeholder={canWrite ? "예: 내신콘서트" : writeLockedPlaceholder("textbooks")}
                    className={FIELD}
                  />
                </Field>
                {hasAreas ? (
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
                ) : null}
                {subject === "math" ? (
                  <GradeTermField value={gradeTerm} onChange={setGradeTerm} disabled={!canWrite} />
                ) : null}
                <Field label="페이지/시간" hint="예: 35분 · 104p — 시트의 같은 칸에 들어갑니다.">
                  <input
                    value={pageTime}
                    onChange={(e) => setPageTime(e.target.value)}
                    maxLength={40}
                    disabled={!canWrite}
                    placeholder={canWrite ? undefined : writeLockedPlaceholder("textbooks")}
                    className={FIELD}
                  />
                </Field>
                <Field
                  label="차수"
                  className="sm:col-span-2"
                  hint={
                    sessionCount > 0
                      ? `아래에 ${sessionCount}칸이 열려 있습니다 · 적은 차수 ${filled}개`
                      : "숫자를 넣으면 아래에 그만큼 진도·과제 칸이 바로 열립니다(최대 200)."
                  }
                >
                  <input
                    type="number"
                    min={0}
                    max={MAX_SESSIONS}
                    value={sessionCount}
                    // 🔴 온체인지로 바로 반영 — 저장을 기다리지 않는다(원장 지시 2026-09-16).
                    onChange={(e) => {
                      const n = Math.trunc(Number(e.target.value));
                      setSessionCount(Number.isFinite(n) ? Math.max(0, Math.min(MAX_SESSIONS, n)) : 0);
                    }}
                    disabled={!canWrite}
                    className={`${FIELD} num w-28`}
                  />
                </Field>
              </div>
            </div>

            <LessonsEditor
              lessonNos={lessonNos}
              values={lessons}
              sessionCount={sessionCount}
              canWrite={canWrite}
              onChange={onLessonChange}
            />

            {canWrite ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={busy || !title.trim()} onClick={() => void onSave()}>
                  {busy ? "저장 중…" : id ? "저장" : "교재 등록"}
                </Button>
                {/* 🔴 폐지가 아니라 **삭제**다(원장 2026-09-16) — 감추기만 하면 같은 이름으로 다시
                    등록할 수 없어, 지운 줄 알고 다시 만들다 막힌다. 사라지는 것·남는 것은 확인 문구에 적는다. */}
                {id ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(deleteWarning(title, filled, planCount))) return;
                      setBusy(true);
                      void deleteTextbook(id)
                        .then((r) => {
                          if (!r.ok) {
                            setError(r.error);
                            return;
                          }
                          toast.success("교재를 삭제했습니다");
                          router.refresh();
                          onClose();
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    삭제
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" className="ml-auto" disabled={busy} onClick={onClose}>
                  닫기
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </DialogShell>
  );
}
