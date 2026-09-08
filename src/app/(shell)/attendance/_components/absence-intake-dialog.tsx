"use client";

/**
 * 결석 통보 접수 창 — 데스크가 학부모 전화를 받는 **그 자리에서** 끝내는 화면.
 *
 * 학생 검색 → 기간 → 사유 → **대상 칸 미리보기**(어느 반 몇 칸) → 저장. 전화 한 통이 보통 여러 칸이라
 * (여러 반 × 여러 날 × 영어는 교시별) 눈으로 확인하지 않으면 "덜 찍혔는지" 알 길이 없어 미리보기가 필수다.
 *
 * ⚠️ 미리보기는 **이벤트에서만** 부른다(effect에서 setState 금지 — React 19 룰, [[#25]]).
 * ⚠️ 목록에 이미 기록이 있는 칸도 **보여준다**(빼지 않는다) — 출석으로 잘못 찍힌 칸을 데스크가
 *    알아채야 하기 때문. 그 칸은 서버가 건너뛰고 결과에 사유를 돌려준다.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatKoreanDate } from "@/lib/date-kst";
// 색은 의미에만 — 배지/글자 색은 화면 파일이 아니라 의미색 캐논에서 고른다(팔레트 v4 규칙).
import { TONE_TEXT } from "@/lib/design/semantic-color";
import { attendanceStatusLabel } from "@/features/attendance/intake/absence-intake";
import type { IntakePreviewCell } from "@/features/attendance/intake/server/queries";
import {
  previewAbsenceIntake,
  recordAbsenceIntake,
  searchIntakeStudents,
  type IntakeStudentSearch,
} from "@/features/attendance/intake/server/actions";

type Student = { id: string; name: string; label: string };

/**
 * 검색 결과 초기값 — 목록이 비었을 때의 안내(note)는 **서버가 만든 문장만** 쓴다(화면이 지어내지 않는다).
 * ⚠️ "use server" 모듈에서는 상수를 못 내보내므로(async 함수만) 여기서 만든다.
 */
const EMPTY_SEARCH: IntakeStudentSearch = { students: [], note: null, truncated: false };

/** 자주 오는 사유 — 타이핑을 줄이되 **문장은 그대로 메모가 되므로** 고칠 수 있게 둔다. */
const QUICK_REASONS = ["가족여행", "병결(감기)", "개인 사정", "학교 행사", "병원 진료"];

/** 칸의 현재 상태 문구 — 라벨은 접수 모듈 **한 벌**에서 오고 여기선 문장만 만든다(사본 금지). */
function existingText(status: string): string {
  return status === "absent" ? "이미 결석" : `현재 ${attendanceStatusLabel(status)}`;
}

