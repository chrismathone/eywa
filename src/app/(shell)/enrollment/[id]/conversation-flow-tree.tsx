"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageCircle } from "@/components/icons/eywa-icon-compat";
import type { ConversationFlowNode } from "@/features/enrollment/server/queries";

/** 상담 흐름 수형도 — 주제 트리(재귀). ijw ConversationFlowTree 이식(eywa 토큰). */

// 깊이별 좌측 색밴드(semantic 톤) — 중첩 레벨 구분.

function TreeNode({ node, depth }: { node: ConversationFlowNode; depth: number }) {
  const hasChildren = !!node.children && node.children.length > 0;
  const [expanded, setExpanded] = useState(depth < 2);

  return (
    <div className={depth > 0 ? "relative ml-4" : ""}>
      {depth > 0 ? (
        <>
          <div className="bg-line absolute top-0 bottom-0 left-[-10px] w-px" aria-hidden />
          <div className="bg-line absolute top-[17px] left-[-10px] h-px w-2.5" aria-hidden />
        </>
      ) : null}

      <div className="bg-bg-soft/60 my-1.5 rounded-md px-3 py-2">
        <div className="flex items-start gap-2">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="hover:bg-card mt-0.5 shrink-0 rounded p-0.5"
              aria-label={expanded ? "접기" : "펼치기"}
            >
              {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <MessageCircle className="text-text-faint mt-0.5 size-3.5 shrink-0" />
          )}
          <div className="min-w-0">
            <span className="text-foreground text-sm font-bold break-keep">{node.topic}</span>
            {node.summary ? (
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed break-keep">
                {node.summary}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {hasChildren && expanded ? (
        <div>
          {node.children!.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ConversationFlowTree({ flow }: { flow: ConversationFlowNode[] }) {
  if (!flow || flow.length === 0) return null;
  return (
    <div className="space-y-1">
      {flow.map((node, i) => (
        <TreeNode key={i} node={node} depth={0} />
      ))}
    </div>
  );
}
