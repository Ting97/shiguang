# @shiguangri/ai —— 拾光复利解析器

一句话 → 多域结构化（时间块 / 财务草稿 / 人际草稿）。

## 结构
- `src/schema.ts`     zod Schema（ParseResult / LlmExtraction / 八大分类）
- `src/duration.ts`   中文时长与金额解析（确定性）
- `src/time-infer.ts` 时间块推断引擎（显式时长 / 相对时段 / 默认时长）
- `src/glm.ts`     GLM 客户端（OpenAI 兼容，智谱开放平台）
- `src/prompt.ts`     抽取提示词
- `src/parse.ts`      管线：LLM 抽取 + 确定性时间计算 + 规则兜底
- `src/run-poc.ts`    20 句 PoC 运行器
- `testset/poc-20.json` 测试集（与 docs/07 同步维护）

## 使用
```bash
npm test          # 单元测试（无需 Key）
npm run poc       # 规则引擎跑 20 句（无需 Key）
npm run poc:live  # GLM 实测（根目录 .env 配 ZHIPUAI_API_KEY）
```

## 环境变量
见根目录 `.env.example`。模型默认 glm-5.3-flashx（GLM-5.3 系列始终思考：不支持 thinking=disabled，客户端自动改发 thinking=enabled + reasoning_effort=low 并提升 max_tokens），可用 GLM_MODEL 覆盖；免费档晚高峰偶发限流(429)，客户端内置指数退避重试 + 自动降级 GLM_FALLBACK_MODEL（默认 glm-4-flash）。
