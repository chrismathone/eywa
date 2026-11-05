import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { WindowLink } from "@/components/workspace/window-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAnswerHelpBoard, canAskHelpBoard } from "@/features/help/board/access";
import { HELP_BOARD_NOT_READY } from "@/features/help/board/missing";
import { getHelpPost } from "@/features/help/board/server/queries";
import { HELP_POST_STATUS_LABEL } from "@/features/help/board/types";
import { HelpAnswerForm, HelpCloseButton } from "../../_components/answer-form";
import { HelpDeleteButton } from "../../_components/delete-post";
import { HelpPostForm } from "../../_components/post-form";

export const metadata = { title: "도움말 질문 — 에이와" };

export default async function HelpPostPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, requireAccess("help")]);
  // '다른 강사 뷰'면 대상 X의 자리 — '자기 글' · 답변 역할을 서버 액션(boardActor)과 같은 행위자로 본다.
  const user = (await getCurrentUser({ teacherView: true })) ?? viewer;
  const loaded = await getHelpPost(id);
  if (!loaded.ready) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="도움말" title="질문" />
        <p className="bg-card shadow-card rounded-2xl p-5 text-sm" title={loaded.error?.raw}>
          {loaded.missingTable ? HELP_BOARD_NOT_READY : (loaded.error?.summary ?? "글을 불러오지 못했습니다")}
        </p>
        <WindowLink href="/help" className="text-primary text-sm">
          목록으로
        </WindowLink>
      </div>
    );
  }
  if (!loaded.post) notFound();
  const post = loaded.post;
  // 🔴 수정 · 삭제 · 닫기 · 답변은 서버 액션과 **같은 함수**로 판정한다 — 도움말이 '읽기'면 자기 글이어도 단추를 그리지 않는다
  //    (원장 2026-11-05 — 전에는 `mine`만 보고 단추를 세워, 누르면 그제서야 거절됐다).
  const [canWrite, canAnswer] = await Promise.all([canAskHelpBoard(user.systemRole), canAnswerHelpBoard(user.systemRole)]);
  const mine = post.authorId === user.id && canWrite;
  const canClose = post.status !== "closed" && canWrite && (mine || canAnswer);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="질문 게시판"
        title={post.title}
        description={`${HELP_POST_STATUS_LABEL[post.status]} · ${post.authorName}`}
        actions={
          <>
            {canClose ? <HelpCloseButton postId={post.id} /> : null}
            {mine ? <HelpDeleteButton postId={post.id} /> : null}
          </>
        }
      />
      <article className="bg-card shadow-card rounded-2xl p-5">
        <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed break-keep">{post.body}</p>
      </article>
      {mine ? <HelpPostForm post={{ id: post.id, title: post.title, body: post.body }} /> : null}
      <section>
        <h2 className="text-foreground mb-3 text-base font-bold">답변 {post.answers.length}개</h2>
        {post.answers.length === 0 ? (
          <p className="text-text-dim text-sm">아직 답변이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {post.answers.map((a) => (
              <li key={a.id} className="bg-card shadow-card rounded-2xl p-4">
                <p className="text-text-dim mb-2 text-xs">
                  {a.authorName}
                </p>
                <p className="text-foreground whitespace-pre-wrap text-sm leading-relaxed break-keep">{a.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canAnswer && post.status !== "closed" ? <HelpAnswerForm postId={post.id} /> : null}
      <WindowLink href="/help" className="text-primary text-sm">
        목록으로
      </WindowLink>
    </div>
  );
}
