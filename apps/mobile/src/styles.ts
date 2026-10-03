/**
 * 移动端共享样式表（REQ-009 9-D 拆分自 App.tsx，机械搬家未改任何值）：
 * screens 与 components 共用同一份 StyleSheet（原单文件 `s`）。
 */
import { StyleSheet } from "react-native";

export const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  // 登录
  logo: { fontSize: 56, textAlign: "center" },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", marginTop: 8 },
  sub: { fontSize: 13, textAlign: "center", marginTop: 6, marginBottom: 28 },
  inputWrap: {
    borderWidth: 1, borderRadius: 12,
    marginBottom: 12, width: 280,
  },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  inputWrapMultiline: {
    borderWidth: 1, borderRadius: 12,
  },
  inputMultiline: {
    minHeight: 90, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, textAlignVertical: "top",
  },
  err: { fontSize: 12, marginBottom: 10 },
  gradBtnWrap: { width: 280, borderRadius: 12, overflow: "hidden" },
  gradBtn: { paddingVertical: 12, paddingHorizontal: 32, alignItems: "center", borderRadius: 12 },
  gradBtnText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  hint: { fontSize: 11, marginTop: 18, textAlign: "center" },
  // 顶栏（毛玻璃 pill）
  nav: { borderRadius: 999, marginHorizontal: 12, marginTop: 10, marginBottom: 4 },
  navInner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  navBrand: { fontSize: 15, fontWeight: "700" },
  navChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  navChipText: { fontSize: 12 },
  navExit: { fontSize: 13 },
  head: { alignItems: "center", marginTop: 14, marginBottom: 12, paddingHorizontal: 16 },
  headTitle: { fontSize: 28, fontWeight: "700", letterSpacing: 2 },
  headSub: { fontSize: 14, fontWeight: "400", letterSpacing: 0 },
  headDesc: { fontSize: 12, marginTop: 6, textAlign: "center" },
  // 横幅（msg-banner）
  banner: {
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 6,
    marginHorizontal: 16, marginBottom: 8,
  },
  // 动态流
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  dayHead: { fontSize: 12, textAlign: "center", marginVertical: 10 },
  empty: { textAlign: "center", marginTop: 60 },
  card: {
    borderWidth: 1, borderRadius: 16,
    padding: 14, marginBottom: 10, overflow: "hidden",
  },
  cardHighlight: { position: "absolute", left: 0, right: 0, top: 0, height: 60 },
  cardBody: { flexDirection: "row", gap: 12 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  avatarIcon: { fontSize: 18 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  cardTag: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  cardTagText: { fontSize: 10 },
  cardTime: { fontSize: 11 },
  cardText: { fontSize: 15, lineHeight: 22, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, overflow: "hidden",
  },
  skelLine: { height: 14, borderRadius: 7 },
  // 底部中央悬浮圆圈
  fabWrap: {
    position: "absolute", bottom: 14, left: 0, right: 0,
    alignItems: "center",
  },
  fabGlowWrap: { width: 64, height: 64, borderRadius: 32 },
  fab: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35,
    shadowRadius: 8, elevation: 8,
  },
  fabIcon: { fontSize: 26 },
  // 录音/识别浮层
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
  },
  overlayCardWrap: { minWidth: 250 },
  overlayCard: {
    borderWidth: 1,
    paddingHorizontal: 28, paddingVertical: 22, alignItems: "center", gap: 12,
  },
  recRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  recDot: { width: 12, height: 12, borderRadius: 6 },
  recTime: { fontSize: 30, fontWeight: "700", fontVariant: ["tabular-nums"] },
  waveRow: { flexDirection: "row", alignItems: "flex-end", gap: 5, height: 42 },
  overlayHint: { fontSize: 12, textAlign: "center" },
  // 底部输入面板
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, paddingBottom: 28,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sheetTitle: { fontSize: 15, fontWeight: "600" },
  sheetClose: { fontSize: 16, paddingHorizontal: 4 },
  sheetFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  sheetHint: { fontSize: 11, flex: 1, marginRight: 10 },
  gradBtnWrapSheet: { borderRadius: 12, overflow: "hidden" },
  gradBtnSheet: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12, alignItems: "center" },
  // 顶栏「动态 | 交易」切换 chip 组
  navTabs: { flexDirection: "row", alignItems: "center", gap: 6 },
  // 交易屏（Trades 只读）
  acctWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  acctChip: { maxWidth: 160, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  acctChipText: { fontSize: 12 },
  sumHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sumLabel: { fontSize: 12 },
  sumName: { fontSize: 12, flexShrink: 1 },
  sumNet: { fontSize: 30, fontWeight: "700", marginTop: 4, fontVariant: ["tabular-nums"] },
  sumRow: { flexDirection: "row", marginTop: 12 },
  sumItem: { flex: 1, alignItems: "center", gap: 2 },
  sumItemNum: { fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  sumItemLabel: { fontSize: 11 },
  chartHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chartTotal: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chartBars: {
    flexDirection: "row", alignItems: "flex-end", gap: 2,
    height: 52, marginTop: 12, borderBottomWidth: 1,
  },
  chartBar: { flex: 1, borderRadius: 2 },
  chartLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  chartLabel: { fontSize: 10, fontVariant: ["tabular-nums"] },
  chartEmpty: { fontSize: 12, textAlign: "center", paddingVertical: 24 },
  sectionTitle: { fontSize: 13, fontWeight: "600" },
  sectionTitle2: { fontSize: 12, marginTop: 16, marginBottom: 8, letterSpacing: 1 },
  dayRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, borderBottomWidth: 1,
  },
  dayDate: { width: 56, fontSize: 13, fontVariant: ["tabular-nums"] },
  dayCount: { fontSize: 12, flex: 1 },
  dayNet: { fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
  // 触底加载 footer（动态流 / 交易窗口外扩共用）
  footer: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14,
  },
  footerText: { fontSize: 12, textAlign: "center", paddingVertical: 14 },
});
