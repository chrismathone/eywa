import { FileText } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { REPORT_STATUS } from "@/features/withdrawal-reports/model";
import type {
  StudentArchiveItem,
  StudentReportItem,
  StudentReportRecords,
} from "@/features/withdrawal-reports/server/student-records";
import { DetailCard } from "./detail-card";

const LINK = "text-primary font-medium hover:underline";
const META = "text-muted-foreground text-xs";

/**
 * 퇴원 상세 '퇴원보고서' 카드 — 새 보고서(요청 묶음째)와 기존 원본을 그대로 나열한다(원장 2026-10-23).
 * 작성 입구는 없다: 이미 퇴원한 학생은 작성 요청 후보에서 빠지고 DB도 요청을 거절한다(0420a).
 */
export function LinkedReportsCard({
  records,
  studentName,
  labels,
}: {
  records: Exclude<StudentReportRecords, { status: "hidden" }>;
  studentName: string;
  /** 과목 키 → 라벨(`subjectLabelRecord`) — 모르는 키는 '기타 과목'(보고서 상세와 같다 · 영문 키를 내지 않는다). */
  labels: Record<string, string>;
}) {
  const labelOf = (key: string) => labels[key] ?? "기타 과목";
  return (
    <DetailCard title="퇴원보고서" icon={<FileText className="size-3.5" />}>
      {records.status === "not_ready" ? (
        <p className="text-muted-foreground text-sm">퇴원보고서 기능을 준비 중입니다. 준비가 끝나면 여기에 보입니다.</p>
      ) : records.status === "error" ? (
        <p role="alert" className="text-muted-foreground text-sm">퇴원보고서를 불러오지 못했습니다 — 새로고침해 주세요.</p>
      ) : records.reports.length === 0 && records.archives.length === 0 ? (
        <div className="space-y-1 text-sm">
          {/* 다 보는 사람만 '없다'고 단정한다 — 참여한 보고서만 보는 사람에겐 '볼 수 있는' 것이 없을 뿐이다. */}
          <p className="text-muted-foreground">
            {records.complete ? "이 학생의 퇴원보고서가 없습니다." : "볼 수 있는 퇴원보고서가 없습니다."}
          </p>
          <p className={META}>학생과 연결되지 않은 기존 기록이 있을 수 있습니다.</p>
          <WindowLink href={`/withdrawal-reports?q=${encodeURIComponent(studentName)}`} className={LINK}>
            퇴원보고서 목록에서 이름으로 찾기
          </WindowLink>
        </div>
      ) : (
        <ul className="divide-border divide-y text-sm">
          {groupByRequest(records.reports).map((group) => (
            <li key={group[0].groupId} className="space-y-2 py-2 first:pt-0 last:pb-0">
              {group.length > 1 ? <p className={META}>한 요청 · 담임별 보고서 {group.length}건</p> : null}
              {group.map((r) => (
                <ReportLine key={r.id} report={r} labelOf={labelOf} />
              ))}
            </li>
          ))}
          {records.archives.map((a) => (
            <li key={a.id} className="py-2 first:pt-0 last:pb-0">
              <ArchiveLine archive={a} labelOf={labelOf} />
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}

/** 같은 요청 묶음끼리(조회 순서 = 요청 최신순을 지킨다). */
function groupByRequest(reports: StudentReportItem[]): StudentReportItem[][] {
  const groups = new Map<string, StudentReportItem[]>();
  for (const r of reports) groups.set(r.groupId, [...(groups.get(r.groupId) ?? []), r]);
  return [...groups.values()];
}

function ReportLine({ report: r, labelOf }: { report: StudentReportItem; labelOf: (key: string) => string }) {
  return (
    <div>
      <WindowLink href={`/withdrawal-reports/${r.id}`} className={LINK}>
        {r.exitKind === "withdrawal" ? "퇴원" : "과목 수강종료"}
        {r.subjects.length ? ` · ${r.subjects.map(labelOf).join(" · ")}` : ""}
      </WindowLink>
      <p className={META}>
        {/* 보고서 날짜 = 마지막 수업일(원장 2026-11-03 — 퇴원보고서 화면과 같은 이름). */}
        {r.statusLabel || REPORT_STATUS[r.status] || "상태 확인 필요"} · 마지막 수업일 <span className="num">{r.effectiveDate}</span> ·{" "}
        {/* 관리자 바로 처리(강사 작성 없이, 원장 2026-10-23) — 작성한 담임이 없다. */}
        {r.direct ? "관리자 바로 처리" : <>담임 {r.teacherName ?? "—"}</>}
      </p>
    </div>
  );
}

function ArchiveLine({ archive: a, labelOf }: { archive: StudentArchiveItem; labelOf: (key: string) => string }) {
  return (
    <div>
      <WindowLink href={`/withdrawal-reports/archive/${a.id}`} className={LINK}>
        기존 기록 · {a.subject ? labelOf(a.subject) : "과목 미기재"}
      </WindowLink>
      <p className={META}>
        종료일 <span className="num">{a.exitDate ?? (a.rawExitDate || "미기재")}</span> · 담임 {a.teacherName || "—"}
        {a.className ? ` · ${a.className}` : ""}
      </p>
    </div>
  );
}
