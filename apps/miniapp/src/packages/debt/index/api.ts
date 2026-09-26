/**
 * 负债页局部端点：还款登记（POST /api/debts/:id/payments）。
 * lib/api.ts 未封装该端点，按 README 约定在本页面目录局部补齐（不改公共文件，避免多代理冲突）。
 */
import { request } from "@/lib/request";

/** 入参契约（grep apps/api/src/app/api/debts/[id]/payments/route.ts 确认）：
 *  - amountCents：正整数（分），Number.isInteger 校验不过直接 400「还款金额需为正整数（分）」
 *  - paidAt：YYYY-MM-DD，可选（缺省北京今天）；非真实日历日 400
 *  - 同负债同日同额重复提交 409「当天已有一笔相同金额的还款」——双击防重靠服务端 */
export function payDebt(id: string, body: { amountCents: number; paidAt: string }) {
  return request(`/api/debts/${id}/payments`, { method: "POST", body });
}
