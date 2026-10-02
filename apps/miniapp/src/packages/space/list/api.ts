/**
 * 空间列表页局部端点（= web spaces/page.tsx 内联 api 调用）：
 * - POST /api/spaces 新建（body 同 web SpaceCreateInput）
 * - PATCH /api/spaces/:id 重命名 {name} / 归档恢复 {status} / 调整到期 {targetDate}
 * - DELETE /api/spaces/:id 删除（感悟一并删，关联 todo/动态仅解除归属）
 * lib/api.ts 只读函数不可改，写操作按 README 铁律落页面局部 api.ts。
 */
import { request } from "@/lib/request";

export interface SpaceDraftBody {
  name: string;
  description: string | null;
  icon: string;
  color: string;
  startedAt: string | null;
  targetDate: string | null;
}

export function createSpace(body: SpaceDraftBody) {
  return request("/api/spaces", { method: "POST", body });
}

export function patchSpace(id: string, body: Record<string, unknown>) {
  return request(`/api/spaces/${id}`, { method: "PATCH", body });
}

export function deleteSpace(id: string) {
  return request(`/api/spaces/${id}`, { method: "DELETE" });
}
