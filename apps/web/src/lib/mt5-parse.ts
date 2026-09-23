/**
 * MT5 报表客户端解析器（REQ-005 R1 §3.1）—— 零第三方依赖，参考页逻辑移植。
 * 通道 A：ReportHistory-<login>.xlsx —— 自实现 zip 目录解析（EOCD → Central Directory → local header）
 *   + 浏览器原生 DecompressionStream("deflate-raw") 解压 → sharedStrings/sheet1 → 行列矩阵
 *   → 定位「持仓 / Positions」区块表头（列名包含匹配，列序容错）。
 * 通道 B：CSV/TSV（同列结构，含表头行；分隔符嗅探，UTF-8 → GBK/UTF-16 编码兜底）。
 * 时间口径：MT5 报表为服务器时间（夏令时 UTC+2 / 冬令时 UTC+3），统一 parseMt5Time 折算 UTC ISO。
 */
export const MT5_TZ_LABEL = "MT5 服务器时间（UTC+3）→ 北京时间";
/** 前置校验：文件 ≤10MB */
export const MAX_MT5_FILE_BYTES = 10 * 1024 * 1024;

export interface TradeRow {
  ticket: string; symbol?: string; direction: "buy" | "sell";
  openTime: string; closeTime: string; // ISO（服务器时区已折算 UTC）
  lots: number; profit: number; commission: number; swap: number;
  openPrice: number | null; closePrice: number | null; // 报表无对应列时 null
}

export type Mt5Source = "mt5_xlsx" | "csv";

const TD = new TextDecoder();

