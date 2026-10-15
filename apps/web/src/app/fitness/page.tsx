"use client";

/**
 * /fitness 旧地址跳转（REQ-018）：健身功能已并入内置「运动」空间——
 * 拉空间列表定位 kind='sport' 后跳转其训练栏；找不到（异常）兜底去空间列表。
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/shared/api";
import type { Space } from "@shiguangri/shared/types";

export default function FitnessRedirect() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ spaces: Space[] }>("/api/spaces")
      .then((r) => {
        if (!alive) return;
        const sport = (r.spaces ?? []).find((s) => s.kind === "sport");
        router.replace(sport ? `/spaces/${sport.id}?tab=fitness` : "/spaces");
      })
      .catch((e) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-8 text-center">
        {err ? (
          <>
            <p className="mt-10 text-sm text-danger">加载失败：{err}</p>
            <button className="btn-primary mt-3 rounded-xl px-5 py-2 text-xs" onClick={() => router.replace("/spaces")}>
              去目标空间
            </button>
          </>
        ) : (
          <p className="mt-10 text-xs text-ink-dim">正在前往运动空间…</p>
        )}
      </div>
    </main>
  );
}
