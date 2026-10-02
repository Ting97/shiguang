/**
 * 联系人详情页局部端点（契约 grep 查证：apps/api/src/app/api/contacts/[id]/* + people/service.ts）：
 * - POST /api/contacts/:id/ai-profile → {profile:{summary,likes,dislikes,facts}}（通读往来提炼，耗时长）
 * - POST /api/contacts/:id/interactions {type,summary,occurredAt?} 手动补一笔往来
 *   （type ∈ 见面/通话/送礼/收礼/请客/帮忙/其他；occurredAt ISO，缺省=现在）
 * - DELETE /api/contacts/:id 删除档案（往来时间线一并删，动态与流水不受影响）
 * 列表/详情读取复用 lib/api 的 loadContacts / loadContactDetail（禁改文件）。
 */
import { request } from "@/lib/request";

export interface AiProfile {
  summary: string;
  likes: string[];
  dislikes: string[];
  facts: string[];
}

export function generateAiProfile(id: string) {
  return request<{ profile: AiProfile }>(`/api/contacts/${id}/ai-profile`, { method: "POST" });
}

export function addInteraction(
  id: string,
  body: { type: string; summary: string; occurredAt?: string },
) {
  return request(`/api/contacts/${id}/interactions`, { method: "POST", body });
}

export function deleteContact(id: string) {
  return request(`/api/contacts/${id}`, { method: "DELETE" });
}
