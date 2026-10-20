"use client";

/**
 * Markdown 编辑快捷键与工具栏共用变换（REQ-019 FR-B2）：
 * 有选区包裹、无选区插占位并选中占位文字；调用方在 set 后自行恢复光标（requestAnimationFrame）。
 */

export type MdKind = "bold" | "italic" | "link" | "h2" | "list" | "quote";

interface MdSpec {
  wrap?: [string, string]; // 选区包裹前后缀
  prefix?: string; // 行前缀（h2/list/quote）
  placeholder: string;
}

const SPECS: Record<MdKind, MdSpec> = {
  bold: { wrap: ["**", "**"], placeholder: "粗体文字" },
  italic: { wrap: ["*", "*"], placeholder: "斜体文字" },
  link: { wrap: ["[", "](https://)"], placeholder: "链接文字" },
  h2: { prefix: "## ", placeholder: "标题" },
  list: { prefix: "- ", placeholder: "列表项" },
  quote: { prefix: "> ", placeholder: "引用内容" },
};

/** 对 textarea 应用一个 Markdown 变换：返回是否发生了修改（调用方据此 setState） */
export function applyMarkdown(ta: HTMLTextAreaElement, kind: MdKind): { value: string; selStart: number; selEnd: number } | null {
  const spec = SPECS[kind];
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const selected = value.slice(s, e);

  if (spec.wrap) {
    const [before, after] = spec.wrap;
    const inner = selected || spec.placeholder;
    const next = `${value.slice(0, s)}${before}${inner}${after}${value.slice(e)}`;
    // 有选区：保持选区包住内部文字；无选区：选中占位文字便于直接输入覆盖
    const innerStart = s + before.length;
    return { value: next, selStart: innerStart, selEnd: innerStart + inner.length };
  }

  // 行前缀类：找选区所在行的行首（含多行选区时逐行加前缀）
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  const lineEnd = (() => {
    const nl = value.indexOf("\n", e);
    return nl === -1 ? value.length : nl;
  })();
  const block = value.slice(lineStart, lineEnd) || spec.placeholder;
  const prefixed = block
    .split("\n")
    .map((line) => (line.startsWith(spec.prefix!) ? line : `${spec.prefix}${line}`))
    .join("\n");
  const next = `${value.slice(0, lineStart)}${prefixed}${value.slice(lineEnd)}`;
  return { value: next, selStart: lineStart, selEnd: lineStart + prefixed.length };
}

/** onKeyDown 处理器工厂：Ctrl/Cmd+B/I/K → bold/italic/link。返回 true 表示已消费。 */
export function handleMarkdownKey(ta: HTMLTextAreaElement, e: React.KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  const key = e.key.toLowerCase();
  const kind: MdKind | null = key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : null;
  if (!kind) return false;
  const r = applyMarkdown(ta, kind);
  if (!r) return false;
  e.preventDefault();
  // 必须经原型原生 setter 写值：直接 ta.value=... 会同步 React 值追踪器，
  // 随后派发的 input 事件被 updateValueIfChanged 判为「值未变」吞掉，受控 state 不更新（历史 bug：快捷键改动静默丢失）
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (nativeSetter) nativeSetter.call(ta, r.value);
  else ta.value = r.value;
  ta.setSelectionRange(r.selStart, r.selEnd);
  // 让 React 受控值同步：派发原生 input 事件（React onChange 监听它）
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** 工具栏按钮入口：应用变换 + 同步受控值 + 恢复焦点与选区 */
export function applyMarkdownControlled(
  ta: HTMLTextAreaElement,
  kind: MdKind,
  setValue: (v: string) => void,
): void {
  const r = applyMarkdown(ta, kind);
  if (!r) return;
  setValue(r.value);
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(r.selStart, r.selEnd);
  });
}
