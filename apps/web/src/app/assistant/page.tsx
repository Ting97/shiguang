"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AssistantChat, { SCOPE_META, type ChatScope } from "./chat-core";

/** 拾光助手整页（REQ-015；REQ-019 分域：?scope= 进域管家，白名单外回退全局）。 */
function AssistantPageInner() {
  const raw = useSearchParams().get("scope") ?? "global";
  const scope = (Object.keys(SCOPE_META) as ChatScope[]).includes(raw as ChatScope) ? (raw as ChatScope) : "global";
  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto flex max-w-4xl flex-col px-5 pb-8 pt-6 lg:flex-row lg:gap-6 lg:pt-8">
        <AssistantChat key={scope} variant="page" scope={scope} />
      </div>
    </main>
  );
}

export default function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <AssistantPageInner />
    </Suspense>
  );
}
