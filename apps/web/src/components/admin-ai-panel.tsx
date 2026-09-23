"use client";

import EditorHeader from "./admin-ai-panel/editor-header";
import EngineModeCard from "./admin-ai-panel/engine-mode-card";
import InputAssemblySection from "./admin-ai-panel/input-assembly-section";
import PromptList from "./admin-ai-panel/prompt-list";
import SystemPromptSection from "./admin-ai-panel/system-prompt-section";
import VersionsSection from "./admin-ai-panel/versions-section";
import { useAdminAi } from "./admin-ai-panel/use-admin-ai";

/**
 * /admin · AI 管理模块（REQ-001 R4 + REQ-003 3-A 三段式详情）：
 * - 左列 prompt 清单（分类分组、覆盖态徽标、启用开关）；移动端横滑、PC 左栏
 * - 右侧三段：① System prompt（编辑/对比默认值/✨AI 优化）
 *              ② 输入装配（user 模板编辑 + 占位符校验/一键补齐 + 注入开关 + 参数 + 装配预览·零 token）
 *              ③ 版本历史（三件套快照，载入单件/整体回滚；启用开关关闭=整 key 回退代码默认）
 * - 保存一次提交三段（未改字段原样回传语义：改回默认值 = 清除该覆盖）
 * 状态与提交逻辑在 ./admin-ai-panel/use-admin-ai.ts，本文件只做区块拼装（默认导出与 props 不变）。
 */
export default function AdminAiPanel({ notify }: { notify: (text: string, ok?: boolean) => void }) {
  const ai = useAdminAi(notify);

  if (!ai.items) return <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>;

  return (
    <div>
      {/* 调用引擎模式开关（REQ-003 3-C 管理台开关） */}
      <EngineModeCard
        mode={ai.engineMode}
        envDefault={ai.engineEnvDefault}
        saving={ai.engineSaving}
        onSwitch={(m) => void ai.switchEngineMode(m)}
      />

      <div className="lg:grid lg:grid-cols-[230px_1fr] lg:gap-5">
        {/* prompt 清单：移动横滑 / PC 左栏 */}
        <PromptList items={ai.items} selKey={ai.sel?.key} onPick={ai.pick} />

        {/* 三段式编辑器 */}
        {ai.sel && (
          <div className="min-w-0">
            {/* 标题行 */}
            <EditorHeader
              sel={ai.sel}
              dirty={ai.dirty}
              saving={ai.saving}
              draft={ai.draft}
              onSave={ai.save}
              onRevert={ai.revertDefault}
              saveBlocked={ai.userDataOverCap}
              saveBlockReason="个性化注入估算超 8000 字符上限，请下调条数或移除数据集"
            />

            {/* ===== 第一段：System prompt ===== */}
            <SystemPromptSection
              sel={ai.sel}
              draft={ai.draft}
              setDraft={ai.setDraft}
              setDirty={ai.setDirty}
              showCompare={ai.showCompare}
              setShowCompare={ai.setShowCompare}
              optHint={ai.optHint}
              setOptHint={ai.setOptHint}
              optimizing={ai.optimizing}
              onOptimize={ai.optimize}
              suggestion={ai.suggestion}
              onAdopt={ai.adoptSuggestion}
              onDismissSuggestion={() => ai.setSuggestion(null)}
            />

            {/* ===== 第二段：输入装配（3-A） ===== */}
            <InputAssemblySection
              sel={ai.sel}
              setDirty={ai.setDirty}
              tplDraft={ai.tplDraft}
              setTplDraft={ai.setTplDraft}
              tplMissing={ai.tplMissing}
              tplUnknown={ai.tplUnknown}
              tplDirty={ai.tplDirty}
              cfgDirty={ai.cfgDirty}
              onFillMissing={ai.fillMissingPlaceholder}
              onResetTpl={ai.resetTpl}
              injectDraft={ai.injectDraft}
              setInjectDraft={ai.setInjectDraft}
              capsDraft={ai.capsDraft}
              setCapsDraft={ai.setCapsDraft}
              previewSample={ai.previewSample}
              setPreviewSample={ai.setPreviewSample}
              previewPeriod={ai.previewPeriod}
              setPreviewPeriod={ai.setPreviewPeriod}
              previewing={ai.previewing}
              onPreview={ai.runPreview}
              previewText={ai.previewText}
              isReview={ai.isReview}
              periodPlaceholder={ai.periodPlaceholder}
              userDataDraft={ai.userDataDraft}
              setUserDataDraft={ai.setUserDataDraft}
              userDataDirty={ai.userDataDirty}
              userDataEstChars={ai.userDataEstChars}
              userDataOverCap={ai.userDataOverCap}
              catalogDatasets={ai.catalogDatasets}
              catalogLoading={ai.catalogLoading}
              onEnsureCatalog={ai.ensureCatalog}
            />

            {/* ===== 第三段：版本历史 ===== */}
            <VersionsSection
              versions={ai.versions}
              showVersions={ai.showVersions}
              setShowVersions={ai.setShowVersions}
              enabled={ai.enabled}
              setEnabled={ai.setEnabled}
              setDirty={ai.setDirty}
              onLoadSystem={ai.loadVersionSystem}
              onRollback={ai.rollback}
            />
          </div>
        )}
      </div>
    </div>
  );
}
