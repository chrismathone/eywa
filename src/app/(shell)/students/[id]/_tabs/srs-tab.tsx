import { Suspense } from "react";
import { StudentJjSection } from "../_components/jj-section";

/**
 * 학생 상세 **'SRS 성적'** 탭 — 인재원 단어 학습·시험만 모은다
 * (원장 2026-09-21: *"영어 성적의 경우 jj실이있으면 jj실 내용나오고 성적나오는데 이경우 탭을 SRS 성적탭
 * 하나 더내서 일반 성적이랑 분리"*).
 *
 * 🔑 그리는 조각은 성적 탭에 있던 **그 구역 그대로**(`StudentJjSection`)다 — 자리를 옮겼을 뿐 새로 만들지
 *    않았다(숫자가 두 곳에서 갈리지 않게).
 * 🔴 짝이 없으면 그 구역이 스스로 비므로, **탭 자체를 안 내놓는 판정은 page.tsx**가 한다(빈 탭 방지 +
 *    강제 URL 되돌리기 — 화면에서 감추는 것만으로는 게이트가 아니다, [[#77]]).
 * ⚠️ 인재원 호출이 첫 페인트를 막지 않게 `Suspense`로 따로 흘린다(B7) — 성적 탭에 있을 때와 같다.
 */
export function SrsTab({
  studentId,
  jjFrom,
  jjTo,
}: {
  studentId: string;
  /** 학습 기간(학습일) — 성적관리 JJ실에서 들어오면 그 기간 그대로 온다. */
  jjFrom?: string;
  jjTo?: string;
}) {
  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-bold">SRS 성적</h2>
        <p className="text-muted-foreground text-xs">인재원 단어 학습·시험</p>
      </header>
      <Suspense fallback={null}>
        <StudentJjSection studentId={studentId} jjFrom={jjFrom} jjTo={jjTo} />
      </Suspense>
    </div>
  );
}
