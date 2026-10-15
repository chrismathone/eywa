"use client";

import { Button } from "@/components/ui/button";
import type { PermissionsSettings } from "@/features/owner/settings-types";
import { SpecialAccessList } from "./special-access-list";

type Special = PermissionsSettings["specialAccess"];
export function StudentStatusAccessEditor({ value, hiddenUserIds, staffOptions, nameOf, onChange }: {
  value: Special;
  hiddenUserIds: readonly string[];
  staffOptions: readonly { id: string; name: string; role: string }[];
  nameOf: (id: string) => string;
  onChange: (update: (previous: Special) => Special) => void;
}) {
  const ids = value.studentStatusManagerIds;
  if (ids === undefined) return <div className="space-y-2">
    <p className="text-sm font-semibold">원생 상태 변경</p>
    <p className="text-sm text-muted-foreground">기존 원생 정보 변경 권한을 따르고 있습니다. 담당자 지정으로 전환한 뒤 저장하면, 원장과 지정한 사람만 퇴원·휴원·재개·복구 및 퇴원 예약을 처리합니다. 전환할 때 필요한 담당자를 모두 지정해 주세요.</p>
    <Button type="button" variant="outline" onClick={() => onChange((prev) => ({ ...prev, studentStatusManagerIds: [] }))}>담당자 지정으로 전환</Button>
  </div>;
  return <SpecialAccessList label="원생 상태 변경"
    hint="퇴원·휴원·재개·복구, 과목 수강 종료·대기 및 퇴원 예약·취소를 처리할 사람입니다. 원생 메뉴 전체 권한도 필요합니다. 비우면 원장만 처리합니다. 수강 날짜 수정과 반 이동·배정 취소·이력 삭제는 각 기존 권한을 따릅니다."
    ids={ids} hiddenUserIds={hiddenUserIds}
    staffOptions={staffOptions.filter((s) => !hiddenUserIds.includes(s.id) && ["admin", "manager", "counselor", "accountant"].includes(s.role))}
    nameOf={nameOf} onChange={(update) => onChange((prev) => ({ ...prev, studentStatusManagerIds: update(prev.studentStatusManagerIds ?? []) }))} />;
}
