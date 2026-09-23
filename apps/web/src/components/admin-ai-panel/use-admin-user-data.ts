"use client";

import { useCallback, useState } from "react";
import { api } from "@/shared/api";
import type { CatalogPayload, DatasetSpec } from "@/components/admin-data-panel/types";
import type { PromptItem, UserDataEntry } from "./types";

/** 个性化注入字符硬顶与估算系数（与服务端 USER_DATA_CAP_DEFAULT / 装配行宽对齐） */
export const USER_DATA_CAP = 8000;
const EST_CHARS_PER_ROW = 120;

/** 稳定签名：days/limit 缺省归一为 null，键序无关，仅内容与顺序敏感 */
const sig = (list: UserDataEntry[]) => JSON.stringify(list.map((e) => [e.dataset, e.days ?? null, e.limit ?? null]));

/**
 * 个性化注入（REQ-005 FR-5.6）草稿与 catalog 懒加载：
 * - userDataDraft：当前选中 prompt 的 userData 草稿（pick() 时经 resetUserData 深拷贝同步）
 * - ensureCatalog：数据集清单懒加载（展开「🧩 个性化注入」折叠区时调用，幂等）
 * 估算：Σ(limit ?? 10) × 120 字符 vs 硬顶 8000，超限由保存按钮禁用拦截。
 */
export function useAdminUserData(notify: (text: string, ok?: boolean) => void, sel: PromptItem | null) {
  const [userDataDraft, setUserDataDraft] = useState<UserDataEntry[]>([]);
  const [catalogDatasets, setCatalogDatasets] = useState<DatasetSpec[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const ensureCatalog = useCallback(() => {
    if (catalogDatasets || catalogLoading) return;
    setCatalogLoading(true);
    api<CatalogPayload>("/api/admin/data/catalog")
      .then((j) => setCatalogDatasets(j.datasets))
      .catch((e) => notify(e instanceof Error ? e.message : "数据目录加载失败", false))
      .finally(() => setCatalogLoading(false));
  }, [catalogDatasets, catalogLoading, notify]);

  const resetUserData = useCallback((item: PromptItem) => {
    setUserDataDraft((item.effectiveConfig.userData ?? []).map((e) => ({ ...e })));
  }, []);

  const userDataDirty = sel ? sig(userDataDraft) !== sig(sel.effectiveConfig.userData ?? []) : false;
  const userDataEstChars = userDataDraft.reduce((n, e) => n + (e.limit ?? 10) * EST_CHARS_PER_ROW, 0);
  const userDataOverCap = userDataEstChars > USER_DATA_CAP;

  return {
    userDataDraft,
    setUserDataDraft,
    resetUserData,
    ensureCatalog,
    catalogDatasets,
    catalogLoading,
    userDataDirty,
    userDataEstChars,
    userDataOverCap,
  };
}
