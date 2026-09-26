/**
 * 空间详情页局部端点（契约 grep 查证：apps/api/src/app/api/spaces/[id]/reflections/route.ts
 * + apps/api/src/server/goal/repo.ts reflectionRepo.list）：
 * - GET /api/spaces/:id/reflections?limit&offset → {items:[{id,preview,chars,created_at,updated_at,edited}], total}
 *   ⚠ 坑：lib/api.ts 的 loadSpaceReflections 把返回类型标成 {reflections}，实际是 {items,total}——
 *   该文件禁止修改，本页改用局部封装拿正确形状。
 * - POST /api/spaces/:id/reflections {content} → 201 {reflection}；content 空 400、超 5 万字 400。
 * 空间详情头没有独立端点（/api/spaces/:id 只有 PATCH/DELETE，无 GET），
 * 与 web use-space-data 同口径：从 GET /api/spaces 列表里按 id 找（复用 lib/api.loadSpaces）。
 */
import { request } from "@/lib/request";

/** 列表只回前 300 字预览（性能），chars 为全文长度 */
export interface ReflectionItem {
  id: string;
  preview: string;
  chars: number;
  created_at: string;
  updated_at?: string;
  edited?: boolean;
}

export function loadReflections(spaceId: string, limit = 20, offset = 0) {
  return request<{ items: ReflectionItem[]; total: number }>(
    `/api/spaces/${spaceId}/reflections?limit=${limit}&offset=${offset}`,
  );
}

export function addReflection(spaceId: string, content: string) {
  return request<{ reflection: ReflectionItem }>(`/api/spaces/${spaceId}/reflections`, {
    method: "POST",
    body: { content },
  });
}
