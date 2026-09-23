"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/shared/api";
import { TagChip } from "@/components/tag-chip";
import CategoryGroups from "./admin-data-panel/category-groups";
import CatalogTable from "./admin-data-panel/catalog-table";
import TrialQuery from "./admin-data-panel/trial-query";
import type { CatalogPayload, CategoryGroup } from "./admin-data-panel/types";

/**
 * /admin · 数据面模块（REQ-005 R5，FR-5.1/5.2/5.3，全部只读）：
 * ① 类别清单（按域分组折叠）② 数据目录（数据集注册表 + promptRefs 静态映射）
 * ③ 在线试查（白名单参数化查询，强制时间窗 ≤92 天）。
 * 门禁：接口层 role 硬校验——本面板捕获 403 显示「仅管理员」。
 */
export default function AdminDataPanel({ notify }: { notify: (text: string, ok?: boolean) => void }) {
  const [groups, setGroups] = useState<CategoryGroup[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    api<{ groups: CategoryGroup[] }>("/api/admin/data/categories")
      .then((j) => setGroups(j.groups))
      .catch((e) => {
        if (e instanceof ApiClientError && e.status === 403) setForbidden(true);
        else notify("类别清单加载失败", false);
      });
    api<CatalogPayload>("/api/admin/data/catalog")
      .then((j) => setCatalog(j))
      .catch((e) => {
        if (e instanceof ApiClientError && e.status === 403) setForbidden(true);
        else notify("数据目录加载失败", false);
      });
    // （notify 为父组件每次渲染重建的函数，不进依赖：该规则在本仓库 eslint 配置中已全局关闭）
  }, []);

  if (forbidden) {
    return (
      <div className="glass rounded-2xl p-10 text-center">
        <p className="text-3xl">🔒</p>
        <p className="mt-2 text-sm font-bold">仅管理员</p>
        <p className="mt-1 text-xs text-ink-dim">数据面（类别清单 / 数据目录 / 在线试查）仅超级管理员可见</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 区块 1：类别清单 */}
      <section className="glass rounded-2xl p-5">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
          <TagChip icon="🏷️" label="类别清单" tone="sky" />
          <span className="text-[10px] font-normal text-ink-faint">AI 识别可用类别全域（活动分类 / 目标空间为 DB 实时，其余为共享包枚举）</span>
        </h2>
        <div className="mt-3">
          {!groups ? <p className="text-xs text-ink-dim">加载中…</p> : <CategoryGroups groups={groups} />}
        </div>
      </section>

      {/* 区块 2：数据目录 */}
      <section className="glass rounded-2xl p-5">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
          <TagChip icon="🗂️" label="数据目录" tone="violet" />
          <span className="text-[10px] font-normal text-ink-faint">个性化注入 / 注入项可引用的全部数据集注册表（列白名单 + 分区）</span>
        </h2>
        <div className="mt-3">
          {!catalog ? <p className="text-xs text-ink-dim">加载中…</p> : <CatalogTable catalog={catalog} />}
        </div>
      </section>

      {/* 区块 3：在线试查 */}
      <section className="glass rounded-2xl p-5">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-soft">
          <TagChip icon="🔎" label="在线试查" tone="emerald" />
          <span className="text-[10px] font-normal text-ink-faint">只读白名单查询（强制时间窗 ≤92 天；仅行为型 / AI 衍生可查）</span>
        </h2>
        <div className="mt-3">
          {!catalog ? <p className="text-xs text-ink-dim">加载中…</p> : <TrialQuery catalog={catalog} />}
        </div>
      </section>
    </div>
  );
}