export function AbsenceIntakeDialog({ today, onClose }: { today: string; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<IntakeStudentSearch>(EMPTY_SEARCH);
  const [student, setStudent] = useState<Student | null>(null);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [cells, setCells] = useState<IntakePreviewCell[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // ⚠️ 검색과 미리보기는 **각자 카운터**를 쓴다 — 하나를 공유하면 미리보기 요청이 검색 응답을 버리고
  //    (그 반대도) 목록이 조용히 비어 보인다. 늦게 온 옛 응답이 최신 결과를 덮지 않게만 하면 된다.
  const searchSeq = useRef(0);
  const previewSeq = useRef(0);

  function runSearch(term: string) {
    setQ(term);
    if (timer.current) clearTimeout(timer.current);
    if (!term.trim()) {
      setResults(EMPTY_SEARCH);
      return;
    }
    const mine = ++searchSeq.current;
    timer.current = setTimeout(() => {
      void searchIntakeStudents(term)
        .then((r) => {
          if (mine === searchSeq.current) setResults(r);
        })
        .catch(() => {
          // 액션이 던지면(네트워크·배포 교체) 목록이 옛 상태로 남는다 — 사유를 보여준다.
          if (mine === searchSeq.current) {
            setResults({
              students: [],
              note: "학생을 찾는 중 오류가 났습니다 — 잠시 후 다시 시도해 주세요",
              truncated: false,
            });
          }
        });
    }, 250);
  }

  function loadPreview(next: { student: Student | null; from: string; to: string }) {
    if (!next.student) return;
    setLoading(true);
    const mine = ++previewSeq.current;
    void previewAbsenceIntake({ studentId: next.student.id, from: next.from, to: next.to })
      .then((p) => {
        if (mine !== previewSeq.current) return;
        setCells(p.cells);
        setPreviewError(p.error);
        setExcluded(new Set());
      })
      .catch(() => {
        // 서버가 던지면(네트워크·배포 교체 등) 목록이 조용히 옛 상태로 남는다 — 사유를 보여준다.
        if (mine !== previewSeq.current) return;
        setCells([]);
        setPreviewError("대상 수업을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요");
      })
      .finally(() => setLoading(false));
  }

  function pickStudent(s: Student) {
    setStudent(s);
    setResults(EMPTY_SEARCH);
    setQ("");
    loadPreview({ student: s, from, to });
  }

  function changeDate(which: "from" | "to", value: string) {
    // 시작일을 종료일보다 뒤로 밀면 종료일도 함께 민다 — 뒤집힌 범위로 "대상 없음"을 보여주지 않는다.
    const nextFrom = which === "from" ? value : from;
    const nextTo = which === "to" ? value : to < value ? value : to;
    setFrom(nextFrom);
    setTo(nextTo);
    loadPreview({ student, from: nextFrom, to: nextTo });
  }

  const targets = cells.filter((c) => !excluded.has(c.key));
  const blocked = !student || !reason.trim() || targets.length === 0 || saving;

  async function save() {
    if (!student) return;
    setSaving(true);
    const res = await recordAbsenceIntake({
      studentId: student.id,
      from,
      to,
      reason,
      exclude: [...excluded],
    });
    setSaving(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    const bits = [
      res.saved > 0 ? `${res.saved}칸 결석 처리` : null,
      res.noted > 0 ? `${res.noted}칸 사유 추가` : null,
      res.skipped.length > 0 ? `${res.skipped.length}칸 건너뜀` : null,
      res.failed.length > 0 ? `${res.failed.length}칸 실패` : null,
    ].filter(Boolean);
    // 아무것도 안 찍혔는데 초록 성공 토스트를 띄우면 "다 됐다"로 읽힌다 — 그 경우는 중립 토스트.
    const wrote = res.saved + res.noted > 0;
    (wrote ? toast.success : toast.message)(`${student.name} 결석 접수 — ${bits.join(" · ")}`);
    if (res.queueMarkFailed) {
      toast.warning("당일 출결 큐의 '처리됨' 표시를 남기지 못했습니다 — 그날 큐에서 직접 확인 처리해 주세요.");
    }
    if (res.skipped.length > 0) {
      // 조용히 넘기지 않는다 — 무엇이 왜 안 됐는지 데스크가 알아야 출석부에서 손볼 수 있다.
      toast.message(
        `이미 기록이 있어 건너뛴 칸: ${res.skipped
          .map((s) => `${s.className}(${s.date.slice(5)} ${s.statusLabel})`)
          .join(", ")}`,
      );
    }
    if (res.failed.length > 0) {
      // 실패는 성공 토스트에 묻히면 안 된다 — 그 칸은 아무도 안 찍은 채로 남는다.
      toast.error(
        `저장 실패: ${res.failed.map((f) => `${f.className}(${f.date.slice(5)}) ${f.message}`).join(" / ")}`,
      );
    }
    router.refresh();
    onClose();
  }

  const byDate = new Map<string, IntakePreviewCell[]>();
  for (const c of cells) {
    const list = byDate.get(c.date);
    if (list) list.push(c);
    else byDate.set(c.date, [c]);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-background border-line max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="결석 통보 접수"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-foreground text-sm font-bold">결석 통보 접수</h2>
        <p className="text-text-dim mt-1 text-xs leading-relaxed">
          학부모 연락을 받은 그대로 남깁니다. 저장하면 출석부·ECS·원스크린·당일 출결에 결석과 사유가 함께
          뜨고, 담당 강사에게 &quot;처리 완료&quot; 알림이 갑니다.
        </p>

        {/* ① 학생 */}
        <div className="mt-4">
          <label className="text-text-dim text-xs font-bold" htmlFor="intake-student">
            학생
          </label>
          {student ? (
            <div className="border-line mt-1 flex items-center justify-between rounded-lg border px-3 py-2">
              <span className="text-foreground text-sm font-bold">
                {student.name}
                {student.label ? <span className="text-text-dim ml-1.5 font-normal">{student.label}</span> : null}
              </span>
              <button
                type="button"
                className="text-text-dim hover:text-foreground text-xs underline"
                onClick={() => {
                  setStudent(null);
                  setCells([]);
                  setPreviewError(null);
                }}
              >
                변경
              </button>
            </div>
          ) : (
            <>
              <input
                id="intake-student"
                autoFocus
                value={q}
                onChange={(e) => runSearch(e.target.value)}
                placeholder="학생 이름 검색"
                className="border-line bg-bg-soft focus:border-primary mt-1 h-9 w-full rounded-lg border px-3 text-sm outline-none"
              />
              {results.students.length > 0 ? (
                <ul className="border-line mt-1 max-h-40 overflow-y-auto rounded-lg border">
                  {results.students.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => pickStudent(s)}
                        className="hover:bg-bg-soft flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                      >
                        <span className="font-bold">{s.name}</span>
                        <span className="text-text-dim text-xs">{s.label}</span>
                      </button>
                    </li>
                  ))}
                  {results.truncated ? (
                    // 자른 사실을 밝힌다 — 20명만 보여주고 "이게 전부"인 척하면 데스크가 없는 학생으로 오해한다.
                    <li className="text-text-faint px-3 py-1.5 text-xs">
                      맞는 학생이 더 있습니다 — 이름을 더 입력해 좁혀 주세요.
                    </li>
                  ) : null}
                </ul>
              ) : results.note ? (
                // 왜 비었는지 한 줄(문구는 서버가 만든다) — 오타인지 조건인지 데스크가 구분해야 한다.
                <p className="text-text-dim mt-1.5 text-xs leading-relaxed">{results.note}</p>
              ) : null}
            </>
          )}
        </div>

        {/* ② 기간 */}
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label className="text-text-dim text-xs font-bold" htmlFor="intake-from">
              시작일
            </label>
            <input
              id="intake-from"
              type="date"
              value={from}
              onChange={(e) => changeDate("from", e.target.value)}
              className="border-line bg-bg-soft focus:border-primary mt-1 h-9 w-full rounded-lg border px-2 text-sm outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="text-text-dim text-xs font-bold" htmlFor="intake-to">
              종료일
            </label>
            <input
              id="intake-to"
              type="date"
              value={to}
              min={from}
              onChange={(e) => changeDate("to", e.target.value)}
              className="border-line bg-bg-soft focus:border-primary mt-1 h-9 w-full rounded-lg border px-2 text-sm outline-none"
            />
          </div>
        </div>

        {/* ③ 사유 — 이 문장이 그대로 출결 메모가 된다 */}
        <div className="mt-3">
          <label className="text-text-dim text-xs font-bold" htmlFor="intake-reason">
            사유 (출석부 메모로 저장됩니다)
          </label>
          <input
            id="intake-reason"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 제주도 가족여행"
            className="border-line bg-bg-soft focus:border-primary mt-1 h-9 w-full rounded-lg border px-3 text-sm outline-none"
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className="border-line text-text-dim hover:bg-bg-soft rounded-full border px-2 py-0.5 text-xs"
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* ④ 미리보기 */}
        <div className="mt-4">
          <p className="text-text-dim text-xs font-bold">
            대상 수업 {loading ? "확인 중…" : `${targets.length}칸`}
          </p>
          {previewError ? (
            <p className="text-danger mt-1 text-xs">{previewError}</p>
          ) : !student ? (
            <p className="text-text-faint mt-1 text-xs">학생을 먼저 고르세요.</p>
          ) : cells.length === 0 && !loading ? (
            <p className="text-text-faint mt-1 text-xs">그 기간에 이 학생의 수업이 없습니다.</p>
          ) : (
            <div className="border-line mt-1 max-h-52 space-y-2 overflow-y-auto rounded-lg border p-2">
              {[...byDate.entries()].map(([date, list]) => (
                <div key={date}>
                  <p className="text-text-dim text-xs font-bold">{formatKoreanDate(date)}</p>
                  {list.map((c) => (
                    <label key={c.key} className="hover:bg-bg-soft flex items-center gap-2 rounded px-1 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={!excluded.has(c.key)}
                        onChange={(e) => {
                          const next = new Set(excluded);
                          if (e.target.checked) next.delete(c.key);
                          else next.add(c.key);
                          setExcluded(next);
                        }}
                      />
                      <span className="text-foreground font-bold">{c.className}</span>
                      <span className="text-text-dim num">
                        {c.periodStart}
                        {c.slotCount > 1 ? ` 외 ${c.slotCount - 1}교시` : ""}
                      </span>
                      {c.teacherLabel ? <span className="text-text-faint">{c.teacherLabel}</span> : null}
                      {c.existing ? (
                        <span
                          className={
                            // 이미 결석 = 할 일 없음(옅게) / 출석·지각·보강 = **내가 판단해야 하는 칸**(caution).
                            c.existing.status === "absent"
                              ? "text-text-faint ml-auto"
                              : `${TONE_TEXT.caution} ml-auto font-bold`
                          }
                        >
                          {existingText(c.existing.status)}
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => void save()} disabled={blocked}>
            {saving ? "접수 중…" : `결석 접수 (${targets.length}칸)`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
