import { toast } from "sonner";
import { reportOptoutNotice } from "@/features/classes/report-optout";
import type { OneScreenStudent } from "../types";
import type { SendCore } from "./use-bulk-send";
import type { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 카드·표 행 ClassNote 발송의 **결과 알림** — 수정 계획 P3-O batch D, `use-report-send.ts`에서 나눔(본문 그대로).
 * 저장·발송 코어(queueOne)가 성공으로 돌려준 응답의 결과 코드를 강사뷰 언어 문구로 푼다. 카드(과목 이름)와 표 행(학생 이름)은
 * 문구·순서가 달라 **따로** 둔다(합치지 않는다). 실패(`!res.ok`)는 부르는 쪽이 먼저 알리고 여기 오지 않는다.
 */
type QueueResult = Awaited<ReturnType<SendCore["queueOne"]>>;
type NoticeCtx = {
  classnoteOn: boolean;
  lang: ReturnType<typeof useSheetLang>;
  t: ReturnType<typeof useSheetT>;
  tf: ReturnType<typeof useSheetTf>;
};

/** 카드 ClassNote 발송(queueClassnote) 결과 — 막힌 코드는 저마다 알리고 멈춘다(아래 폴스루가 '대기 중' 성공으로 오인하지 않게). */
export function notifyCardQueueResult(res: QueueResult, subjectName: string, { classnoteOn, lang, t, tf }: NoticeCtx) {
  if (res.warning) toast.message(res.warning); // 영어 그림 자료를 못 묶었다(서버 문장)
  if (res.status === "recall_pending") {
    toast.error(tf("os.c.recallingSubject", { subject: subjectName }));
    return;
  }
  if (res.status === "revoked") {
    toast.error(tf("os.c.revokedSubject", { subject: subjectName }));
    return;
  }
  if (res.status === "name_conflict") {
    toast.error(
      tf("os.c.nameConflictSubject", { subject: subjectName }),
    );
    return;
  }
  if (res.status === "dry_run") {
    // ClassNote 기능이 없는 학원 = 발송이라는 개념이 없다 → 그냥 "저장됨"(dry-run 문구 금지, 2026-09-30).
    toast.message(classnoteOn ? tf("os.c.dryRunSubject", { subject: subjectName }) : tf("os.c.savedRecord", { subject: subjectName }));
    return;
  }
  // 발송 대상 과목이 아님(원장 설정 classnoteSubjects 밖) — 저장만 되고 큐에 안 들어감. 성공으로 오인 방지.
  if (res.status === "subject_off") {
    toast.message(tf("os.c.subjectOff", { subject: subjectName }));
    return;
  }
  // '수업보고서 미발송' 반 게이트(서버판, 2026-08-19) — 여기서 안 잡으면 아래 폴스루가 "대기 중"
  // 성공 토스트를 띄운다(서버가 방금 거절한 발송을 성공으로 오인).
  if (res.status === "report_optout") {
    toast.message(tf("os.c.optoutSubject", { subject: subjectName, notice: reportOptoutNotice(lang) }));
    return;
  }
  // 결석 게이트(#77 서버판) — 버튼 disabled를 우회한 경로(반 모호 행·stale 화면)도 서버가 막는다.
  if (res.status === "absent") {
    toast.message(tf("os.c.absentSubject", { subject: subjectName }));
    return;
  }
  // 출결 미체크 게이트(서버판, 2026-08-17) — 여기서 안 잡으면 아래 폴스루가 "대기 중" 성공 토스트를
  // 띄운다(서버가 방금 거절한 발송을 성공으로 오인 — 적대 리뷰 확정). 표 sendRow와 동일 안내.
  if (res.status === "no_attendance") {
    toast.message(tf("os.c.uncheckedSubject", { subject: subjectName }));
    return;
  }
  // 이미 게시된 건(중복 게시 차단) — 저장도 안 했으므로 "내용을 고쳤다면 저장부터"를 함께 안내한다.
  if (res.status === "already_sent") {
    toast.message(
      tf("os.c.alreadySentSubject", { subject: subjectName }),
    );
    return;
  }
  const msg =
    res.status === "queued"
      ? res.sendWindowHint
        ? tf("os.c.queuedWindow", { hint: res.sendWindowHint })
        : t("os.c.queuedWaiting")
      : res.status === "success"
        ? t("os.c.statusSuccess")
        : res.status === "processing"
          ? t("os.c.statusProcessing")
          : res.status === "too_old"
            ? t("os.c.statusTooOld")
            : t("os.c.statusWaiting");
  toast.success(tf("os.c.queueResult", { subject: subjectName, msg }));
}

/** 표 행 발송(sendRow) 결과. */
export function notifyRowQueueResult(
  res: QueueResult,
  student: Pick<OneScreenStudent, "name">,
  subjectName: string,
  { classnoteOn, lang, tf }: NoticeCtx,
) {
  if (res.warning) toast.message(res.warning); // 영어 그림 자료를 못 묶었다(서버 문장)
  if (res.status === "name_conflict") {
    toast.error(tf("os.c.nameConflictRow", { name: student.name }));
  } else if (res.status === "recall_pending") {
    toast.error(tf("os.c.recallingRow", { name: student.name }));
  } else if (res.status === "revoked") {
    toast.error(tf("os.c.revokedRow", { name: student.name }));
  } else if (res.status === "too_old") {
    toast.message(tf("os.c.tooOldRow", { name: student.name }));
  } else if (res.status === "dry_run") {
    toast.message(classnoteOn ? tf("os.c.dryRunRow", { name: student.name }) : tf("os.c.savedRow", { name: student.name }));
  } else if (res.status === "subject_off") {
    // 발송 대상 과목이 아님 — 저장만 됨. "발송 대기" 성공 오안내 방지(#2 확정).
    toast.message(tf("os.c.subjectOffRow", { name: student.name, subject: subjectName }));
  } else if (res.status === "report_optout") {
    // 미발송 반 게이트(서버판, 2026-08-19) — 화면 게이트를 지난 경로(stale 화면)도 서버가 막는다.
    toast.message(
      tf("os.c.optoutRow", {
        name: student.name,
        subject: subjectName,
        notice: reportOptoutNotice(lang),
      }),
    );
  } else if (res.status === "absent") {
    // 결석 게이트(#77 서버판) — 반 모호(attendanceRaw 미채움) 행 등 클라 게이트 사각을 서버가 막은 경우.
    toast.message(tf("os.c.absentRow", { name: student.name }));
  } else if (res.status === "no_attendance") {
    // 출결 미체크 게이트(서버판, 2026-08-17) — stale 화면 등 클라 게이트 사각을 서버가 막은 경우.
    toast.message(tf("os.c.uncheckedRow", { name: student.name }));
  } else if (res.status === "already_sent") {
    // 중복 게시 차단(서버판) — 화면 게이트를 지난 경로(stale 화면·다른 창에서 먼저 발송)도 서버가 막는다.
    toast.message(tf("os.c.alreadySentRow", { name: student.name, subject: subjectName }));
  } else if (res.status === "queued" && res.sendWindowHint) {
    // 발송 허용 시간창 밖 — 큐엔 정상 적재, 워커가 창 진입 시 자동 발송("왜 안 나가지?" 재발송 혼란 방지).
    toast.success(
      tf("os.c.queuedWindowRow", {
        name: student.name,
        subject: subjectName,
        hint: res.sendWindowHint,
      }),
    );
  } else {
    toast.success(tf("os.c.queuedRow", { name: student.name, subject: subjectName }));
  }
}
