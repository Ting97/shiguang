"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AssistantChat, { SCOPE_META, type ChatScope } from "./chat-core";
import { useSession } from "@/shared/session";
import ModuleLocked from "@/components/module-locked";

/** 拾光助手整页（REQ-015；REQ-019 分域：?scope= 进域管家，白名单外回退全局；
 *  REQ-028：ai 关 → 未开通页；scope 域模块关 → 该域不可用回退全局）。 */
function AssistantPageInner() {
  const raw = useSearchParams().get("scope") ?? "global";
  const listed = (Object.keys(SCOPE_META) as ChatScope[]).includes(raw as ChatScope) ? (raw as ChatScope) : "global";
  const { user } = useSession();

  if (user && !user.modules.includes("ai")) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <ModuleLocked
            title="拾光助手"
            desc="该模块已关闭。可在【我的 → 功能管理】重新开启，或联系管理员。"
            backHref="/"
            backLabel="返回首页"
          />
        </div>
      </main>
    );
  }
  // 域管家的域模块已关（ChatScope 域值与模块 key 同名）：回退全局助手，不硬锁整页
  const scope = user && listed !== "global" && !user.modules.includes(listed) ? "global" : listed;

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
