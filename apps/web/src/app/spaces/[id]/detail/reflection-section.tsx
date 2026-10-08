"use client";

import type { Dispatch, SetStateAction } from "react";
import { PenLine } from "lucide-react";
import SpaceReflections from "@/components/space-reflections";
import type { Msg } from "./types";
import type { ReflectionActions } from "./use-reflection";

/** 感悟区块（REQ-002 N2，自 detail.tsx 拆出）：写感悟入口 + 感悟列表 */
export default function ReflectionSection(opts: {
  id: string;
  reflection: ReflectionActions;
  setMsg: Dispatch<SetStateAction<Msg>>;
  load: () => Promise<void>;
}) {
  const { id, reflection, setMsg, load } = opts;
  const { openNew, openEdit } = reflection;
  return (
    <div className="mb-4">
      <div className="mb-3 flex justify-end">
        <button
          onClick={openNew}
          className="btn-primary flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium"
        >
          <PenLine size={14} aria-hidden /> 写感悟
        </button>
      </div>
      <SpaceReflections
        spaceId={id}
        notify={setMsg}
        rev={reflection.rev}
        onChanged={() => void load()}
        onEdit={(rid) => {
          // 打开编辑器前拉取全文
          void openEdit(rid);
        }}
      />
    </div>
  );
}
