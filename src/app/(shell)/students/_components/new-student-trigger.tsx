"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { useOpenFormWindow } from "@/components/workspace/open-window-button";

/**
 * /students 목록 페이지에서 "새 학생" 트리거.
 * 데스크톱에서는 /students/new를 플로팅 윈도우로 열고, 모바일에서는 해당 라우트로 이동한다.
 * 폼 제출 성공 시 윈도우가 자동으로 닫히고 배경이 새로고침된다.
 */
export function NewStudentTrigger() {
  const openFormWindow = useOpenFormWindow();

  return (
    <Button onClick={(e) => openFormWindow("/students/new", "새 원생", e)}>
      <EyIcon name="plus" size={13} className="mr-1" />새 원생
    </Button>
  );
}