/** MT5 报表时间（服务器时区）→ UTC ISO；容错 `.` 日期、缺秒与 `.mmm` 毫秒 */
export function parseMt5Time(text: string, offsetHours = 3): string | null {
  const m = String(text ?? "").trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const off = `${offsetHours < 0 ? "-" : "+"}${String(Math.abs(offsetHours)).padStart(2, "0")}:00`;
  const t = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${(s ?? "00").padStart(2, "0")}${ms ? `.${ms.padEnd(3, "0")}` : ""}${off}`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function num(text: string | undefined): number | null {
  if (text == null) return null;
  const v = Number(String(text).replace(/[,\s]/g, ""));
  return Number.isFinite(v) ? v : null;
}

function parseDirection(raw: string): "buy" | "sell" | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.includes("buy") || s === "0") return "buy";
  if (s.includes("sell") || s === "1") return "sell";
  return null;
}

/* ---------- 通道 A：XML / zip ---------- */

const xmlDecode = (s: string) =>
  s.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** xl/sharedStrings.xml：`<si><t>` 与 `<r><t>` 富文本（拼接 si 内全部 t 节点） */
function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((si) =>
    [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlDecode(t[1])).join(""));
}

/** "BC23" → 列号（0 起）；非字母截断 */
const colToIndex = (ref: string) =>
  [...ref.toUpperCase()].reduce((n, ch) => (ch >= "A" && ch <= "Z" ? n * 26 + ch.charCodeAt(0) - 64 : n), 0) - 1;

/** xl/worksheets/sheet1.xml → 行列矩阵（t="s" 查 sharedStrings；t="str"/无 t 取原始值） */
function sheetToGrid(xml: string, shared: string[]): string[][] {
  const grid: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowXml = row[1] ?? "";
    const rAttr = /\br="(\d+)"/.exec(row[0]);
    const cells: string[] = [];
    for (const cell of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? "";
      const inner = cell[2] ?? "";
      const ref = /\br="([A-Za-z]+)\d+"/.exec(attrs);
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
      let value = t === "inlineStr" ? [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("") : (/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      if (t === "s") value = shared[Number(value)] ?? "";
      cells[ref ? colToIndex(ref[1]) : cells.length] = xmlDecode(value).trim();
    }
    grid[rAttr ? Number(rAttr[1]) - 1 : grid.length] = cells;
  }
  return grid;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined")
    throw new Error("解析失败：当前浏览器不支持原生解压（DecompressionStream），请改用 CSV 报表导入");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** zip 目录解析：EOCD → Central Directory → local header（支持 store/deflate，不支持 zip64） */
async function unzipEntries(buf: ArrayBuffer): Promise<ZipEntry[]> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535) && eocd < 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) eocd = i;
  }
  if (eocd < 0) throw new Error("解析失败：不是有效的 xlsx（zip）文件，请确认由 MT5 导出");
  const total = dv.getUint16(eocd + 10, true);
  if (total === 0xffff) throw new Error("解析失败：不支持 zip64 格式，请用 MT5 直接导出的报表");
  let ptr = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < total && dv.getUint32(ptr, true) === 0x02014b50; n++) {
    const nameLen = dv.getUint16(ptr + 28, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const method = dv.getUint16(ptr + 10, true);
    const lho = dv.getUint32(ptr + 42, true);
    const name = TD.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + dv.getUint16(ptr + 30, true) + dv.getUint16(ptr + 32, true);
    if (dv.getUint32(lho, true) !== 0x04034b50) continue;
    const dataStart = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(dataStart, dataStart + compSize);
    if (method !== 0 && method !== 8) continue;
    entries.push({ name, data: method === 0 ? raw : await inflateRaw(raw) });
  }
  return entries;
}

async function xlsxToGrid(buf: ArrayBuffer): Promise<string[][]> {
  const entries = await unzipEntries(buf);
  const sharedEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  const shared = sharedEntry ? parseSharedStrings(TD.decode(sharedEntry.data)) : [];
  const sheet = entries.find((e) => e.name === "xl/worksheets/sheet1.xml") ?? entries.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name));
  if (!sheet) throw new Error("解析失败：xlsx 中未找到工作表（sheet1），请确认由 MT5 导出");
  return sheetToGrid(TD.decode(sheet.data), shared);
}

/* ---------- 通道 B：CSV/TSV ---------- */

/** 引号感知的行拆分 */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsvGrid(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0] ?? ",";
  return clean.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => splitLine(l, delim).map((c) => c.trim()));
}

/** UTF-8 优先；UTF-16LE BOM / GBK 乱码特征兜底 */
function decodeSmart(buf: ArrayBuffer): string {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("\uFFFD")) return utf8;
  try { return new TextDecoder("gbk").decode(buf); } catch { return utf8; }
}

/* ---------- 「持仓」区块定位 ---------- */

/** 列索引映射；匹配不到的列为 -1（产出置 null） */
interface ColMap {
  ticket: number; type: number; lots: number; item: number;
  openTime: number; closeTime: number; profit: number;
  commission: number; swap: number; openPrice: number; closePrice: number;
}

function mapHeader(cells: string[]): ColMap | null {
  const lower = cells.map((c) => String(c ?? "").trim().toLowerCase());
  const idx = (pred: (h: string) => boolean) => lower.findIndex(pred);
  const ticket = idx((h) => h.includes("ticket") || h.includes("订单"));
  if (ticket < 0) return null;
  const type = idx((h) => h.includes("type") || h.includes("类型"));
  const closeTime = idx((h) => h.includes("close time") || h.includes("平仓时间"));
  if (type < 0 && closeTime < 0) return null;
  // 开/平仓价：显式 Open/Close Price 优先；否则按 Price/价格 出现顺序推断（第 1 个=开仓价，第 2 个=平仓价）
  const priceCols = lower.map((h, i) => (h.includes("price") || h.includes("价格") ? i : -1)).filter((i) => i >= 0);
  let openPrice = idx((h) => (h.includes("price") || h.includes("价格")) && (h.includes("open") || h.includes("开仓")));
  let closePrice = idx((h) => (h.includes("price") || h.includes("价格")) && (h.includes("close") || h.includes("平仓")));
  if (openPrice < 0) openPrice = priceCols.find((i) => i !== closePrice) ?? -1;
  if (closePrice < 0) closePrice = priceCols.findLast((i) => i !== openPrice) ?? -1;
  return {
    ticket, type,
    lots: idx((h) => h.includes("volume") || h.includes("手数")),
    item: idx((h) => h.includes("item") || h.includes("symbol")),
    openTime: idx((h) => h.includes("open time") || h.includes("开仓时间")),
    closeTime,
    profit: idx((h) => h.includes("profit") || h.includes("盈亏")),
    commission: idx((h) => h.includes("commission") || h.includes("佣金")),
    swap: idx((h) => h.includes("swap") || h.includes("库存费")),
    openPrice, closePrice,
  };
}

function sampleLine(grid: string[][]): string {
  const row = grid.slice(0, 6).find((r) => (r ?? []).some(Boolean));
  const s = (row ?? []).filter(Boolean).join(" | ").trim();
  return (s && s.slice(0, 90)) || "（空文件）";
}

function findPositionsHeader(grid: string[][]): { row: number; cols: ColMap } | null {
  // 先找「持仓 / Positions」标记行（表头在其后 1~2 行内），找不到再全表兜底（CSV 通常无标记行）
  const markerRows: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    if ((grid[i] ?? []).some((c) => c.includes("持仓") || /positions/i.test(c))) markerRows.push(i);
  }
  const candidates = markerRows.length ? markerRows.flatMap((m) => [m + 1, m + 2]) : grid.map((_, i) => i);
  for (const row of candidates) {
    const cols = row >= 0 && row < grid.length ? mapHeader(grid[row] ?? []) : null;
    if (cols) return { row, cols };
  }
  return null;
}

/** 行列矩阵 → TradeRow[]：表头下一行起取数，ticket 非数字跳过；收集到数据后遇首个非数据行即止（避免吃进订单/成交区块） */
export function parseMt5Rows(entries: string[][], opts: { offsetHours?: number } = {}): TradeRow[] {
  const offset = opts.offsetHours ?? 3;
  const header = findPositionsHeader(entries);
  if (!header) {
    throw new Error(`解析失败：未找到「持仓」区块表头（需含 Ticket / Type / 时间 等列）。首行样例：${sampleLine(entries)}`);
  }
  const c = header.cols;
  const cell = (cells: string[], i: number) => (i >= 0 ? cells[i] : undefined);
  const rows: TradeRow[] = [];
  for (let i = header.row + 1; i < entries.length; i++) {
    const cells = entries[i] ?? [];
    const ticket = (cell(cells, c.ticket) ?? "").trim();
    if (!/^\d+$/.test(ticket)) {
      if (rows.length > 0) break;
      continue;
    }
    const direction = parseDirection(cell(cells, c.type) ?? "");
    const openTime = parseMt5Time(cell(cells, c.openTime) ?? "", offset), closeTime = parseMt5Time(cell(cells, c.closeTime) ?? "", offset);
    const lots = num(cell(cells, c.lots));
    if (!direction || !openTime || !closeTime || lots == null || lots <= 0) continue; // 未平仓/异常行跳过
    rows.push({
      ticket,
      symbol: c.item >= 0 ? cell(cells, c.item) || undefined : undefined,
      direction, openTime, closeTime, lots,
      openPrice: c.openPrice >= 0 ? num(cell(cells, c.openPrice)) : null,
      closePrice: c.closePrice >= 0 ? num(cell(cells, c.closePrice)) : null,
      profit: num(cell(cells, c.profit)) ?? 0,
      commission: c.commission >= 0 ? (num(cell(cells, c.commission)) ?? 0) : 0,
      swap: c.swap >= 0 ? (num(cell(cells, c.swap)) ?? 0) : 0,
    });
  }
  if (!rows.length) {
    throw new Error(`解析失败：「持仓」区块下没有有效的平仓记录（未平仓单会跳过）。首行样例：${sampleLine(entries)}`);
  }
  return rows;
}

/* ---------- 入口 ---------- */

function extractLogin(fileName: string, grid: string[][]): string | null {
  const byName = /ReportHistory[-_ ]?(\d{3,})/i.exec(fileName);
  if (byName) return byName[1];
  for (const row of grid.slice(0, 40)) {
    const cells = row ?? [];
    for (let j = 0; j < cells.length; j++) {
      if (!/login|账号|登录/i.test(cells[j] ?? "")) continue;
      const hit = /(\d{3,})/.exec(cells[j] ?? "")?.[1] ?? cells.slice(j + 1).find((v) => /^\d{3,}$/.test(v ?? ""));
      if (hit) return hit;
    }
  }
  return null;
}

/** 文件 → TradeRow[]：xlsx 走 zip/原生解压通道，其余按 CSV 解析；login 从文件名或表内容提取 */
export async function parseMt5File(file: File): Promise<{ login: string | null; rows: TradeRow[]; source: Mt5Source }> {
  if (file.size > MAX_MT5_FILE_BYTES) {
    throw new Error(`解析失败：文件超过 10MB 上限（当前 ${(file.size / 1048576).toFixed(1)}MB），请拆分后再导入`);
  }
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const looksZip = head[0] === 0x50 && head[1] === 0x4b;
  let grid: string[][];
  let source: Mt5Source;  if (looksZip || /\.xlsx$/i.test(file.name)) {
    if (!looksZip) throw new Error("解析失败：xlsx 文件头异常，请确认由 MT5 导出的 ReportHistory 文件");
    source = "mt5_xlsx";
    grid = await xlsxToGrid(await file.arrayBuffer());
  } else {
    source = "csv";
    grid = parseCsvGrid(decodeSmart(await file.arrayBuffer()));
  }
  const rows = parseMt5Rows(grid);
  return { login: extractLogin(file.name, grid), rows, source };
}
