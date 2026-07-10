"use client";

import { useState } from "react";
import type { ReportSettings } from "@/features/owner/settings-types";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { CLASSNOTE_SENDABLE_SUBJECTS } from "@/features/onescreen/classnote-guard";
import { SectionForm, SettingsCard } from "./section-form";
import { TextField, ToggleField } from "./fields";

/**
 * 학원 운영 > 보고서 — 학부모 보고서(/r)·ClassNote 게시 이미지의 표시 설정.
 * notifications-section 패턴(로컬 state + SectionForm이 저장 배관 담당). /r 페이지가 이 값을 읽어 렌더.
 */
export function ReportSection({ initial }: { initial: ReportSettings }) {
  const [r, setR] = useState<ReportSettings>(initial);
  const set = (patch: Partial<ReportSettings>) => setR((prev) => ({ ...prev, ...patch }));
  // 발송 허용 과목 체크박스 — 학원 운영 과목(클라 단일 소스, 하드코딩 금지) 중 **발송 가능 과목만** 노출.
  // ClassNote 실보드 관례가 (수학)/(영어) 학생모드뿐이라, 매핑 없는 과목을 켜면 (수학) 보드 오게시로
  // 직결됐음(P0-3) — 화이트리스트(CLASSNOTE_SENDABLE_SUBJECTS) 밖 과목은 칩 자체를 안 보여준다.
  const subjects = useSubjectMaps();
  const sendableOptions = subjects.options.filter((o) =>
    (CLASSNOTE_SENDABLE_SUBJECTS as readonly string[]).includes(o.value),
  );
  const toggleSubject = (key: string) =>
    set({
      classnoteSubjects: r.classnoteSubjects.includes(key)
        ? r.classnoteSubjects.filter((k) => k !== key)
        : [...r.classnoteSubjects, key],
    });

  return (
    <SectionForm section="report" payload={r}>
      {/* ClassNote 실제 발송 스위치 — 오발송 안전장치. 기본 OFF(dry-run): 발송 버튼이 저장만 함.
          원장이 켜야 학부모에게 실제 전송(공유 DB+라이브 워커·이관분 오발송 방지). */}
      <div
        className={`mb-4 rounded-md border px-4 py-3 ${
          r.classnoteSendEnabled ? "border-primary bg-primary/5" : "border-danger bg-danger/5"
        }`}
      >
        <ToggleField
          label="ClassNote 실제 발송 사용"
          hint={
            r.classnoteSendEnabled
              ? "⚠️ 켜짐 — 발송 버튼이 실제로 학부모에게 전송합니다"
              : "지금은 dry-run — 발송 버튼을 눌러도 저장만 하고 실제 전송하지 않습니다"
          }
          value={r.classnoteSendEnabled}
          onChange={(v) => set({ classnoteSendEnabled: v })}
        />
        {!r.classnoteSendEnabled ? (
          <p className="text-danger mt-1.5 text-[12px]">
            안전을 위해 기본 꺼짐입니다. 실제 발송을 시작하려면 위 스위치를 켜세요(이관된 과거 보고서 오발송 방지).
          </p>
        ) : null}

        {/* 발송 허용 과목 — 체크한 과목만 학부모에게 발송(현 운영=수학만). 빈 목록이면 아무것도 발송 안 함. */}
        <div className="border-line mt-3 border-t pt-3">
          <p className="text-foreground text-[13px] font-semibold">발송 과목</p>
          <p className="text-text-dim mt-0.5 text-[12px]">
            체크한 과목만 학부모에게 발송됩니다. 아무것도 고르지 않으면 발송되지 않습니다.
          </p>
          {sendableOptions.length === 0 ? (
            <p className="text-text-faint mt-2 text-[12px]">
              발송 가능한 과목이 없습니다 — ClassNote 학생모드 보드가 있는 과목(수학·영어)만 발송할 수 있습니다.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {sendableOptions.map((o) => {
                const on = r.classnoteSubjects.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggleSubject(o.value)}
                    aria-pressed={on}
                    className={`rounded-full border px-3 py-1 text-[13px] transition ${
                      on
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-line text-text-dim hover:bg-bg-soft"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
          {r.classnoteSendEnabled && r.classnoteSubjects.length === 0 ? (
            <p className="text-danger mt-2 text-[12px]">
              ⚠️ 발송이 켜져 있지만 선택된 과목이 없어 실제로는 아무것도 발송되지 않습니다. 발송할 과목을 선택하세요.
            </p>
          ) : null}
        </div>
      </div>

      {/* 좌열: 머리글+바닥글(세로 스택) · 우열: 표시 항목. items-stretch로 우측 카드를 좌측 높이에 맞춰 늘려
          내용이 짧아도 카드가 열을 끝까지 채운다(우측 하단 빈 배경 제거). */}
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <SettingsCard
            title="머리글"
            description="보고서 상단 로고·학원명·제목. 로고 이미지에 학원명이 이미 있으면 '학원명 표시'를 꺼서 중복을 없앨 수 있습니다."
          >
            <div className="space-y-1">
              <ToggleField label="로고 표시" value={r.showLogo} onChange={(v) => set({ showLogo: v })} />
              <ToggleField
                label="학원명(텍스트) 표시"
                hint="로고에 이름이 있으면 끄기"
                value={r.showAcademyName}
                onChange={(v) => set({ showAcademyName: v })}
              />
              <div className="pt-2">
                <TextField
                  label="보고서 제목"
                  value={r.title}
                  onChange={(v) => set({ title: v })}
                  placeholder="수업 보고서"
                />
              </div>
            </div>
          </SettingsCard>

          <SettingsCard title="바닥글" description="보고서 하단 문구. 비우면 '학원명 · 날짜'가 표시됩니다.">
            <div className="space-y-1">
              <ToggleField label="바닥글 표시" value={r.showFooter} onChange={(v) => set({ showFooter: v })} />
              <div className="pt-2">
                <TextField
                  label="바닥글 문구"
                  hint="비우면 학원명·날짜"
                  value={r.footerNote}
                  onChange={(v) => set({ footerNote: v })}
                />
              </div>
            </div>
          </SettingsCard>

          <SettingsCard
            title="테스트 문항수"
            description="일일·확인테스트 만점(/N)은 과목별로 설정합니다(학원 운영 > 과목). 아래를 켜면 강사가 원스크린에서 직접 바꿀 수 있습니다."
          >
            <ToggleField
              label="강사가 문항수 직접 변경 허용"
              hint="끄면 과목 설정값 고정"
              value={r.allowTeacherTestMax}
              onChange={(v) => set({ allowTeacherTestMax: v })}
            />
          </SettingsCard>

          <SettingsCard
            title="AI 멘트 공지 모드"
            description="자동작성 학부모 멘트의 문단 구성입니다. 프롬프트 세부는 학원 운영 > AI 멘트에서 편집합니다."
          >
            <div className="flex flex-col gap-2">
              {(
                [
                  ["A", "단일 문단", "진도·점수·태도·과제·특이사항을 종합한 한 문단"],
                  ["B", "2문단 분리", "① 수업 내용(교재·진도·과제) ② 태도·특이사항"],
                ] as const
              ).map(([mode, title, desc]) => {
                const on = (r.noticeMode ?? "A") === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => set({ noticeMode: mode })}
                    aria-pressed={on}
                    className={`rounded-md border px-3 py-2 text-left transition ${
                      on ? "border-primary bg-primary/5" : "border-line hover:bg-bg-soft"
                    }`}
                  >
                    <p className="text-foreground text-[13px] font-semibold">
                      {title} <span className="text-text-faint font-normal">({mode})</span>
                    </p>
                    <p className="text-text-dim mt-0.5 text-[12px]">{desc}</p>
                  </button>
                );
              })}
            </div>
          </SettingsCard>
        </div>

        <SettingsCard
          title="표시 항목"
          description="학부모 보고서에 표시할 항목을 켜고 끕니다. 끈 항목은 보고서에서 숨겨집니다."
        >
          {/* 세로 목록 + 행 구분선 — 좁은 열에서 라벨↔체크박스 간격을 좁혀 빈 공간 제거. */}
          <div className="border-border divide-border divide-y rounded-md border">
            {(
              [
                ["교재명", "showTextbook"],
                ["진도", "showProgress"],
                ["일일테스트", "showDailyTest"],
                ["확인테스트", "showCheckTest"],
                ["과제", "showHomework"],
                ["수업 태도", "showAttitude"],
                ["학부모 전달 내용", "showParentNote"],
                ["학습 추세(종합분석)", "showTrendNote"],
                ["성적 추이 그래프", "showTrendGraph"],
                ["학생 사진 첨부", "showAttachments"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="px-3">
                <ToggleField
                  label={label}
                  value={r[key]}
                  onChange={(v) => set({ [key]: v } as Partial<ReportSettings>)}
                />
              </div>
            ))}
          </div>
        </SettingsCard>
      </div>
    </SectionForm>
  );
}
