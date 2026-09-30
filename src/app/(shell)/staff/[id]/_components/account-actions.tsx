"use client";

import { useActionState, useState } from "react";
import { KeyRound, Mail, ShieldCheck, Trash2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { EmailIdField } from "@/components/forms/email-id-field";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { changeStaffRole } from "@/features/staff/server/actions";
import type { AssistClassRow, HomeroomClassRow } from "@/features/staff/server/queries";
import {
  changeStaffEmail,
  deleteStaff,
  resetStaffPassword,
} from "@/features/staff/server/account-actions";
import { Footer, Modal, SubmitBtn } from "./dialog-bits";
import { DeactivateButton } from "./deactivate-button";
import type { HandoverTeacher } from "./offboard-dialog";

const INPUT = "border-border bg-card text-foreground w-full rounded-md border px-2.5 py-1.5 text-sm";

function EmailDialog({
  staffId,
  currentEmail,
  onClose,
}: {
  staffId: string;
  currentEmail: string;
  onClose: () => void;
}) {
  const [state, action] = useActionState(changeStaffEmail, undefined);
  if (state?.ok) queueMicrotask(onClose); // 부모는 revalidatePath로 갱신됨
  return (
    <Modal title="이메일 변경" desc={`현재: ${currentEmail}`} onClose={onClose}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={staffId} />
        {/* 아이디만 고치고 도메인은 고정 — 전체 주소 타이핑은 오타 한 글자로 로그인이 막힌다. */}
        <EmailIdField defaultEmail={currentEmail} inputClassName={INPUT} />
        {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
        <Footer onClose={onClose}>
          <SubmitBtn label="변경" />
        </Footer>
      </form>
    </Modal>
  );
}

function PasswordDialog({
  staffId,
  displayName,
  onClose,
}: {
  staffId: string;
  displayName: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"temp" | "custom">("temp");
  const [state, action] = useActionState(resetStaffPassword, undefined);

  if (state?.ok) {
    return (
      <Modal title="비밀번호 재설정" desc={displayName} onClose={onClose}>
        <div className="space-y-3">
          {state.tempPassword ? (
            <>
              <p className="text-foreground text-sm">임시 비밀번호가 발급되었습니다. 직원에게 안내하세요:</p>
              <code className="bg-bg-soft text-foreground num block rounded px-3 py-2 text-sm select-all">
                {state.tempPassword}
              </code>
            </>
          ) : (
            <p className="text-chart-2 text-sm">비밀번호가 변경되었습니다.</p>
          )}
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="비밀번호 재설정" desc={displayName} onClose={onClose}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={staffId} />
        <input type="hidden" name="mode" value={mode} />
        <div className="flex gap-1.5">
          {(["temp", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                mode === m
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:bg-bg-soft"
              }`}
            >
              {m === "temp" ? "임시 발급" : "직접 설정"}
            </button>
          ))}
        </div>
        {mode === "custom" ? (
          <div className="space-y-1">
            {/* type=text는 의도 — 원장이 직원에게 불러주는 값이라 가리지 않는다(디자인 규약 '비밀번호 입력'). */}
            <input
              name="password"
              type="text"
              minLength={8}
              required
              placeholder="새 비밀번호"
              className={INPUT}
            />
            {/* 안내를 placeholder로만 두면 타이핑을 시작하는 순간 사라져, 브라우저 기본 말풍선이 유일한 안내가 된다. */}
            <p className="text-text-dim text-xs">8자 이상. 직원에게 그대로 불러주세요.</p>
          </div>
        ) : (
          <p className="text-text-dim text-xs">무작위 임시 비밀번호를 생성해 1회 표시합니다.</p>
        )}
        {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
        <Footer onClose={onClose}>
          <SubmitBtn label="재설정" />
        </Footer>
      </form>
    </Modal>
  );
}

function RoleDialog({
  staffId,
  displayName,
  currentRole,
  roleOptions,
  onClose,
}: {
  staffId: string;
  displayName: string;
  currentRole: SystemRole;
  roleOptions: SystemRole[];
  onClose: () => void;
}) {
  const [state, action] = useActionState(changeStaffRole, undefined);
  if (state?.ok) queueMicrotask(onClose); // 부모는 revalidatePath로 갱신됨
  return (
    <Modal
      title="역할 변경"
      desc={`${displayName} · 현재: ${ROLE_LABEL[currentRole] ?? currentRole}`}
      onClose={onClose}
    >
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={staffId} />
        <select name="newRole" defaultValue={currentRole} className={INPUT}>
          {roleOptions.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r] ?? r}
            </option>
          ))}
        </select>
        <p className="text-text-dim text-xs">본인보다 낮은 역할만 부여할 수 있습니다.</p>
        {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
        <Footer onClose={onClose}>
          <SubmitBtn label="변경" />
        </Footer>
      </form>
    </Modal>
  );
}

function DeleteDialog({
  staffId,
  displayName,
  homeroomCount,
  onClose,
}: {
  staffId: string;
  displayName: string;
  homeroomCount: number;
  onClose: () => void;
}) {
  const [state, action] = useActionState(deleteStaff, undefined);
  // 성공 시 서버가 /staff로 redirect — 에러만 돌아온다.
  return (
    <Modal title="직원 삭제" desc={`${displayName} 계정을 완전히 삭제합니다.`} onClose={onClose}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={staffId} />
        {homeroomCount > 0 ? (
          <p className="text-amber text-xs font-medium">
            이 직원이 담임인 진행중인 반이 {homeroomCount}개 있습니다. 삭제하면 그 반들의 담임이
            비워집니다 — 먼저 각 반에서 강사 인수인계를 진행하세요.
          </p>
        ) : null}
        <p className="text-text-dim text-xs">
          되돌릴 수 없습니다. 로그인 계정과 직원 정보가 모두 삭제됩니다. 출결 기록이 있으면 삭제 대신 ‘퇴사’ 처리를
          권장합니다.
        </p>
        {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
        <Footer onClose={onClose}>
          <SubmitBtn label="삭제" variant="destructive" />
        </Footer>
      </form>
    </Modal>
  );
}

export function AccountActions({
  staffId,
  displayName,
  currentEmail,
  currentRole,
  currentStatus,
  roleOptions,
  homeroomClasses,
  assistClasses,
  handoverTeachers,
  protection = "clear",
}: {
  staffId: string;
  displayName: string;
  currentEmail: string;
  currentRole: SystemRole;
  currentStatus: "active" | "inactive" | "pending";
  roleOptions: SystemRole[];
  /** 이 직원이 담임인 진행중 반 — 퇴사/삭제 시 인수인계 경고·일괄 인계에 사용 */
  homeroomClasses: HomeroomClassRow[];
  /** 담임은 아니지만 교시로 들어가는 진행중 반 — 퇴사 시 함께 인계 */
  assistClasses: AssistClassRow[];
  /** 퇴사 시 반을 넘겨받을 수 있는 재직 강사 후보 */
  handoverTeachers: HandoverTeacher[];
  /** 보호 계정이면 역할 변경·퇴사·삭제를 세우지 않는다(원장 2026-09-30 "강력 가드"). unknown = 확인 실패(막고 재시도 안내). */
  protection?: "protected" | "clear" | "unknown";
}) {
  const [open, setOpen] = useState<"email" | "password" | "role" | "delete" | null>(null);
  const close = () => setOpen(null);
  // 🔴 문구에 '슈퍼관리자'를 쓰지 않는다 — 지점에선 '관리자'로 위장한다(displayRoleFor).
  const locked = protection !== "clear";
  const canChangeRole = roleOptions.length > 0 && !locked;

  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-5">
      <p className="micro mb-1">계정 관리</p>
      <p className="text-text-dim mb-3 text-xs">로그인 계정의 역할·이메일·비밀번호 변경, 완전 삭제.</p>
      {locked ? (
        <p className="text-text-dim bg-bg-soft mb-3 rounded-lg px-3 py-2 text-xs">
          {protection === "protected"
            ? "보호된 계정입니다 — 역할·상태는 여기서 바꿀 수 없습니다. 운영자에게 요청하세요."
            : "계정 보호 여부를 확인하지 못했습니다 — 잠시 뒤 새로고침하세요."}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canChangeRole ? (
          <Button variant="outline" size="sm" onClick={() => setOpen("role")}>
            <ShieldCheck className="size-3.5" />
            역할 변경
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => setOpen("email")}>
          <Mail className="size-3.5" />
          이메일 변경
        </Button>
        <Button variant="outline" size="sm" onClick={() => setOpen("password")}>
          <KeyRound className="size-3.5" />
          비밀번호 재설정
        </Button>
        {locked ? null : (
          <>
            <DeactivateButton
              staffId={staffId}
              displayName={displayName}
              currentStatus={currentStatus}
              homeroomClasses={homeroomClasses}
              assistClasses={assistClasses}
              teacherOptions={handoverTeachers}
            />
            <Button variant="destructive" size="sm" onClick={() => setOpen("delete")}>
              <Trash2 className="size-3.5" />
              직원 삭제
            </Button>
          </>
        )}
      </div>

      {open === "role" ? (
        <RoleDialog
          staffId={staffId}
          displayName={displayName}
          currentRole={currentRole}
          roleOptions={roleOptions}
          onClose={close}
        />
      ) : null}
      {open === "email" ? (
        <EmailDialog staffId={staffId} currentEmail={currentEmail} onClose={close} />
      ) : null}
      {open === "password" ? (
        <PasswordDialog staffId={staffId} displayName={displayName} onClose={close} />
      ) : null}
      {open === "delete" ? (
        <DeleteDialog
          staffId={staffId}
          displayName={displayName}
          homeroomCount={homeroomClasses.length}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
