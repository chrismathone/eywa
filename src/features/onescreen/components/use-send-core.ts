"use client";

import { useState } from "react";
import { toast } from "sonner";
import { notifyMakeupEffect } from "./makeup-effect-toast";
import { queueWriteTiming } from "../write-timing-store";
import type { SendMode, WriteView } from "../write-timing";
import { monthDayLabel } from "@/lib/date-kst";
import type { SavedVideoHomeworkDue } from "@/features/video-homework/due";
import { buildReportFields } from "../report-fields";
import { saveAndQueueClassnote, saveLessonReport } from "../server/actions";
import { isJjSheetDraft } from "../jj-books";
import { isTrendOptedOut } from "../trend-optout";
import type { OneScreenStudent, Subject } from "../types";
import { isMathReportPilot } from "../math-report-pilot";
import { REASON_BLOCKS, pilotSendBlocks } from "../pilot-send-gate";
import { jjDayKey, jjKnownSlots } from "../jj-day";
import { canRecompose, templateImageSlots } from "../english-draft";
import { READONLY_TEACHER_VIEW_ERROR } from "@/lib/auth/view-as-message";
import { cnSyncRequested } from "../classnote-match-live";
import { resolveRowFields } from "../row-fields";
import { computeClientMentSource } from "../ment-source";
import type { SendClassAsk } from "./send-class-dialog";
import { submitLinkChoosable } from "@/features/video-submit/link-choice";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import type { ReportTemplate } from "@/features/report-templates/defaults";
import type { ReportsState } from "../session-input";
import type { SubjectReport } from "./report-card";
import type { useEnglishJj } from "./use-english-jj";
import type { useLiveClassnoteMatch } from "./use-live-classnote-match";
import type {
  useSubmitLinkMode,
  useVideoHomeworkOthersReport,
  useVideoHomeworkPolicy,
  useVideoHomeworkStore,
} from "@/features/video-homework/components/video-homework-provider";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 보고서 저장·발송 코어(카드·표·일괄·첨부 공용) — 수정 계획 P3-O 9/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 저장 입력 조립(buildSaveInputFor — 발송 조건 pilotCheck·영상 과제 값을 서버에 함께 싣는다) → 저장(saveRecord) /
 * 저장+발송 대기(queueOne) → 응답 반영(영상 과제·마감 되돌림·진도 확정·배지). 반 정보 없는 보강 보고서는
 * 보낼 반을 묻는다(sendClassAsk — queueOne이 묻는 쪽이라 여기에 있다).
 * 🔴 최신 초안·학생 값은 **ref**로 읽는다(일괄 루프 중 편집·앞 행 반영 — 클릭 시점 스냅샷이면 유실, #10).
 */
export function useSendCore({
  ctx: { date, activeDate, readonlyView, showDailyTest, showCheckTest },
  refs: { reportsRef, studentsRef, trendOptOutRef },
  i18n: { t, tf },
  video: { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, videoHwStore },
  english: { jj, englishTemplatesRef, findTemplate, freshEnglishDraft, rowOutOfClass },
  rows: { patch, patchReport, latestStudent, writeView, boostClassnoteMatch },
}: {
  ctx: { date: string; activeDate: string; readonlyView: boolean; showDailyTest: boolean; showCheckTest: boolean };
  refs: {
    reportsRef: { readonly current: ReportsState };
    studentsRef: { readonly current: OneScreenStudent[] };
    trendOptOutRef: { readonly current: ReadonlySet<string> };
  };
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  video: {
    videoHwSaveOk: boolean;
    videoHwPolicy: ReturnType<typeof useVideoHomeworkPolicy>;
    videoHwByOther: ReturnType<typeof useVideoHomeworkOthersReport>;
    videoDueReady: boolean;
    submitLinkMode: ReturnType<typeof useSubmitLinkMode>;
    videoHwStore: ReturnType<typeof useVideoHomeworkStore>;
  };
  english: {
    jj: ReturnType<typeof useEnglishJj>;
    englishTemplatesRef: { readonly current: ReportTemplate[] };
    findTemplate: (templateId: string | undefined, list?: readonly ReportTemplate[]) => ReportTemplate | null;
    freshEnglishDraft: (student: OneScreenStudent, subjectName: string) => { draft: string; autoDraft: string | undefined };
    rowOutOfClass: (student: OneScreenStudent, su: Subject | undefined) => boolean;
  };
  rows: {
    patch: (id: string, fn: (s: OneScreenStudent) => OneScreenStudent) => void;
    patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
    latestStudent: (student: OneScreenStudent, subjectName: string) => OneScreenStudent;
    writeView: () => WriteView;
    boostClassnoteMatch: ReturnType<typeof useLiveClassnoteMatch>["boost"];
  };
}) {
  // 반 정보 없는 보강 보고서의 'ClassNote로 보낼 반' 고르기(A안) — 서버가 메인 수업을 못 정했을 때만 뜬다.
  const [sendClassAsk, setSendClassAsk] = useState<SendClassAsk | null>(null);
  const askSendClass = (ask: Omit<SendClassAsk, "resolve">) =>
    new Promise<string | null>((resolve) => setSendClassAsk({ ...ask, resolve }));
  /**
   * 저장 입력(보고서 필드)을 (학생,과목)별로 조립 — 카드/표 공용.
   *
   * 🔴 **멘트가 비면 빈 채로 저장한다**(2026-07-30 발송 감사로 변경). 예전엔 여기서 조용히
   *    `buildSubjectReport` 템플릿을 끼워 넣었는데, 그 결과가 아래 저장 후 `patchReport`로
   *    **강사의 멘트칸에 되써져** 발송 가능 상태가 됐다 — 강사가 쓴 적 없는 문장이 강사 이름으로
   *    학부모에게 나갔다(4일치 발송분 226건 중 50건, 22%). 진도만 넣고 일괄 저장하면 벌어지는 일이라
   *    본인은 눈치채기 어렵다.
   *    이제 멘트가 비면 기록만 저장되고 발송은 게이트가 막는다("멘트 입력 필요") → 강사가 자동작성을
   *    누르거나 직접 쓰게 된다. 템플릿은 **AI 생성이 실패했을 때만**, 토스트로 알리며 멘트칸에 들어간다.
   */
  function buildSaveInputFor(student: OneScreenStudent, subjectName: string) {
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    const su = student.subjects[idx];
    // ⚠️ 최신 초안은 ref에서(일괄 루프 중 사용자 편집·앞 행 patch 반영) — closure `reports`는 클릭 시점 스냅샷이라 유실 위험(#10).
    const existing = reportsRef.current[student.id]?.[subjectName];
    // 영어 행: 손대지 않은 자동 글이면 지금 칸 값으로 다시 조립해서 저장한다(기록과 다른 글이 나가지 않게).
    const fresh = su?.subjectKey === "english" ? freshEnglishDraft(student, subjectName) : null;
    const draft = fresh ? fresh.draft : (existing?.draft ?? "");
    // 자동작성 스냅샷(0214a) — 작성 방식 판정과 자동작성 원문(0370a)이 같은 값을 본다.
    const autoSnap = fresh ? fresh.autoDraft : existing?.autoDraft;
    const mentSource = computeClientMentSource(draft, autoSnap);
    // 표시 필드(교재·진도·시험·태도·멘트…)는 **카드 미리보기와 같은 함수**로 만든다(report-fields.ts).
    // 여기서 따로 조립하면 "화면에 보이던 것"과 "학부모가 받은 것"이 조용히 갈라진다.
    // 🔴 평가값(태도·점수·과제 수행률)은 **행 단위**로 해석한다(row-fields.ts) — 보강은 정규와 따로 나가는
    //    다른 보고서라 값도 독립이어야 한다(원장 2026-08-13). 행에 값이 없으면 학생 값으로 폴백해
    //    옛 세션·기존 행은 지금까지와 똑같이 동작한다.
    const rowEval = resolveRowFields(student, su);
    const fields = buildReportFields({
      subject: su,
      homework: rowEval.homework,
      attitude: rowEval.attitude,
      tests: rowEval.tests,
      draft,
      jjSheet: su?.subjectKey === "english" && isJjSheetDraft(existing),
      trendDraft: existing?.trendDraft,
      // '학습 추세 미발송'(원장 2026-09-18) — ref로 읽는다(디바운스·발송은 비동기라 closure가 옛 값일 수 있다).
      trendHidden: isTrendOptedOut(trendOptOutRef.current, su?.classId, student.id),
      showDailyTest,
      showCheckTest,
    });
    return {
      draft,
      input: {
        studentId: student.id,
        reportDate: date || undefined, // 대상 날짜(빈값=서버 오늘) — report_date가 곧 카드 표시일·ClassNote 게시일
        ...fields,
        // ⚠️ subject는 **과목키**(math)여야 한다 — 발송 과목 게이트·보드 매핑이 이 값을 본다.
        //    행 이름(name)엔 반 이름이 붙을 수 있으므로 폴백도 subjectLabel을 먼저 본다.
        subject: su?.subjectKey || su?.subjectLabel || su?.name || undefined,
        // 반(수업) — 보고서 1건의 단위(0134a). 같은 날 정규+특강이 서로 안 덮게 하는 키. 보강 행은 classId=null → unit_key=과목키.
        classId: su?.classId ?? null,
        // 보강(수업외) = 담당반·결석 게이트 우회. 카드 전체가 보강(isMakeup)이거나, **정규 카드에 병합된 보강 행**
        // (makeup=true·classId 없음)도 우회 — 그 학생의 담당반이 아닌 추가수업이라 담당반/결석 검사에 걸리면 안 된다.
        outOfClass: (student.isMakeup ?? false) || (!!su?.makeup && !su?.classId),
        // 보강 행의 소속(어느 수업 시간에 한 보강인가) — 반 필터 앵커(0171a). 정규 행이면 서버가 무시한다.
        makeupClassId: su?.makeupClassId ?? null,
        // 오늘 영상 과제(0308a) — 🔴 **값이 있을 때만** 싣는다(DB·세션에서 읽었거나 강사가 눌렀을 때). 손대지 않은 행을
        // false로 적으면 '모름'이 '없음'이 되어 다음 수업 검사가 조용히 사라진다(적대 리뷰 High). 정책이 끈 반·반 없는 행·
        // 과제 값을 못 읽은 세션(videoHwSaveOk=false — 저장돼 있던 '있음'을 덮는다)도 싣지 않는다.
        // 다른 선생님이 처음 쓴 줄도 싣지 않는다(그 선생님만 바꾼다 — 서버·DB도 한 번씩 더 막는다).
        ...(videoHwSaveOk && typeof su?.videoHomework === "boolean" && su.classId && videoHwPolicy &&
        !videoHwByOther(student.id, su.classId) &&
        isVideoHomeworkEnabled(videoHwPolicy, { classId: su.classId, subjectKey: su.subjectKey ?? "math", grade: student.grade })
          // 그 값을 DB와 맞춘 시각도 함께 — 장부에서 취소한 숙제를 모른 채 '있음'으로 되살리지 않게(서버 `cancels.ts`, 원장 2026-10-16).
          ? { videoHomework: su.videoHomework, videoHomeworkSeenAt: videoHwStore?.seenAtOf(student.id, su.classId) ?? null }
          : {}),
        // 영상 첨부 링크 넣기(0328a) — 같은 규약: 고른 값이 있고 그 행에서 고를 수 있을 때만 싣는다(토글이 안 보이는 행·단계는
        // 싣지 않아 저장돼 있던 값을 덮지 않는다). 영상 과제가 꺼진 행은 false로 — 과제 없이 링크만 켜진 값이 남지 않게.
        ...(videoHwSaveOk && typeof su?.videoSubmitLink === "boolean" && !videoHwByOther(student.id, su?.classId) &&
        submitLinkChoosable(submitLinkMode, videoHwPolicy, { classId: su.classId, subjectKey: su.subjectKey, grade: student.grade, studentName: student.name })
          ? { videoSubmitLink: su.videoSubmitLink && su.videoHomework === true }
          : {}),
        // 영상 숙제 마감(원장 2026-10-15) — 같은 규약: 고른 값이 있고 그 행에서 고를 수 있을 때만(영상 과제를 싣는 조건 + 마감 칸 준비됨).
        // 영상 과제가 꺼진 행은 서버가 마감을 지운다(값을 보내지 않아도). '다음 수업' 날짜는 서버가 시간표로 정한다(화면 값을 믿지 않는다).
        ...(videoDueReady && videoHwSaveOk && su?.videoHomework === true && su.videoHomeworkDue && su.classId && videoHwPolicy &&
        !videoHwByOther(student.id, su.classId) &&
        isVideoHomeworkEnabled(videoHwPolicy, { classId: su.classId, subjectKey: su.subjectKey ?? "math", grade: student.grade })
          ? { videoHomeworkDue: su.videoHomeworkDue }
          : {}),
        // 멘트 작성 방식(0214a) — 이번 세션 자동작성 스냅샷과 비교(최종은 서버 resolveMentSource가 sticky 판정).
        mentSource,
        // 수학 보고서 시범 — 강사 한줄 멘트(필수). 서버가 비었거나 글 끝에 안 붙었으면 거절한다.
        // 영어도 같다(원장 2026-10-26 *"영어도 수학이랑 동일하게 … 사랑의 한마디 · 필수"*).
        ...(isMathReportPilot(student.id, su?.subjectKey) || su?.subjectKey === "english" ? { pilotOneLine: rowEval.note } : {}),
        // JJ 수업보고서 글 — 사랑의 한마디가 선택이다(원장 2026-10-27). 서버가 이 표시로 '영어 한마디 필수'를 건너뛴다.
        ...(su?.subjectKey === "english" && isJjSheetDraft(existing) ? { jjSheet: true } : {}),
        // 새 수학 보고서 — 화면 발송 조건(자동작성이 지금 값 기준인가 · 사유를 다 적었나)을 서버에도 싣는다(원장 2026-10-26 일괄 발송 구멍).
        //   일괄 발송·행 발송이 모두 이 입력을 지나므로, 어느 길로 보내도 서버가 같은 조건으로 거절한다.
        // 영어 줄도 싣는다 — 보강 사유를 서버가 같은 조건으로 본다(2026-10-26). 영어엔 자동작성 조건이 없어 factsCurrent는 늘 참이다.
        ...(isMathReportPilot(student.id, su?.subjectKey) || su?.subjectKey === "english"
          ? (() => {
              const blocks = pilotSendBlocks(student, subjectName, { draft, autoDraft: autoSnap, pilotFactsSig: existing?.pilotFactsSig, templateId: existing?.templateId });
              return { pilotCheck: { factsCurrent: !blocks.includes("autowrite"), reasonsOk: !blocks.some((b) => REASON_BLOCKS.includes(b)) } };
            })()
          : {}),
        // 자동작성 후 고친 멘트면 그 자동작성 원문도 싣는다(0370a) — 말투 프로파일이 선생님이 '늘 고치는 것'을 배운다(원장 2026-10-16).
        //   영어는 템플릿 모드라 뺀다(코퍼스 밖).
        //   AI 실패 폴백 템플릿은 AI 원문이 아니라 뺀다.
        ...(mentSource === "auto_edited" && su?.subjectKey !== "english" && autoSnap && !existing?.autoDraftTemplate ? { mentAutoDraft: autoSnap } : {}),
        // 영어 결과지 고르기(2026-09-28) — 이 화면이 아는 값만 싣는다. 모르면(안 받음) 빼서 서버가 저장해 둔 고르기를 따르게.
        ...(su?.subjectKey === "english" && jjDayKey(student.id, activeDate) in jj.picksRef.current
          ? { jjExamPick: jj.picksRef.current[jjDayKey(student.id, activeDate)] }
          : {}),
      },
    };
  }
  /**
   * 저장·발송·글 복사 직전 — 템플릿 글 그대로(다시 짤 글)이고 그 템플릿에 그림 칸이 있으면, 인재원 하루치가 오래됐을 때
   * (JJ_FRESH_MS) 새로 받는다. 수업 전에 받아 둔 '시험 0건'으로 다시 짜여 결과지 줄이 빠진 채 나가지 않게(적대 리뷰 2026-09-11).
   * 서버는 글에 자리 줄이 **있을 때만** 자료를 묶으므로, 줄을 정하는 이 순간의 자료가 곧 발송물을 정한다.
   */
  async function refreshJjBeforeOutput(student: OneScreenStudent, subjectName: string): Promise<boolean> {
    const su = student.subjects.find((x) => x.name === subjectName);
    if (su?.subjectKey !== "english") return false;
    const rep = reportsRef.current[student.id]?.[subjectName];
    const found = findTemplate(rep?.templateId, englishTemplatesRef.current);
    if (!found || !canRecompose(found, rep)) return false;
    const slots = templateImageSlots(found);
    if (!slots.length) return false;
    // 템플릿이 쓰는 그림 칸이 '없음'으로 알려져 있으면 **항상 새로** 받는다 — 내용을 잃는 건 그 방향뿐이다(3분 안에 받아 둔
    // '시험 0건'이어도 방금 본 시험이 있을 수 있다, 적대 재리뷰). 있음·모름은 신선도 규칙(3분, 실패는 1분)대로.
    // 미연결은 '방금 본 시험'이 있을 수 없어 강제하지 않는다(행마다 서버를 한 번 더 부를 이유가 없다, 적대 재리뷰).
    const cached = jj.cacheRef.current[jjDayKey(student.id, activeDate)];
    const known = cached?.status === "ok" ? jjKnownSlots(cached) : null;
    const force = !!known && slots.some((k) => known[k] === false);
    await jj.ensure(student.id, { outOfClass: rowOutOfClass(student, su), force });
    return true;
  }
  // 보고서 저장 시 그 학생 진도를 확정 처리 — 표 모드엔 카드의 '진도 확정' 버튼이 없어 상단 진도·마감 지표가
  // 0에 고정되던 문제(#13). 이미 확정이면 no-op(불필요한 autosave 방지).
  function confirmProgressOnSave(studentId: string) {
    const cur = studentsRef.current.find((s) => s.id === studentId);
    if (cur && !cur.progressConfirmed) patch(studentId, (s) => ({ ...s, progressConfirmed: true }));
  }
  /**
   * 서버가 '영상 과제' 값을 작성 선생님 것으로 두었다(report-owner.ts — 나머지는 저장됨) → 화면도 그 값으로 되돌린다.
   * 🔴 안 되돌리면 세션(임시저장)이 내 값을 쥐고 있어 새로 고쳐도 같은 값이 다시 실린다(적대 리뷰). patch가 세션도 고친다.
   */
  function applyKeptVideoHomework(studentId: string, subjectName: string,
    res: { ok?: boolean; keptVideoHomework?: boolean | null; videoHomeworkCancelled?: true; videoHomeworkSeenAt?: string }) {
    if (res.keptVideoHomework === undefined) return;
    const kept = res.keptVideoHomework;
    const keptClassId = studentsRef.current.find((s) => s.id === studentId)?.subjects.find((x) => x.name === subjectName)?.classId;
    const cancelled = !!res.videoHomeworkCancelled;
    if (cancelled) {
      // 장부에서 취소된 숙제(원장 2026-10-16) — 줄은 잠그지 않는다(다시 켜면 그때부터 선생님 값이다). 그 줄의 맞춘 시각을 응답 시각으로 옮긴다.
      if (keptClassId && res.videoHomeworkSeenAt) videoHwStore?.markSeen(studentId, keptClassId, res.videoHomeworkSeenAt);
      // 발송 경로는 서버 문장("보내지 않았습니다")이 따로 뜬다 — 저장만 한 경로에서만 알린다.
      if (res.ok) toast.message(t("os.c.videoHwCancelled"));
    } else {
      // 화면 겹(토글 잠금)을 지나 여기 온 건 그사이 남이 먼저 쓴 경우뿐이라 드물다 — 일괄 저장이어도 행마다 알린다.
      toast.message(t("os.c.videoHwKept"));
      // 그 줄을 잠금에 더한다 — 열어 두면 다시 눌러 또 되돌려진다(잠긴 줄의 체크 표시는 공급자의 저장된 값).
      if (keptClassId) videoHwStore?.markKept(studentId, keptClassId, kept);
    }
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((x) =>
        // 모름(null)은 화면 모양대로 undefined — 세션에서도 빠져 저장된 값(모름)을 따른다. 취소된 숙제는 마감 고르기도 비운다.
        x.name === subjectName ? { ...x, videoHomework: kept ?? undefined, ...(kept !== true ? { videoSubmitLink: false } : {}),
          ...(cancelled ? { videoHomeworkDue: undefined, videoHomeworkDueDate: undefined } : {}) } : x,
      ),
    }));
  }
  /**
   * 서버가 정한 영상 숙제 마감(원장 2026-10-15, due-write.ts) — '다음 수업' 날짜를 표시에 싣는다. 고른 것과 다르게 됐으면(7일로 됨 · 남이 쓴 줄)
   * 토글을 저장값으로 되돌리고 까닭을 학생 이름과 함께 알린다(일괄 저장이면 여러 줄이 뜬다 — 누구인지 보이게). 세션도 따라 고쳐진다
   * (고른 값이 남아 다음 저장에 또 실리지 않게). 남이 쓴 줄은 영상 과제와 같이 잠근다. 이 줄은 발송되지 않았다(saveAndQueueClassnote).
   */
  function applyVideoHomeworkDue(studentId: string, subjectName: string, res: { videoHomeworkDue?: SavedVideoHomeworkDue }) {
    const saved = res.videoHomeworkDue;
    if (!saved) return;
    const row = studentsRef.current.find((s) => s.id === studentId);
    const name = row?.name ?? "";
    if (saved.kept) {
      toast.message(tf("os.c.videoDueKept", { name }));
      const keptClassId = row?.subjects.find((x) => x.name === subjectName)?.classId;
      const keptVideo = row?.subjects.find((x) => x.name === subjectName)?.videoHomework;
      if (keptClassId) videoHwStore?.markKept(studentId, keptClassId, keptVideo ?? null);
    } else if (saved.fellBack === "none") toast.message(tf("os.c.videoDueFallback", { name }));
    else if (saved.fellBack === "past") toast.message(tf("os.c.videoDuePast", { name, date: saved.missed ? monthDayLabel(saved.missed) : "" }));
    else if (saved.fellBack === "error") toast.error(tf("os.c.videoDueError", { name }));
    patch(studentId, (s) => ({
      ...s,
      subjects: s.subjects.map((x) => (x.name === subjectName ? { ...x, videoHomeworkDue: saved.mode, videoHomeworkDueDate: saved.date ?? undefined } : x)),
    }));
  }
  // ── 저장·발송 코어(카드·표 공용) — (학생,과목) 저장/큐잉 + reports state 반영. ──
  async function saveRecord(student: OneScreenStudent, subjectName: string, mode: SendMode = "single") {
    // 이중 방어(진입부들이 이미 막지만 새 진입부 대비) — 호출부가 res를 바로 쓰므로 실패 객체로 반환.
    if (readonlyView) return { ok: false, error: READONLY_TEACHER_VIEW_ERROR };
    const waited = await refreshJjBeforeOutput(student, subjectName);
    const built = buildSaveInputFor(waited ? latestStudent(student, subjectName) : student, subjectName);
    const res = await saveLessonReport(built.input);
    if (res.id) queueWriteTiming(res.id, activeDate, student.id, subjectName, { view: writeView(), mode, queued: false });
    applyKeptVideoHomework(student.id, subjectName, res);
    applyVideoHomeworkDue(student.id, subjectName, res);
    if (res.ok) {
      notifyMakeupEffect(res.makeupEffect);
      // shareToken 보존 → report-card가 학부모 공개 링크(/r/[token])를 노출·복사. 기존 첨부·상태는 유지(merge).
      // 🔴 **초안은 건드리지 않는다** — 저장은 화면 값을 DB로 옮기는 일이지 멘트를 새로 쓰는 일이 아니다.
      //    예전엔 `built.draft`를 되써 넣었고, 멘트가 빈 행에선 그게 **템플릿을 몰래 채우는 통로**였다
      //    (buildSaveInputFor 주석 — 4일치 발송분 22%가 강사가 쓴 적 없는 문장이었다).
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        sent: true,
        shareToken: res.shareToken ?? r.shareToken,
      }));
      confirmProgressOnSave(student.id); // 보고서 저장=진도 확정(표 모드엔 확정 버튼이 없어 지표 0 고정되던 문제, #13)
    }
    return res;
  }
  async function queueOne(student: OneScreenStudent, subjectName: string, mode: SendMode = "single") {
    // 이중 방어 — saveRecord와 같은 이유(호출부 계약 유지: 실패 객체 반환).
    if (readonlyView) return { ok: false, error: READONLY_TEACHER_VIEW_ERROR };
    const waited = await refreshJjBeforeOutput(student, subjectName);
    const built = buildSaveInputFor(waited ? latestStudent(student, subjectName) : student, subjectName);
    let res = await saveAndQueueClassnote(built.input);
    // 반별 발송인데 보강 보고서의 보낼 반을 서버가 못 정했다(또는 보강 추가한 반에 반 보드가 없어 다른 반으로 가야 한다 —
    // 경고 한 줄과 함께 묻는다) — 강사가 고르면 그 반으로 다시 보낸다(저장은 이미 끝났다).
    if (res.status === "needs_class" && res.candidates?.length) {
      const picked = await askSendClass({
        studentName: student.name,
        candidates: res.candidates,
        defaultId: res.defaultClassId ?? null,
        makeupClassName: res.makeupClassName ?? null,
      });
      // 🔴 고른 반 = **새 보강 반**(원장 2026-09-30 *"보고서 반 = 출석부 반"*) — 저장이 출석부 칸도 그 반으로 옮기고 그 반으로 보낸다.
      //    '보낼 반'만 따로 적는 길(`classnoteClassId`)은 없앴다 — 보고서 반과 출석부 반이 갈렸다.
      if (picked) {
        const pickedName = res.candidates.find((c) => c.id === picked)?.name ?? null;
        res = await saveAndQueueClassnote({ ...built.input, makeupClassId: picked });
        // 저장이 받아들였을 때만(반을 거절하면 오류 문장만 돌아온다 — id가 없거나 ok=false + 그 문장) 카드의 보강 반을 바꾼다.
        if (res.ok || (res.id && res.status !== undefined)) {
          patch(student.id, (s) => ({
            ...s,
            subjects: s.subjects.map((x) =>
              x.name === subjectName ? { ...x, makeupClassId: picked, makeupClassName: pickedName ?? x.makeupClassName ?? null } : x,
            ),
          }));
        }
      }
    }
    // 작성 시간 기록(write-timing-store) — 저장된 보고서만(발송이 막혀도 저장됐으면 그때까지 쓴 시간이다).
    if (res.id) queueWriteTiming(res.id, activeDate, student.id, subjectName, { view: writeView(), mode, queued: res.ok });
    applyKeptVideoHomework(student.id, subjectName, res);
    applyVideoHomeworkDue(student.id, subjectName, res);
    // 보낼 반 안내는 강사뷰 언어로(서버 문장은 한국어 폴백) — status로 사전 키를 고른다.
    notifyMakeupEffect(res.makeupEffect);
    const sendClassKey =
      res.status === "board_missing"
        ? "os.c.boardMissing"
        : res.status === "board_enrolling"
          ? "os.c.boardEnrolling"
          : res.status === "board_enrolling_auto"
            ? "os.c.boardEnrollingAuto"
            : res.status === "board_class_pending"
              ? "os.c.boardClassPending"
              : res.status === "board_hold_recheck"
              ? "os.c.boardHoldRecheck"
              : res.status === "board_hold"
                ? "os.c.boardHold"
                : res.status === "board_hold_admin"
                ? "os.c.boardHoldAdmin"
                : res.status === "board_left"
                  ? "os.c.boardLeft"
                  : res.status === "no_class"
                    ? "os.c.noSendClass"
                    : res.status === "needs_class"
                      ? "os.c.chooseSendClass"
                      : res.status === "class_check_failed"
                        ? "os.c.sendClassCheckFail"
                        : null;
    // 배정 보류 안내는 사유(연동 PC가 적은 문장)를 끼운다 — 나머지 문장엔 자리가 없어 그대로다.
    if (!res.ok && sendClassKey) res = { ...res, error: tf(sendClassKey, { reason: res.boardHoldReason ?? "" }) };
    // 서버가 그 반 동기화를 요청했다 — 몇 분 동안 C.N 아이콘을 짧은 주기로 다시 본다(배정되면 새로고침 없이 체크로 바뀐다).
    if (cnSyncRequested(res.status)) boostClassnoteMatch();
    if (res.ok) {
      // ⚠️ 응답 status에는 DB 상태가 아닌 **결과 코드**도 섞여 있다(dry_run·subject_off·absent·already_sent).
      //    그중 `already_sent`를 그대로 배지 state에 넣으면 "success가 아니게" 되어 발송 가드가 스스로 풀린다
      //    → 그 행의 **실제** DB 상태인 success로 되돌려 저장한다.
      const badgeStatus = res.status === "already_sent" ? "success" : res.status;
      patchReport(student.id, subjectName, (r) => ({
        ...r,
        sent: true,
        shareToken: res.shareToken ?? r.shareToken,
        classnoteStatus: badgeStatus,
      }));
      confirmProgressOnSave(student.id);
    } else if (res.id) {
      // 저장은 됐는데 **발송만** 막힌 경우(그림 자리뿐인 영어 글 등) — 저장된 상태·공유 링크는 반영한다(적대 재리뷰).
      patchReport(student.id, subjectName, (r) => ({ ...r, sent: true, shareToken: res.shareToken ?? r.shareToken }));
      confirmProgressOnSave(student.id); // 저장은 됐다 — saveRecord와 같은 규약(보고서 저장 = 진도 확정)
    }
    return res;
  }
  return {
    sendClassAsk,
    setSendClassAsk,
    askSendClass,
    buildSaveInputFor,
    refreshJjBeforeOutput,
    applyKeptVideoHomework,
    applyVideoHomeworkDue,
    saveRecord,
    queueOne,
  };
}
