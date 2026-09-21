import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PROMPT_KEYS, PROMPT_META, defaultPrompt, type PromptKey } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/prompts —— prompt 清单：key 元信息 + 生效来源 + DB 覆盖内容 + 默认值全文（前端做对比） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

  const { rows } = await pool.query(`select key, content, enabled, remark, updated_at, updated_by from ai_prompts`);
  const overrides = new Map(rows.map((r) => [r.key, r]));
  const items = PROMPT_KEYS.map((key) => {
    const o = overrides.get(key);
    return {
      key,
      title: PROMPT_META[key].title,
      category: PROMPT_META[key].category,
      enabled: o ? o.enabled : true, // 无覆盖 = 用默认值，等效"启用"
      overridden: !!o,
      dbContent: o?.content ?? null,
      remark: o?.remark ?? null,
      updatedAt: o?.updated_at ?? null,
      defaultContent: defaultPrompt(key),
    };
  });
  return NextResponse.json({ items });
}
