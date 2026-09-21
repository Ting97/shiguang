import type { Tone } from "@/components/tag-chip";

/** 联系人分组 → 语义色（与 packages/shared GROUP_COLOR 对齐：概念定色，一色到底） */
export const GROUP_TONE: Record<string, Tone> = {
  家人: "rose",
  朋友: "amber",
  同事: "sky",
  同学: "emerald",
  客户: "violet",
  其他: "slate",
};
