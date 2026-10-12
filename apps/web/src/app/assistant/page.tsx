"use client";

import AssistantChat from "./chat-core";

/** 拾光助手整页（REQ-015）：状态与消息流在 chat-core（与首页悬浮 Dock 共用）。 */
export default function AssistantPage() {
  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto flex max-w-4xl flex-col px-5 pb-8 pt-6 lg:flex-row lg:gap-6 lg:pt-8">
        <AssistantChat variant="page" />
      </div>
    </main>
  );
}
