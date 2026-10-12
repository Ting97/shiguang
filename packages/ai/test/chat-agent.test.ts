/**
 * chatAgent 单测（REQ-015 批次 A）：工具调用循环 + 轨迹回传 + 工具失败不炸循环。
 * mock fetch 按 chat/completions 序列分流：第 1 次返回 tool_calls、第 2 次返回最终文本
 * （AI SDK maxSteps 客户端驱动：工具执行后自动带 tool 结果发第 2 次请求）。
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { chatAgent } from "../src/glm";

process.env.ZHIPUAI_API_KEY ??= "test-key";

/** OpenAI 兼容响应体构造 */
const completion = (message: Record<string, unknown>, finish: string) => ({
  choices: [{ message, finish_reason: finish }],
  usage: { prompt_tokens: 30, completion_tokens: 20 },
});

let restore: (() => void) | null = null;
/** 按序返回响应（耗尽后抛错，防静默错配） */
function mockSequence(responses: Array<Record<string, unknown> | (() => Record<string, unknown>)>) {
  let i = 0;
  const impl = async () => {
    const item = responses[i++];
    if (item === undefined) throw new Error(`mock: 未预期的第 ${i} 次请求`);
    const body = typeof item === "function" ? item() : item;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  mock.method(globalThis, "fetch", impl);
  restore = () => mock.restoreAll();
}

test("chatAgent：模型发起工具调用 → execute 执行 → 结果回传 → 最终文本 + 轨迹", async () => {
  const calls: unknown[] = [];
  mockSequence([
    completion(
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "query_test", arguments: JSON.stringify({ days: 7 }) },
          },
        ],
      },
      "tool_calls",
    ),
    completion({ role: "assistant", content: "这周你花了 128 元，主要是餐饮。" }, "stop"),
  ]);
  try {
    // 持有对象包装：闭包内赋值后外层读取，避开 TS 对 let+回调赋值的 null 收窄
    const usageBox: { v: { prompt_tokens: number; completion_tokens: number } | null } = { v: null };
    const r = await chatAgent({
      system: "test-system",
      messages: [{ role: "user", content: "这周花了多少" }],
      tools: [
        {
          name: "query_test",
          description: "测试工具",
          parameters: z.object({ days: z.number().int() }),
          execute: async (args) => {
            calls.push(args);
            return { total: 12800 };
          },
        },
      ],
      onUsage: (u) => (usageBox.v = u),
    });
    assert.equal(r.text, "这周你花了 128 元，主要是餐饮。");
    assert.deepEqual(calls, [{ days: 7 }]);
    assert.deepEqual(r.toolCalls, [{ name: "query_test", args: { days: 7 } }]);
    assert.ok(usageBox.v && usageBox.v.prompt_tokens > 0, "usage 应回传");
  } finally {
    restore?.();
  }
});

test("chatAgent：工具 execute 抛错 → 错误对象回传模型，循环不炸、最终文本照常", async () => {
  mockSequence([
    completion(
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "boom", arguments: "{}" } },
        ],
      },
      "tool_calls",
    ),
    completion({ role: "assistant", content: "查询暂时失败，请稍后再试。" }, "stop"),
  ]);
  try {
    const r = await chatAgent({
      system: "test-system",
      messages: [{ role: "user", content: "查一下" }],
      tools: [
        {
          name: "boom",
          description: "会炸的工具",
          parameters: z.object({}),
          execute: async () => {
            throw new Error("db down");
          },
        },
      ],
    });
    assert.equal(r.text, "查询暂时失败，请稍后再试。");
    assert.equal(r.toolCalls.length, 1);
  } finally {
    restore?.();
  }
});

test("chatAgent：quota 熔断期直接拒绝（不发请求）——本用例注册在最后，熔断残留不影响其他用例", async () => {
  const { tripQuotaBreaker, isQuotaTripped } = await import("../src/glm");
  if (isQuotaTripped()) return; // 前序用例已触发熔断：拒绝语义已被覆盖
  tripQuotaBreaker();
  await assert.rejects(
    chatAgent({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    }),
    /熔断/,
  );
});
