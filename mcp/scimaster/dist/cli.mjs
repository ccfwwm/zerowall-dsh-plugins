#!/usr/bin/env node

// src/cli.ts
import { Command as Command8 } from "commander";

// src/utils/config.ts
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
var PASA_MODES = ["ultra_low", "low", "mid", "high"];
var PASA_MODE_DESCRIPTIONS = {
  ultra_low: "Fastest: SN retrieval only, no LLM, no billing",
  low: "Basic: LLM ranking enabled, billed per token (recommended default)",
  mid: "Enhanced: deep LLM evaluation, higher cost",
  high: "Maximum: heaviest mode, highest cost"
};
function isPasaMode(value) {
  return typeof value === "string" && PASA_MODES.includes(value);
}
var ENV_NAMES = ["local", "test", "uat", "prod"];
var ENV_BASE_URLS = {
  local: "http://127.0.0.1:8000",
  test: "https://scimaster.test.bohrium.com",
  uat: "https://scimaster.uat.bohrium.com",
  prod: "https://scimaster.bohrium.com"
};
var ENV_DESCRIPTIONS = {
  local: "\u672C\u5730\uFF1A\u9700\u8981\u672C\u673A\u8D77 muse-api\uFF08\u9ED8\u8BA4 8000 \u7AEF\u53E3\uFF09",
  test: "\u6D4B\u8BD5\uFF1A\u5185\u90E8\u6D4B\u8BD5\u73AF\u5883",
  uat: "UAT\uFF1A\u9884\u53D1\u5E03\u73AF\u5883",
  prod: "\u751F\u4EA7\uFF1A\u7EBF\u4E0A\u6B63\u5F0F\u73AF\u5883"
};
function isEnvName(value) {
  return typeof value === "string" && ENV_NAMES.includes(value);
}
function resolveEnvFromBaseUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  for (const env of ENV_NAMES) {
    if (ENV_BASE_URLS[env].replace(/\/+$/, "") === normalized) return env;
  }
  return null;
}
function getConfigDir() {
  return join(homedir(), ".scimaster");
}
function getConfigPath() {
  return join(getConfigDir(), "config.json");
}
var DEFAULT_ENV = "prod";
var DEFAULT_CONFIG = {
  version: 1,
  apiKey: "",
  apiBaseUrl: ENV_BASE_URLS[DEFAULT_ENV],
  defaults: {
    limit: 10,
    mode: "low"
  }
};
function readConfig() {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults } };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const merged = {
      ...DEFAULT_CONFIG,
      ...parsed,
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...parsed.defaults ?? {}
      }
    };
    if (!isPasaMode(merged.defaults.mode)) {
      merged.defaults.mode = DEFAULT_CONFIG.defaults.mode;
    }
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults } };
  }
}
function writeConfig(cfg) {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), { encoding: "utf-8", mode: 384 });
  try {
    chmodSync(configPath, 384);
  } catch {
  }
}

// src/utils/logger.ts
var USE_COLOR = process.stdout.isTTY !== false;
var c = {
  reset: USE_COLOR ? "\x1B[0m" : "",
  green: USE_COLOR ? "\x1B[32m" : "",
  red: USE_COLOR ? "\x1B[31m" : "",
  yellow: USE_COLOR ? "\x1B[33m" : "",
  cyan: USE_COLOR ? "\x1B[36m" : "",
  bold: USE_COLOR ? "\x1B[1m" : "",
  dim: USE_COLOR ? "\x1B[2m" : ""
};
var useStderr = false;
function redirectLoggerToStderr() {
  useStderr = true;
}
function out(msg) {
  if (useStderr) console.error(msg);
  else console.log(msg);
}
var logger = {
  info(msg) {
    out(`${c.cyan}\u2139${c.reset} ${msg}`);
  },
  success(msg) {
    out(`${c.green}\u2714${c.reset} ${msg}`);
  },
  error(msg) {
    console.error(`${c.red}\u2716${c.reset} ${msg}`);
  },
  warn(msg) {
    console.warn(`${c.yellow}\u26A0${c.reset} ${msg}`);
  },
  bold(msg) {
    return `${c.bold}${msg}${c.reset}`;
  },
  dim(msg) {
    return `${c.dim}${msg}${c.reset}`;
  }
};

// src/commands/env.ts
import { Command } from "commander";
import { select } from "@inquirer/prompts";
var envCommand = new Command("env").description("\u67E5\u770B / \u5207\u6362 muse-api \u73AF\u5883 (local / test / uat / prod)").argument(
  "[name]",
  `\u76F4\u63A5\u8BBE\u7F6E\u73AF\u5883\uFF08\u53EF\u9009\uFF09\u3002\u5141\u8BB8\u503C: ${ENV_NAMES.join(" / ")}`
).option("--show", "\u4EC5\u663E\u793A\u5F53\u524D\u73AF\u5883").action(async (name, opts) => {
  const cfg = readConfig();
  const current = resolveEnvFromBaseUrl(cfg.apiBaseUrl);
  if (opts.show) {
    printCurrent(current, cfg.apiBaseUrl);
    return;
  }
  if (name !== void 0) {
    if (!isEnvName(name)) {
      logger.error(
        `\u4E0D\u652F\u6301\u7684\u73AF\u5883: "${name}"\u3002\u5141\u8BB8\u503C: ${ENV_NAMES.join(" / ")}`
      );
      process.exit(1);
    }
    persist(cfg, name, current);
    return;
  }
  let picked;
  try {
    picked = await select({
      message: "\u9009\u62E9 muse-api \u73AF\u5883",
      // 当前是 custom 时不预选任何项，让用户主动选
      ...current ? { default: current } : {},
      choices: ENV_NAMES.map((e) => ({
        name: `${e}${e === current ? " (\u5F53\u524D)" : ""}`,
        value: e,
        description: `${ENV_BASE_URLS[e]} \u2014 ${ENV_DESCRIPTIONS[e]}`
      }))
    });
  } catch {
    logger.info("\u5DF2\u53D6\u6D88");
    process.exit(0);
  }
  if (picked === current) {
    logger.info(`\u73AF\u5883\u672A\u53D8\uFF08\u4ECD\u4E3A ${logger.bold(current)}\uFF09`);
    return;
  }
  persist(cfg, picked, current);
});
function persist(cfg, next, current) {
  const nextUrl = ENV_BASE_URLS[next];
  writeConfig({
    ...cfg,
    apiBaseUrl: nextUrl
  });
  logger.success(`\u5DF2\u5207\u6362\u73AF\u5883\u4E3A ${logger.bold(next)}`);
  console.log(logger.dim(`  apiBaseUrl: ${nextUrl}`));
  console.log(logger.dim(`  ${ENV_DESCRIPTIONS[next]}`));
  if (current !== next && cfg.apiKey) {
    console.log();
    logger.warn("API Key \u672A\u6E05\u7A7A\uFF1B\u4E0D\u540C\u73AF\u5883\u7684 Key \u901A\u5E38\u4E0D\u901A\u7528\uFF0C\u5FC5\u8981\u65F6\u8FD0\u884C sci init \u91CD\u65B0\u8BBE\u7F6E\u3002");
  }
}
function printCurrent(current, baseUrl) {
  if (current) {
    logger.info(`\u5F53\u524D\u73AF\u5883: ${logger.bold(current)}`);
    console.log(logger.dim(`  apiBaseUrl: ${baseUrl}`));
    console.log(logger.dim(`  ${ENV_DESCRIPTIONS[current]}`));
  } else {
    logger.info(`\u5F53\u524D\u73AF\u5883: ${logger.bold("custom")}`);
    console.log(logger.dim(`  apiBaseUrl: ${baseUrl}`));
    console.log(
      logger.dim("  \u672A\u5339\u914D\u9884\u8BBE\u73AF\u5883\uFF08apiBaseUrl \u88AB\u624B\u52A8\u4FEE\u6539\u8FC7\uFF09")
    );
  }
  console.log();
  console.log("\u5168\u90E8\u73AF\u5883:");
  for (const e of ENV_NAMES) {
    const marker = e === current ? "*" : " ";
    console.log(
      `  ${marker} ${e.padEnd(6)} ${ENV_BASE_URLS[e].padEnd(40)} ${logger.dim(ENV_DESCRIPTIONS[e])}`
    );
  }
}

// src/commands/init.ts
import { Command as Command2 } from "commander";
import { password, confirm } from "@inquirer/prompts";

// src/api/sciland.ts
var SEARCH_PREFERENCES = ["English", "Chinese", "default"];
var AuthError = class extends Error {
  constructor(detail) {
    super(detail ? `API Key \u9274\u6743\u5931\u8D25\uFF1A${detail}` : "API Key \u65E0\u6548\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u8FD0\u884C sci init \u91CD\u65B0\u914D\u7F6E");
    this.name = "AuthError";
  }
};
var NetworkError = class extends Error {
  constructor(cause) {
    const msg = typeof cause === "string" ? cause : "\u65E0\u6CD5\u8FDE\u63A5\u5230 muse-api\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216\u670D\u52A1\u5730\u5740";
    super(msg);
    this.name = "NetworkError";
    if (cause && typeof cause !== "string") this.cause = cause;
  }
};
var ReviewCreateUncertainError = class extends NetworkError {
  constructor(error) {
    super(error.message);
    this.name = "ReviewCreateUncertainError";
    this.cause = error;
  }
};
var ApiError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "ApiError";
  }
};
var PAPER_SEARCH_PATH = "/openapi/v1/paper_search";
var PAPER_SEARCH_QUOTA_PATH = `${PAPER_SEARCH_PATH}/quota`;
var PAPER_REVIEW_PATH = "/openapi/v1/paper_review";
var CREATE_REVIEW_TIMEOUT_MS = 3e5;
var REPORT_DOWNLOAD_TIMEOUT_MS = 3e5;
var REVIEW_STATUSES = [
  "queued",
  "launching",
  "running",
  "succeeded",
  "failed",
  "timed_out"
];
var REVIEW_MODES = ["author", "reviewer"];
async function sleep(ms, signal) {
  return new Promise((resolve4, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve4();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}
var REQUEST_TIMEOUT_MS = 3e4;
function museItemToPaper(item) {
  const authors = splitAuthors(item.authors);
  const year = (item.year || "").trim();
  const url = (item.url || "").trim();
  const venue = nonEmpty(item.venue);
  const reason = nonEmpty(item.relevance);
  const arxivId = nonEmpty(item.arxivId);
  const explicitDoi = nonEmpty(item.doi);
  const ccf = nonEmpty(item.ccf);
  const description = nonEmpty(item.description);
  return {
    id: deriveId(url, item.title),
    source: deriveSource(url),
    title: (item.title || "").trim(),
    authors,
    year,
    abstract: (item.snippet || "").trim(),
    doi: explicitDoi ?? deriveDoi(url),
    url,
    venue,
    reason,
    bib: item.bib && item.bib.trim() ? item.bib : void 0,
    arxivId,
    ccf,
    description,
    citations: finiteNumber(item.citations),
    originScore: finiteNumber(item.originScore),
    selectScore: finiteNumber(item.selectScore),
    impactFactor: finiteNumber(item.impactFactor),
    h5Index: finiteNumber(item.h5Index)
  };
}
function nonEmpty(v) {
  if (v === null || v === void 0) return void 0;
  const trimmed = v.trim();
  return trimmed ? trimmed : void 0;
}
function finiteNumber(v) {
  if (typeof v !== "number") return void 0;
  return Number.isFinite(v) ? v : void 0;
}
function parseTimestampMs(v) {
  if (typeof v !== "string") return void 0;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : void 0;
}
function splitAuthors(raw) {
  if (!raw) return [];
  const byAnd = raw.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  if (byAnd.length > 1) return byAnd;
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}
function deriveId(url, title) {
  const lower = url.toLowerCase();
  const arxivMatch = lower.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/);
  if (arxivMatch && arxivMatch[1]) return `arxiv:${arxivMatch[1]}`;
  const pubmedMatch = lower.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d+)/);
  if (pubmedMatch && pubmedMatch[1]) return `pubmed:${pubmedMatch[1]}`;
  const doi = deriveDoi(url);
  if (doi) return `doi:${doi}`;
  return `title:${shortHash(title || url)}`;
}
function deriveSource(url) {
  const lower = url.toLowerCase();
  if (lower.includes("arxiv.org")) return "arxiv";
  if (lower.includes("pubmed.ncbi.nlm.nih.gov") || lower.includes("ncbi.nlm.nih.gov/pubmed")) return "pubmed";
  if (lower.includes("doi.org")) return "doi";
  if (!lower) return "unknown";
  return "other";
}
function deriveDoi(url) {
  const m = url.match(/doi\.org\/(10\.[^\s/?#]+\/[^\s?#]+)/i);
  return m ? m[1] : void 0;
}
function shortHash(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) + h ^ input.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function parseReviewTaskItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("muse-api \u8FD4\u56DE\u4E86\u65E0\u6548\u7684 review \u4EFB\u52A1\u6761\u76EE");
  }
  const item = value;
  const taskUuid = typeof item.uuid === "string" ? item.uuid.trim() : "";
  const createdAtMs = typeof item.created_at === "string" ? Date.parse(item.created_at) : Number.NaN;
  if (!taskUuid || !Number.isFinite(createdAtMs)) {
    throw new ApiError("muse-api \u8FD4\u56DE\u4E86\u65E0\u6548\u7684 review \u4EFB\u52A1\u6761\u76EE");
  }
  if (!REVIEW_STATUSES.includes(item.status)) {
    throw new ApiError("muse-api \u8FD4\u56DE\u4E86\u65E0\u6548\u7684 review \u72B6\u6001");
  }
  if (!REVIEW_MODES.includes(item.review_mode)) {
    throw new ApiError("muse-api \u8FD4\u56DE\u4E86\u65E0\u6548\u7684 review mode");
  }
  let targetVenue;
  if (item.target_venue === null) {
    targetVenue = null;
  } else if (typeof item.target_venue === "string" && nonEmpty(item.target_venue)) {
    targetVenue = item.target_venue.trim();
  } else {
    throw new ApiError("muse-api \u8FD4\u56DE\u4E86\u65E0\u6548\u7684 target venue");
  }
  const phase = typeof item.phase === "string" ? nonEmpty(item.phase) : void 0;
  const pdfName = typeof item.pdf_name === "string" ? nonEmpty(item.pdf_name) : void 0;
  return {
    taskUuid,
    status: item.status,
    reviewMode: item.review_mode,
    targetVenue,
    ...phase ? { phase } : {},
    ...pdfName ? { pdfName } : {},
    createdAtMs
  };
}
var ScilandClient = class {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }
  /**
   * 创建一次 paper_search 任务，立刻返回 task_id。
   *
   * muse-api ≥ 0.x 改造后 ``POST /openapi/v1/paper_search`` 改成异步：
   * 这一步只是同步调 PasaMaster 创建 task（<2s 内返回），实际的 LLM 评分由
   * 服务端 background task 跑。CLI 用这里拿到的 ``task_id`` 走 ``getResult``
   * 轮询，根治网关 ``proxy_read_timeout`` 截胡。
   */
  async createTask(query, mode, score = 70, paperLimit = 50, preference = "English") {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${PAPER_SEARCH_PATH}`;
    const body = { query, score, paper_limit: paperLimit, preference };
    if (mode) body["mode"] = mode;
    const data = await this.fetchWithRetry(url, {
      method: "POST",
      body: JSON.stringify(body)
    });
    const taskId = (data?.task_id || "").trim();
    if (!taskId) {
      throw new ApiError("muse-api \u8FD4\u56DE\u7684 task_id \u4E3A\u7A7A");
    }
    return taskId;
  }
  /**
   * 查询某个 task 的当前状态；不阻塞。
   *
   * - ``status='pending'`` → 调用方应隔几秒再来；不应当抛错
   * - ``status='done'``    → ``papers`` 必填，可能很多篇（透传），CLI 自己 slice
   * - ``status='failed'``  → ``error`` 是用户可读的失败原因
   */
  async getResult(taskId) {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${PAPER_SEARCH_PATH}/${encodeURIComponent(taskId)}`;
    const data = await this.fetchWithRetry(url, {
      method: "GET"
    });
    const status = data?.status;
    if (status === "pending") {
      return { status: "pending" };
    }
    if (status === "failed") {
      return {
        status: "failed",
        error: (data?.error || "").trim() || "PasaMaster \u4EFB\u52A1\u5931\u8D25\uFF08\u672A\u63D0\u4F9B error \u8BE6\u60C5\uFF09"
      };
    }
    if (status === "done") {
      const items = Array.isArray(data?.papers) ? data.papers : [];
      return { status: "done", papers: items.map(museItemToPaper) };
    }
    return { status: "pending" };
  }
  async getUsage() {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${PAPER_SEARCH_QUOTA_PATH}`;
    const data = await this.fetchWithRetry(url, {
      method: "GET"
    });
    return {
      freeQuota: String(data.free_quota ?? "0"),
      modeCalls: {
        ultra_low: Number(data.mode_calls?.ultra_low ?? 0),
        low: Number(data.mode_calls?.low ?? 0),
        mid: Number(data.mode_calls?.mid ?? 0),
        high: Number(data.mode_calls?.high ?? 0)
      }
    };
  }
  async createReview(input, signal) {
    const baseUrl = this.baseUrl.replace(/\/+$/, "");
    const presigned = await this.fetchWithRetry(
      `${baseUrl}${PAPER_REVIEW_PATH}/presign-upload`,
      { method: "POST", retryOn429: false, signal }
    );
    const uploadId = typeof presigned.upload_id === "string" ? presigned.upload_id.trim() : "";
    const uploadUrl = typeof presigned.upload_url === "string" ? presigned.upload_url.trim() : "";
    const requiredHeaders = presigned.required_headers;
    if (!uploadId || !uploadUrl || !requiredHeaders || typeof requiredHeaders !== "object" || Array.isArray(requiredHeaders) || Object.values(requiredHeaders).some((value) => typeof value !== "string")) {
      throw new ApiError("muse-api \u8FD4\u56DE\u4E86\u65E0\u6548\u7684 PDF \u9884\u7B7E\u540D\u4E0A\u4F20\u4FE1\u606F");
    }
    const uploadTimeoutSignal = AbortSignal.timeout(CREATE_REVIEW_TIMEOUT_MS);
    const uploadSignal = signal ? AbortSignal.any([signal, uploadTimeoutSignal]) : uploadTimeoutSignal;
    try {
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: requiredHeaders,
        body: new Blob([Uint8Array.from(input.pdfBytes)], { type: "application/pdf" }),
        signal: uploadSignal
      });
      if (!uploadResponse.ok) {
        const detail = await safeReadErrorMessage(uploadResponse);
        throw new ApiError(
          `PDF \u4E0A\u4F20\u5931\u8D25\uFF1AHTTP ${uploadResponse.status}${detail ? `: ${detail}` : ""}`,
          uploadResponse.status
        );
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw new NetworkError("\u8BF7\u6C42\u5DF2\u53D6\u6D88");
      if (uploadTimeoutSignal.aborted) {
        throw new NetworkError(`PDF \u4E0A\u4F20\u8D85\u65F6\uFF08${Math.round(CREATE_REVIEW_TIMEOUT_MS / 1e3)}s\uFF09`);
      }
      throw new NetworkError(error);
    }
    let data;
    try {
      data = await this.fetchWithRetry(`${baseUrl}${PAPER_REVIEW_PATH}`, {
        method: "POST",
        body: JSON.stringify({
          upload_id: uploadId,
          review_mode: input.reviewMode,
          ...input.targetVenue !== void 0 ? { target_venue: input.targetVenue } : {},
          brief: input.brief,
          report_language: input.reportLanguage,
          pdf_name: input.pdfName
        }),
        timeoutMs: CREATE_REVIEW_TIMEOUT_MS,
        retryOn429: false,
        signal
      });
    } catch (error) {
      if (error instanceof NetworkError) throw new ReviewCreateUncertainError(error);
      throw error;
    }
    return parseReviewTaskItem(data);
  }
  async listReviews(options = {}, signal) {
    const params = new URLSearchParams({
      limit: String(options.limit ?? 20),
      offset: String(options.offset ?? 0)
    });
    if (options.status) params.set("status", options.status);
    const url = `${this.baseUrl.replace(/\/+$/, "")}${PAPER_REVIEW_PATH}?${params.toString()}`;
    const data = await this.fetchWithRetry(url, {
      method: "GET",
      signal
    });
    if (!Array.isArray(data)) throw new ApiError("muse-api \u8FD4\u56DE\u7684 review \u5217\u8868\u4E0D\u662F\u6570\u7EC4");
    return data.map(parseReviewTaskItem);
  }
  async getReview(taskUuid, signal) {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${PAPER_REVIEW_PATH}/${encodeURIComponent(taskUuid)}`;
    const data = await this.fetchWithRetry(url, {
      method: "GET",
      signal
    });
    const item = parseReviewTaskItem(data);
    const artifacts = {};
    for (const [kind, link] of Object.entries(data.artifacts ?? {})) {
      const artifactUrl = link && typeof link.url === "string" ? link.url.trim() : "";
      if (!artifactUrl) continue;
      const sha256 = typeof link.sha256 === "string" ? nonEmpty(link.sha256) : void 0;
      artifacts[kind] = {
        url: artifactUrl,
        ...typeof link.size === "number" && Number.isFinite(link.size) ? { size: link.size } : {},
        ...sha256 ? { sha256 } : {}
      };
    }
    const agents = data.agents && typeof data.agents === "object" && !Array.isArray(data.agents) ? data.agents : {};
    const phase = typeof data.phase === "string" ? nonEmpty(data.phase) : void 0;
    const pdfName = typeof data.pdf_name === "string" ? nonEmpty(data.pdf_name) : void 0;
    const brief = typeof data.brief === "string" ? nonEmpty(data.brief) : void 0;
    const reportLanguage = typeof data.report_language === "string" ? nonEmpty(data.report_language) : void 0;
    const errorMessage = typeof data.error_message === "string" ? nonEmpty(data.error_message) : void 0;
    const urlExpiresAt = finiteNumber(data.url_expires_at);
    const createdAtMs = parseTimestampMs(data.created_at);
    const launchedAtMs = parseTimestampMs(data.launched_at);
    const finishedAtMs = parseTimestampMs(data.finished_at);
    let revisionProtocol;
    if (data.revision_protocol !== null && data.revision_protocol !== void 0) {
      if (data.revision_protocol !== "reviewmaster.revision.v2.1") {
        throw new ApiError("muse-api \u8FD4\u56DE\u4E86\u65E0\u6548\u7684 revision protocol");
      }
      revisionProtocol = data.revision_protocol;
    }
    const fastReviewError = data.fast_review_error && typeof data.fast_review_error.code === "string" && typeof data.fast_review_error.message === "string" ? {
      code: data.fast_review_error.code,
      message: data.fast_review_error.message
    } : void 0;
    return {
      taskUuid: item.taskUuid,
      status: item.status,
      reviewMode: item.reviewMode,
      targetVenue: item.targetVenue,
      fastReviewStatus: typeof data.fast_review_status === "string" ? data.fast_review_status : "queued",
      ...revisionProtocol ? { revisionProtocol } : {},
      ...fastReviewError ? { fastReviewError } : {},
      ...phase ? { phase } : {},
      ...pdfName ? { pdfName } : {},
      ...brief ? { brief } : {},
      ...reportLanguage ? { reportLanguage } : {},
      ...errorMessage ? { errorMessage } : {},
      agents,
      artifacts,
      ...urlExpiresAt !== void 0 ? { urlExpiresAt } : {},
      ...createdAtMs !== void 0 ? { createdAtMs } : {},
      ...launchedAtMs !== void 0 ? { launchedAtMs } : {},
      ...finishedAtMs !== void 0 ? { finishedAtMs } : {}
    };
  }
  /**
   * 下载服务端投影的报告（md / pdf / docx）。
   *
   * 渲染端点返回二进制流而非统一 JSON envelope，不走 ``fetchWithRetry``，
   * 用独立带 Bearer 头的二进制 fetch（带超时）。
   */
  async downloadReport(taskUuid, format, signal) {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${PAPER_REVIEW_PATH}/${encodeURIComponent(taskUuid)}/report.${format}`;
    const timeoutSignal = AbortSignal.timeout(REPORT_DOWNLOAD_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: requestSignal
      });
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(await safeReadErrorMessage(res));
      }
      if (!res.ok) {
        const detail = await safeReadErrorMessage(res);
        throw new ApiError(`HTTP ${res.status}: ${detail || res.statusText}`, res.status);
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const json = await res.json();
        if (!isApiResponseEnvelope(json)) {
          throw new ApiError("\u670D\u52A1\u7AEF\u8FD4\u56DE\u4E86\u610F\u5916\u7684 JSON \u54CD\u5E94\u800C\u975E\u62A5\u544A\u6587\u4EF6");
        }
        const msg = json.error_message || `\u670D\u52A1\u7AEF\u8FD4\u56DE\u9519\u8BEF code=${json.code}`;
        if (json.code === 401 || json.code === 403) throw new AuthError(msg);
        throw new ApiError(msg, json.code);
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (err instanceof AuthError || err instanceof NetworkError || err instanceof ApiError) throw err;
      if (signal?.aborted) throw new NetworkError("\u8BF7\u6C42\u5DF2\u53D6\u6D88");
      if (timeoutSignal.aborted) {
        throw new NetworkError(`\u62A5\u544A\u4E0B\u8F7D\u8D85\u65F6\uFF08${Math.round(REPORT_DOWNLOAD_TIMEOUT_MS / 1e3)}s\uFF09`);
      }
      throw new NetworkError(err);
    }
  }
  /**
   * 本地格式校验：检查 apiKey 是否非空。
   * 注意：当前 muse-api 没有专门的 ping 接口；真实有效性要在 sci search 调用时
   * 由服务端 401 反馈。如果未来 muse-api 加 GET /openapi/v1/ping，把这里改成
   * 真发 HTTP 即可（重用 fetchWithRetry 的 401 → AuthError 路径）。
   */
  async validateKey() {
    return typeof this.apiKey === "string" && this.apiKey.trim().length > 0;
  }
  async fetchWithRetry(url, init = { method: "GET" }, retries = 3) {
    const timeoutMs = init.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json"
    };
    if (!(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
    try {
      const res = await fetch(url, {
        method: init.method,
        headers,
        body: init.body,
        signal: requestSignal
      });
      if (res.status === 401 || res.status === 403) {
        const detail = await safeReadErrorMessage(res);
        throw new AuthError(detail);
      }
      if (res.status === 429) {
        if (init.retryOn429 === false) {
          const detail = await safeReadErrorMessage(res);
          throw new ApiError(detail || "\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41", 429);
        }
        if (retries <= 0) throw new NetworkError("Rate limit exceeded after retries");
        await sleep(1e3, requestSignal);
        return this.fetchWithRetry(url, init, retries - 1);
      }
      if (!res.ok) {
        const detail = await safeReadErrorMessage(res);
        throw new ApiError(`HTTP ${res.status}: ${detail || res.statusText}`, res.status);
      }
      const json = await res.json();
      if (!isApiResponseEnvelope(json)) {
        throw new ApiError("\u670D\u52A1\u7AEF\u8FD4\u56DE\u7684\u54CD\u5E94\u4E0D\u662F\u7EDF\u4E00 API envelope");
      }
      if (json.status === "success" && json.code === 0) {
        if (json.data === null || json.data === void 0) {
          throw new ApiError("\u670D\u52A1\u7AEF\u8FD4\u56DE\u6210\u529F\u4F46 data \u4E3A\u7A7A", json.code);
        }
        return json.data;
      }
      const msg = json.error_message || `\u670D\u52A1\u7AEF\u8FD4\u56DE\u9519\u8BEF code=${json.code}`;
      if (json.code === 401 || json.code === 403) throw new AuthError(msg);
      throw new ApiError(msg, json.code);
    } catch (err) {
      if (err instanceof AuthError || err instanceof NetworkError || err instanceof ApiError) throw err;
      if (init.signal?.aborted) throw new NetworkError("\u8BF7\u6C42\u5DF2\u53D6\u6D88");
      if (timeoutSignal.aborted) throw new NetworkError(`\u8BF7\u6C42\u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)}s\uFF09`);
      throw new NetworkError(err);
    }
  }
};
function isApiResponseEnvelope(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  return typeof v["code"] === "number" && (v["status"] === "success" || v["status"] === "error") && "data" in v && "error_message" in v;
}
async function safeReadErrorMessage(res) {
  try {
    const cloned = res.clone();
    const j = await cloned.json();
    if (j && typeof j === "object" && typeof j.error_message === "string") {
      return j.error_message;
    }
  } catch {
  }
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// src/commands/init.ts
function maskKey(key) {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}
var initCommand = new Command2("init").description("Interactively configure your Sciland API key").action(async () => {
  const cfg = readConfig();
  if (cfg.apiKey) {
    logger.info(`Current API key: ${maskKey(cfg.apiKey)}`);
    const overwrite = await confirm({
      message: "Overwrite existing API key?",
      default: false
    });
    if (!overwrite) {
      logger.info("Cancelled. Existing key unchanged.");
      process.exit(0);
    }
  }
  const apiKey = await password({
    message: "Enter your Sciland API key:",
    mask: "*"
  });
  if (!apiKey || apiKey.trim() === "") {
    logger.error("API key cannot be empty");
    process.exit(1);
  }
  const client = new ScilandClient(apiKey.trim(), cfg.apiBaseUrl);
  const valid = await client.validateKey().catch(() => false);
  if (!valid) {
    logger.error("API key cannot be empty.");
    process.exit(1);
  }
  writeConfig({ ...cfg, apiKey: apiKey.trim() });
  logger.success("API key saved! (Server-side validity is verified on your first sci search.)");
  console.log();
  console.log("Quick start:");
  console.log("  sci model                                # choose default search mode (affects billing)");
  console.log('  sci search "CRISPR gene editing 2024"');
  console.log('  sci search "machine learning protein" --limit 20');
  console.log('  sci search "cancer immunotherapy" --mode mid --out ./papers');
  console.log();
});

// src/commands/model.ts
import { Command as Command3 } from "commander";
import { select as select2 } from "@inquirer/prompts";
var modelCommand = new Command3("model").description("View or set the PasaMaster search mode (ultra_low / low / mid / high)").argument(
  "[mode]",
  `Set mode directly (optional). Allowed values: ${PASA_MODES.join(" / ")}`
).option("--show", "Print current mode and exit").action(async (mode, opts) => {
  const cfg = readConfig();
  const current = cfg.defaults.mode;
  if (opts.show) {
    printCurrent2(current);
    return;
  }
  if (mode !== void 0) {
    if (!isPasaMode(mode)) {
      logger.error(
        `Unknown mode: "${mode}". Allowed values: ${PASA_MODES.join(" / ")}`
      );
      process.exit(1);
    }
    persist2(cfg, mode);
    return;
  }
  let picked;
  try {
    picked = await select2({
      message: "Select PasaMaster search mode",
      default: current,
      choices: PASA_MODES.map((m) => ({
        name: `${m}${m === current ? " (current)" : ""}`,
        value: m,
        description: PASA_MODE_DESCRIPTIONS[m]
      }))
    });
  } catch {
    logger.info("Cancelled");
    process.exit(0);
  }
  if (picked === current) {
    logger.info(`Mode unchanged (still ${logger.bold(current)})`);
    return;
  }
  persist2(cfg, picked);
});
function persist2(cfg, mode) {
  writeConfig({
    ...cfg,
    defaults: { ...cfg.defaults, mode }
  });
  logger.success(`Mode set to ${logger.bold(mode)}`);
  console.log(logger.dim(`  ${PASA_MODE_DESCRIPTIONS[mode]}`));
}
function printCurrent2(current) {
  logger.info(`Current mode: ${logger.bold(current)}`);
  console.log(logger.dim(`  ${PASA_MODE_DESCRIPTIONS[current]}`));
  console.log();
  console.log("All modes:");
  for (const m of PASA_MODES) {
    const marker = m === current ? "*" : " ";
    console.log(`  ${marker} ${m.padEnd(10)} ${logger.dim(PASA_MODE_DESCRIPTIONS[m])}`);
  }
}

// src/commands/review.ts
import { confirm as confirm2 } from "@inquirer/prompts";
import { Command as Command4 } from "commander";
import { mkdirSync as mkdirSync2, statSync, writeFileSync as writeFileSync2 } from "fs";
import { basename as basename2, join as join3, resolve as resolve2 } from "path";

// src/specs/review.ts
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join as join2, resolve } from "node:path";
import { z as z2 } from "zod";

// src/specs/search.ts
import { z } from "zod";
var SearchInputSchema = z.object({
  query: z.string().min(1, "query \u4E0D\u80FD\u4E3A\u7A7A").describe("\u641C\u7D22\u5173\u952E\u8BCD\uFF08\u81EA\u7136\u8BED\u8A00\uFF0C\u4F8B\uFF1ACRISPR gene editing 2024\uFF09"),
  limit: z.number().int().min(1).max(50).default(50).describe("\u8FD4\u56DE\u7BC7\u6570\uFF0C1-50\uFF1B\u4E0D\u4F20\u9ED8\u8BA4 50"),
  mode: z.enum(PASA_MODES).optional().describe(
    "PasaMaster \u641C\u7D22\u6863\u4F4D\uFF08ultra_low / low / mid / high\uFF09\uFF0C\u4E0D\u4F20\u5219\u4F7F\u7528 ~/.scimaster/config.json \u4E2D\u7684 defaults.mode"
  ),
  preference: z.enum(SEARCH_PREFERENCES).default("English").describe("\u68C0\u7D22\u8BED\u8A00\u504F\u597D\uFF1AEnglish / Chinese / default\uFF1B\u4E0D\u4F20\u9ED8\u8BA4 English")
});
var SearchError = class extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.kind = kind;
    this.cause = cause;
    this.name = "SearchError";
  }
};
var POLL_INTERVAL_MS_DEFAULT = 3e3;
var MAX_WAIT_MS_DEFAULT = 30 * 6e4;
async function runSearch(input, cfg, options) {
  const parsed = SearchInputSchema.parse(input);
  const resolved = cfg ?? readConfig();
  if (!resolved.apiKey) {
    throw new SearchError(
      "no_api_key",
      "\u672A\u914D\u7F6E API Key\uFF0C\u8BF7\u5148\u8FD0\u884C sci init \u6216\u901A\u8FC7 sci --setApiKey <key> \u8BBE\u7F6E"
    );
  }
  const mode = parsed.mode ?? resolved.defaults.mode;
  const client = new ScilandClient(resolved.apiKey, resolved.apiBaseUrl);
  const pollInterval = options?.pollIntervalMs ?? POLL_INTERVAL_MS_DEFAULT;
  const maxWait = options?.maxWaitMs ?? MAX_WAIT_MS_DEFAULT;
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new SearchError("cancelled", "\u641C\u7D22\u5DF2\u53D6\u6D88");
  }
  let taskId;
  try {
    taskId = await client.createTask(parsed.query, mode, void 0, parsed.limit, parsed.preference);
  } catch (err) {
    throw mapClientError(err);
  }
  const startedAt = Date.now();
  let pollCount = 0;
  while (true) {
    if (signal?.aborted) {
      throw new SearchError("cancelled", "\u641C\u7D22\u5DF2\u53D6\u6D88\uFF08Ctrl+C\uFF09");
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > maxWait) {
      throw new SearchError(
        "timeout",
        `\u7B49\u5F85 PasaMaster \u641C\u7D22\u8D85\u65F6\uFF08${Math.round(maxWait / 1e3)}s\uFF09\uFF0Ctask_id=${taskId}`
      );
    }
    let pollResult;
    try {
      pollResult = await client.getResult(taskId);
    } catch (err) {
      throw mapClientError(err);
    }
    pollCount += 1;
    try {
      options?.onProgress?.({ taskId, elapsedMs, pollCount });
    } catch {
    }
    if (pollResult.status === "done") {
      const allPapers = pollResult.papers ?? [];
      return {
        effective: {
          query: parsed.query,
          limit: parsed.limit,
          mode,
          preference: parsed.preference
        },
        // muse-api 端透传 PasaMaster 全量，CLI 这里按用户请求切到 limit。
        papers: allPapers.slice(0, parsed.limit)
      };
    }
    if (pollResult.status === "failed") {
      throw new SearchError(
        "api",
        pollResult.error ?? "PasaMaster \u4EFB\u52A1\u5931\u8D25\uFF08\u672A\u63D0\u4F9B error \u8BE6\u60C5\uFF09"
      );
    }
    try {
      await sleepAbortable(pollInterval, signal);
    } catch {
      throw new SearchError("cancelled", "\u641C\u7D22\u5DF2\u53D6\u6D88\uFF08Ctrl+C\uFF09");
    }
  }
}
function mapClientError(err) {
  if (err instanceof AuthError) return new SearchError("auth", err.message, err);
  if (err instanceof NetworkError) {
    return new SearchError("network", err.message, err);
  }
  if (err instanceof ApiError) return new SearchError("api", err.message, err);
  return new SearchError(
    "unknown",
    err instanceof Error ? err.message : String(err),
    err
  );
}
function sleepAbortable(ms, signal) {
  return new Promise((resolve4, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve4();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// src/specs/review.ts
var SubmitReviewInputSchema = z2.object({
  pdfPath: z2.string(),
  brief: z2.string().optional(),
  // 服务端 report_language 是自由字符串，CLI 不做枚举收紧。
  language: z2.string().trim().min(1).default("en"),
  mode: z2.enum(REVIEW_MODES),
  targetVenue: z2.string().trim().min(1).max(255).optional()
});
var ReviewError = class extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.kind = kind;
    this.cause = cause;
    this.name = "ReviewError";
  }
};
var ARTIFACT_KEYS = [
  "report",
  "cards",
  "evidence",
  "refs",
  "fast",
  "manuscript",
  "validation"
];
var SERVER_ARTIFACT_KEYS = {
  cards: "review_cards",
  evidence: "external_evidence",
  refs: "reference_check",
  fast: "fast_review",
  manuscript: "pdf",
  validation: "validation"
};
var ARTIFACT_FILENAMES = {
  cards: "review_cards.json",
  evidence: "external_evidence.json",
  refs: "reference_check.json",
  fast: "fast_review.md",
  manuscript: "manuscript.pdf",
  validation: "review_cards.validation.json"
};
var TERMINAL_REVIEW_STATUSES = ["succeeded", "failed", "timed_out"];
var MAX_PDF_BYTES = 50 * 1024 * 1024;
var POLL_INTERVAL_MS = 1e4;
var RECOVERY_DELAYS_MS = [15e3, 45e3];
var CLOCK_SKEW_TOLERANCE_MS = 6e4;
var ARTIFACT_DOWNLOAD_TIMEOUT_MS = 3e5;
function reviewTaskDirName(pdfName, taskUuid) {
  const stem = (pdfName ?? "").replace(/\.pdf$/i, "");
  const slug = stem.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "paper";
  return `review-${slug}-${taskUuid.slice(0, 8)}`;
}
function resolveApiConfig(cfg) {
  const resolved = cfg ?? readConfig();
  if (!resolved.apiKey) {
    throw new ReviewError(
      "no_api_key",
      "\u672A\u914D\u7F6E API Key\uFF0C\u8BF7\u5148\u8FD0\u884C sci init \u6216\u901A\u8FC7 sci --setApiKey <key> \u8BBE\u7F6E"
    );
  }
  return { client: new ScilandClient(resolved.apiKey, resolved.apiBaseUrl) };
}
async function submitReview(input, cfg, options = {}) {
  const validation = SubmitReviewInputSchema.safeParse(input);
  if (!validation.success) {
    throw new ReviewError("input", validation.error.issues.map((issue) => issue.message).join("\uFF1B"));
  }
  const { client } = resolveApiConfig(cfg);
  const parsed = validation.data;
  const signal = options.signal;
  if (signal?.aborted) throw new ReviewError("cancelled", "\u5BA1\u7A3F\u5DF2\u53D6\u6D88");
  let fileInfo;
  try {
    fileInfo = await stat(parsed.pdfPath);
  } catch (error) {
    throw new ReviewError("input", `PDF \u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u65E0\u6CD5\u8BFB\u53D6\uFF1A${parsed.pdfPath}`, error);
  }
  if (!fileInfo.isFile()) {
    throw new ReviewError("input", `PDF \u8DEF\u5F84\u4E0D\u662F\u6587\u4EF6\uFF1A${parsed.pdfPath}`);
  }
  if (extname(parsed.pdfPath).toLowerCase() !== ".pdf") {
    throw new ReviewError("input", "\u4EC5\u652F\u6301 .pdf \u6587\u4EF6");
  }
  if (fileInfo.size > MAX_PDF_BYTES) {
    throw new ReviewError("input", "PDF \u6587\u4EF6\u4E0D\u80FD\u8D85\u8FC7 50MB");
  }
  let pdfBytes;
  try {
    pdfBytes = await readFile(parsed.pdfPath, signal ? { signal } : void 0);
  } catch (error) {
    if (signal?.aborted) throw new ReviewError("cancelled", "\u5BA1\u7A3F\u5DF2\u53D6\u6D88", error);
    throw new ReviewError("input", `PDF \u6587\u4EF6\u65E0\u6CD5\u8BFB\u53D6\uFF1A${parsed.pdfPath}`, error);
  }
  if (pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new ReviewError("input", "\u6587\u4EF6\u5185\u5BB9\u4E0D\u662F\u6709\u6548 PDF");
  }
  const createStartedAtMs = Date.now();
  try {
    const created = await client.createReview({
      pdfBytes,
      pdfName: basename(parsed.pdfPath),
      brief: parsed.brief,
      reportLanguage: parsed.language,
      reviewMode: parsed.mode,
      targetVenue: parsed.targetVenue
    }, signal);
    return {
      taskUuid: created.taskUuid,
      reviewMode: created.reviewMode,
      targetVenue: created.targetVenue
    };
  } catch (error) {
    if (signal?.aborted) throw new ReviewError("cancelled", "\u5BA1\u7A3F\u5DF2\u53D6\u6D88", error);
    if (!(error instanceof ReviewCreateUncertainError)) throw mapClientError2(error);
    let successfulLookups = 0;
    for (const [index, delayMs] of RECOVERY_DELAYS_MS.entries()) {
      try {
        await sleepAbortable(delayMs, signal);
        const recent = await client.listReviews({ limit: 5, offset: 0 }, signal);
        successfulLookups += 1;
        const recovered = recent.find(
          (item) => item.createdAtMs >= createStartedAtMs - CLOCK_SKEW_TOLERANCE_MS && item.reviewMode === parsed.mode
        );
        if (recovered) {
          return {
            taskUuid: recovered.taskUuid,
            reviewMode: recovered.reviewMode,
            targetVenue: recovered.targetVenue
          };
        }
      } catch (lookupError) {
        if (signal?.aborted) {
          throw new ReviewError("cancelled", "\u5BA1\u7A3F\u5DF2\u53D6\u6D88", lookupError);
        }
        if (index === 0) continue;
        throw new ReviewError(
          "network",
          "\u65E0\u6CD5\u786E\u8BA4\u670D\u52A1\u7AEF\u662F\u5426\u5DF2\u521B\u5EFA\u4EFB\u52A1\uFF0C\u8BF7\u52FF\u7ACB\u5373\u91CD\u8BD5",
          lookupError
        );
      }
    }
    throw new ReviewError(
      "network",
      successfulLookups === 2 ? "\u672A\u68C0\u6D4B\u5230\u5DF2\u521B\u5EFA\u4EFB\u52A1\uFF0C\u53EF\u5B89\u5168\u91CD\u8BD5" : "\u65E0\u6CD5\u786E\u8BA4\u670D\u52A1\u7AEF\u662F\u5426\u5DF2\u521B\u5EFA\u4EFB\u52A1\uFF0C\u8BF7\u52FF\u7ACB\u5373\u91CD\u8BD5"
    );
  }
}
async function pollReview(taskUuid, options = {}, cfg) {
  const { client } = resolveApiConfig(cfg);
  if (!taskUuid.trim()) throw new ReviewError("input", "review task uuid \u4E0D\u80FD\u4E3A\u7A7A");
  const signal = options.signal;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const startedAtMs = Date.now();
  let pollCount = 0;
  let consecutiveNetworkErrors = 0;
  let fastReviewNotified = false;
  while (true) {
    if (signal?.aborted) throw new ReviewError("cancelled", "\u5BA1\u7A3F\u5DF2\u53D6\u6D88");
    let detail;
    try {
      detail = await client.getReview(taskUuid, signal);
    } catch (error) {
      if (signal?.aborted) throw new ReviewError("cancelled", "\u5BA1\u7A3F\u5DF2\u53D6\u6D88", error);
      if (!(error instanceof NetworkError)) throw mapClientError2(error);
      consecutiveNetworkErrors += 1;
      if (consecutiveNetworkErrors >= 3) throw mapClientError2(error);
      try {
        await sleepAbortable(pollIntervalMs, signal);
      } catch (sleepError) {
        throw new ReviewError("cancelled", "\u5BA1\u7A3F\u5DF2\u53D6\u6D88", sleepError);
      }
      continue;
    }
    consecutiveNetworkErrors = 0;
    pollCount += 1;
    try {
      options.onProgress?.({
        taskUuid: detail.taskUuid,
        status: detail.status,
        ...detail.phase ? { phase: detail.phase } : {},
        fastReviewStatus: detail.fastReviewStatus,
        agents: detail.agents,
        elapsedMs: Date.now() - startedAtMs,
        pollCount
      });
    } catch {
    }
    if (!fastReviewNotified && detail.fastReviewStatus === "succeeded") {
      fastReviewNotified = true;
      try {
        options.onFastReviewReady?.(detail);
      } catch {
      }
    }
    if (TERMINAL_REVIEW_STATUSES.includes(detail.status)) return detail;
    try {
      await sleepAbortable(pollIntervalMs, signal);
    } catch (error) {
      throw new ReviewError("cancelled", "\u5BA1\u7A3F\u5DF2\u53D6\u6D88", error);
    }
  }
}
async function fetchReviewDetail(taskUuid, cfg, signal) {
  const { client } = resolveApiConfig(cfg);
  if (!taskUuid.trim()) throw new ReviewError("input", "review task uuid \u4E0D\u80FD\u4E3A\u7A7A");
  try {
    return await client.getReview(taskUuid, signal);
  } catch (error) {
    throw mapClientError2(error);
  }
}
async function listReviewTasks(options = {}, cfg, signal) {
  const { client } = resolveApiConfig(cfg);
  try {
    return await client.listReviews(options, signal);
  } catch (error) {
    throw mapClientError2(error);
  }
}
async function pullArtifacts(taskUuid, options, cfg) {
  const { client } = resolveApiConfig(cfg);
  if (!taskUuid.trim()) throw new ReviewError("input", "review task uuid \u4E0D\u80FD\u4E3A\u7A7A");
  const signal = options.signal;
  const format = options.format ?? "md";
  let detail;
  try {
    detail = await client.getReview(taskUuid, signal);
  } catch (error) {
    throw mapClientError2(error);
  }
  if (detail.status !== "succeeded") {
    const phase = detail.phase ? `\xB7${detail.phase}` : "";
    throw new ReviewError(
      "not_ready",
      `\u4EFB\u52A1\u5C1A\u672A\u5B8C\u6210\uFF0C\u5F53\u524D\u72B6\u6001\uFF1A${detail.status}${phase}`
    );
  }
  const keys = resolveSelection(detail, options.selection);
  const dir = resolve(options.outDir, reviewTaskDirName(detail.pdfName, taskUuid));
  await mkdir(dir, { recursive: true });
  const files = [];
  const missing = [];
  let resigned = false;
  for (const key of keys) {
    if (signal?.aborted) throw new ReviewError("cancelled", "\u4E0B\u8F7D\u5DF2\u53D6\u6D88");
    if (key === "report") {
      let bytes;
      try {
        bytes = await client.downloadReport(taskUuid, format, signal);
      } catch (error) {
        if (signal?.aborted) throw new ReviewError("cancelled", "\u4E0B\u8F7D\u5DF2\u53D6\u6D88", error);
        const mapped = mapClientError2(error);
        if (mapped.kind === "not_found") {
          missing.push("report");
          continue;
        }
        throw mapped;
      }
      const filename2 = `review_report.${format}`;
      await writeFile(join2(dir, filename2), bytes);
      files.push(filename2);
      continue;
    }
    const serverKey = SERVER_ARTIFACT_KEYS[key];
    let link = detail.artifacts[serverKey];
    if (!link) {
      missing.push(key);
      continue;
    }
    let outcome = await fetchArtifact(link.url, signal);
    if (outcome.expired) {
      if (resigned) {
        throw new ReviewError("network", `\u4EA7\u7269 ${key} \u4E0B\u8F7D\u5931\u8D25\uFF1A\u7B7E\u540D URL \u5DF2\u8FC7\u671F`);
      }
      resigned = true;
      try {
        detail = await client.getReview(taskUuid, signal);
      } catch (error) {
        throw mapClientError2(error);
      }
      link = detail.artifacts[serverKey];
      if (!link) {
        missing.push(key);
        continue;
      }
      outcome = await fetchArtifact(link.url, signal);
      if (outcome.expired) {
        throw new ReviewError("network", `\u4EA7\u7269 ${key} \u4E0B\u8F7D\u5931\u8D25\uFF1A\u6362\u7B7E\u540E\u4ECD\u65E0\u6CD5\u4E0B\u8F7D`);
      }
    }
    const filename = ARTIFACT_FILENAMES[key];
    await writeFile(join2(dir, filename), outcome.bytes);
    files.push(filename);
  }
  return { dir, files, missing };
}
function resolveSelection(detail, selection) {
  if (selection?.only?.length) return [...new Set(selection.only)];
  const keys = ["report", "cards", "evidence", "refs"];
  if (detail.artifacts[SERVER_ARTIFACT_KEYS.fast]) keys.push("fast");
  if (selection?.all) keys.push("manuscript", "validation");
  return keys;
}
async function fetchArtifact(url, signal) {
  const timeoutSignal = AbortSignal.timeout(ARTIFACT_DOWNLOAD_TIMEOUT_MS);
  const downloadSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  try {
    const response = await fetch(url, { method: "GET", signal: downloadSignal });
    if (response.status === 401 || response.status === 403) return { expired: true };
    if (!response.ok) {
      throw new ReviewError("api", `\u4EA7\u7269\u4E0B\u8F7D\u5931\u8D25\uFF1AHTTP ${response.status}`);
    }
    return { expired: false, bytes: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    if (signal?.aborted) throw new ReviewError("cancelled", "\u4E0B\u8F7D\u5DF2\u53D6\u6D88", error);
    if (timeoutSignal.aborted) {
      throw new ReviewError("network", `\u4EA7\u7269\u4E0B\u8F7D\u8D85\u65F6\uFF08${Math.round(ARTIFACT_DOWNLOAD_TIMEOUT_MS / 1e3)}s\uFF09`, error);
    }
    throw new ReviewError("network", "\u4EA7\u7269\u4E0B\u8F7D\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC", error);
  }
}
function mapClientError2(error) {
  if (error instanceof AuthError) return new ReviewError("auth", error.message, error);
  if (error instanceof NetworkError) return new ReviewError("network", error.message, error);
  if (error instanceof ApiError) {
    if (error.code === 429) return new ReviewError("quota", error.message, error);
    if (error.code === 404) return new ReviewError("not_found", error.message, error);
    return new ReviewError("api", error.message, error);
  }
  return new ReviewError(
    "unknown",
    error instanceof Error ? error.message : String(error),
    error
  );
}

// src/commands/review.ts
var PULL_FORMATS = ["md", "pdf", "docx"];
var reviewCommand = new Command4("review").description("Deep peer review tasks: submit / watch / status / list / pull").exitOverride((err) => {
  process.exit(err.exitCode === 0 ? 0 : 2);
});
function setupJsonMode(json) {
  if (json === true) redirectLoggerToStderr();
  return json === true;
}
function printJson(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}
function exitWithReviewError(error, resumeHint) {
  if (error instanceof ReviewError) {
    if (error.kind === "cancelled") process.exit(130);
    logger.error(error.message);
    if (error.kind === "auth") {
      logger.info("Hint: API key may be invalid \u2014 run sci init to reconfigure");
    } else if (error.kind === "network" && resumeHint) {
      logger.info(resumeHint);
    }
    process.exit(error.kind === "not_ready" ? 3 : 1);
  }
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
function installTwoStageSigint(onFirst) {
  let count = 0;
  const handler = () => {
    count += 1;
    if (count > 1) process.exit(130);
    onFirst();
  };
  process.on("SIGINT", handler);
  return { dispose: () => process.removeListener("SIGINT", handler) };
}
function renderAgents(agents) {
  const parts = [];
  for (const [role, value] of Object.entries(agents)) {
    let state = "?";
    if (typeof value === "string") state = value;
    else if (value && typeof value === "object") {
      const status = value["status"];
      if (typeof status === "string") state = status;
    }
    parts.push(`${role}:${state}`);
  }
  return parts.join(" ");
}
function createProgressRenderer() {
  const useInline = process.stderr.isTTY === true;
  let lastPrintedLen = 0;
  return {
    onProgress(info) {
      const phase = info.phase ? `\xB7${info.phase}` : "";
      const agents = renderAgents(info.agents);
      const fast = info.fastReviewStatus === "succeeded" ? " / fast:ready" : "";
      const line = `  \u23F3 ${info.status}${phase} / ${Math.floor(info.elapsedMs / 1e3)}s / poll #${info.pollCount}${fast}` + (agents ? ` / ${agents}` : "");
      if (useInline) {
        process.stderr.write("\r" + line.padEnd(lastPrintedLen, " "));
        lastPrintedLen = line.length;
      } else if (info.pollCount === 1 || info.pollCount % 6 === 0) {
        process.stderr.write(line + "\n");
      }
    },
    clear() {
      if (useInline && lastPrintedLen > 0) {
        process.stderr.write("\r" + " ".repeat(lastPrintedLen) + "\r");
        lastPrintedLen = 0;
      }
    }
  };
}
function formatSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function formatLocalTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function downloadFastReview(detail, outDir) {
  const link = detail.artifacts["fast_review"];
  if (!link) throw new Error("\u901F\u89C8\u4EA7\u7269\u7F3A\u5931");
  const dir = resolve2(outDir, reviewTaskDirName(detail.pdfName, detail.taskUuid));
  mkdirSync2(dir, { recursive: true });
  const response = await fetch(link.url, { method: "GET", signal: AbortSignal.timeout(6e4) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const filePath = join3(dir, "fast_review.md");
  writeFileSync2(filePath, Buffer.from(await response.arrayBuffer()));
  return filePath;
}
async function watchTask(taskUuid, opts) {
  const abortController = new AbortController();
  const progress = createProgressRenderer();
  const sigint = installTwoStageSigint(() => {
    progress.clear();
    logger.warn(
      `Interrupt received, stopping watch. Resume with: sci review watch ${taskUuid}. Press Ctrl+C again to force quit.`
    );
    abortController.abort();
  });
  let fastDownload;
  let detail;
  try {
    detail = await pollReview(taskUuid, {
      onProgress: progress.onProgress,
      onFastReviewReady: (readyDetail) => {
        fastDownload = downloadFastReview(readyDetail, opts.out).then((filePath) => {
          progress.clear();
          logger.info(`\u5FEB\u901F\u901F\u89C8\u5DF2\u751F\u6210\uFF1A${filePath}`);
        }).catch((error) => {
          progress.clear();
          logger.warn(
            `\u901F\u89C8\u4E0B\u8F7D\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u5BA1\u7A3F\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`
          );
        });
      },
      signal: abortController.signal
    });
  } catch (error) {
    progress.clear();
    sigint.dispose();
    if (fastDownload) await fastDownload;
    exitWithReviewError(error, `Resume with: sci review watch ${taskUuid}`);
  }
  progress.clear();
  sigint.dispose();
  if (fastDownload) await fastDownload;
  if (detail.status !== "succeeded") {
    const message = detail.errorMessage ?? (detail.status === "timed_out" ? "\u5BA1\u7A3F\u4EFB\u52A1\u8D85\u65F6" : "\u5BA1\u7A3F\u4EFB\u52A1\u5931\u8D25");
    if (opts.json) {
      printJson({
        taskUuid,
        status: detail.status,
        reviewMode: detail.reviewMode,
        targetVenue: detail.targetVenue,
        errorMessage: message
      });
    }
    logger.error(message);
    process.exit(1);
  }
  try {
    const result = await pullArtifacts(taskUuid, { outDir: opts.out });
    if (opts.json) {
      printJson({
        taskUuid,
        status: "succeeded",
        reviewMode: detail.reviewMode,
        targetVenue: detail.targetVenue,
        dir: result.dir,
        files: result.files,
        missing: result.missing
      });
    } else {
      logger.success(`\u5BA1\u7A3F\u5B8C\u6210\uFF0C\u4EA7\u7269\u5DF2\u4FDD\u5B58\u5230 ${result.dir}`);
      for (const file of result.files) logger.info(`  ${file}`);
      if (result.missing.length) logger.warn(`\u4EE5\u4E0B\u4EA7\u7269\u670D\u52A1\u7AEF\u672A\u751F\u6210\uFF1A${result.missing.join(", ")}`);
    }
  } catch (error) {
    logger.error(
      `\u4EA7\u7269\u4E0B\u8F7D\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`
    );
    logger.info(`Retry with: sci review pull ${taskUuid} --out ${opts.out}`);
    if (opts.json) {
      printJson({
        taskUuid,
        status: "succeeded",
        reviewMode: detail.reviewMode,
        targetVenue: detail.targetVenue
      });
    }
    process.exit(1);
  }
}
reviewCommand.command("submit").description("Submit a PDF for deep peer review (heavy task, ~30-80 minutes)").argument("<pdf>", "PDF file to review").option("--brief <text>", "Additional review instructions").option("--language <lang>", "Report language (free-form, e.g. en / zh)", "en").option(
  "--mode <author|reviewer>",
  "Review role; cannot be changed after submission and controls review-web Revision permissions",
  "author"
).option("--venue <name>", "Optional target journal or conference").option("-y, --yes", "Skip the confirmation gate").option("--watch", "Keep watching until the review finishes").option("--out <dir>", "Output directory for artifacts (only with --watch)").option("--json", "Print machine-readable JSON to stdout").action(async (pdf, opts) => {
  const json = setupJsonMode(opts.json);
  const language = (opts.language ?? "en").trim() || "en";
  if (!REVIEW_MODES.includes(opts.mode)) {
    logger.error(`\u4E0D\u652F\u6301\u7684\u89D2\u8272\uFF1A${opts.mode}\u3002\u5141\u8BB8\u503C\uFF1A${REVIEW_MODES.join(" / ")}`);
    process.exit(2);
  }
  const mode = opts.mode;
  const targetVenue = opts.venue?.trim();
  if (opts.venue !== void 0 && (!targetVenue || targetVenue.length > 255)) {
    logger.error("--venue \u53BB\u9664\u9996\u5C3E\u7A7A\u767D\u540E\u957F\u5EA6\u9700\u4E3A 1-255 \u4E2A\u5B57\u7B26");
    process.exit(2);
  }
  if (opts.out && !opts.watch) logger.warn("--out \u4EC5\u5728 --watch \u65F6\u751F\u6548\uFF0C\u672C\u6B21\u63D0\u4EA4\u540E\u7ACB\u5373\u9000\u51FA");
  if (opts.yes !== true) {
    let size;
    try {
      size = statSync(pdf).size;
    } catch {
      logger.error(`PDF \u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u65E0\u6CD5\u8BFB\u53D6\uFF1A${pdf}`);
      process.exit(1);
    }
    logger.info(`\u6587\u4EF6\uFF1A${basename2(pdf)}\uFF08${formatSize(size)}\uFF09`);
    logger.info(`\u62A5\u544A\u8BED\u8A00\uFF1A${language}`);
    logger.info(`\u89D2\u8272\uFF1A${mode === "author" ? "\u6295\u7A3F\u4EBA" : "\u5BA1\u7A3F\u4EBA"}\uFF08\u63D0\u4EA4\u540E\u4E0D\u53EF\u4FEE\u6539\uFF09`);
    logger.info(`\u76EE\u6807\uFF1A${targetVenue ?? "\u672A\u6307\u5B9A"}`);
    if (opts.brief) {
      const excerpt = opts.brief.length > 80 ? `${opts.brief.slice(0, 80)}\u2026` : opts.brief;
      logger.info(`Brief\uFF1A${excerpt}`);
    }
    logger.warn("\u5BA1\u7A3F\u662F\u91CD\u8D1F\u8F7D\u957F\u4EFB\u52A1\uFF0C\u7EA6 30-80 \u5206\u949F\u5B8C\u6210\uFF0C\u63D0\u4EA4\u540E\u8BF7\u7528 status / watch \u8DDF\u8FDB\u3002");
    logger.warn("\u89D2\u8272\u63D0\u4EA4\u540E\u4E0D\u53EF\u4FEE\u6539\uFF0C\u5E76\u4F1A\u5F71\u54CD review-web \u4E2D\u53EF\u6267\u884C\u7684 Revision \u64CD\u4F5C\u3002");
    if (process.stdin.isTTY !== true) {
      logger.error("\u975E\u4EA4\u4E92\u73AF\u5883\u63D0\u4EA4\u5BA1\u7A3F\u5FC5\u987B\u663E\u5F0F\u52A0 --yes\uFF08\u91CD\u8D1F\u8F7D\u957F\u4EFB\u52A1\uFF0C\u7EA6 30-80 \u5206\u949F\uFF09");
      process.exit(2);
    }
    let confirmed = false;
    try {
      confirmed = await confirm2(
        { message: "\u786E\u8BA4\u63D0\u4EA4\u5BA1\u7A3F\uFF1F", default: false },
        { output: process.stderr }
      );
    } catch {
      process.exit(130);
    }
    if (!confirmed) {
      logger.info("\u5DF2\u53D6\u6D88\u63D0\u4EA4");
      process.exit(130);
    }
  }
  const abortController = new AbortController();
  const sigint = installTwoStageSigint(() => {
    logger.warn(
      "Interrupt received. Task creation status is not confirmed; do not retry immediately. Press Ctrl+C again to force quit."
    );
    abortController.abort();
  });
  let submitted;
  try {
    submitted = await submitReview(
      {
        pdfPath: pdf,
        brief: opts.brief,
        language,
        mode,
        ...targetVenue ? { targetVenue } : {}
      },
      void 0,
      { signal: abortController.signal }
    );
  } catch (error) {
    sigint.dispose();
    exitWithReviewError(error);
  }
  sigint.dispose();
  const { taskUuid } = submitted;
  if (opts.watch === true) {
    logger.success(`Task created: ${taskUuid}`);
    await watchTask(taskUuid, { out: opts.out ?? ".", json });
    return;
  }
  if (json) {
    printJson({
      taskUuid,
      reviewMode: submitted.reviewMode,
      targetVenue: submitted.targetVenue
    });
    return;
  }
  logger.success(`Task created: ${taskUuid}`);
  logger.info(`  sci review status ${taskUuid}   \u67E5\u770B\u72B6\u6001`);
  logger.info(`  sci review watch ${taskUuid}    \u6301\u7EED\u7B49\u5F85\u5E76\u81EA\u52A8\u4E0B\u8F7D\u4EA7\u7269`);
  logger.info(`  sci review pull ${taskUuid}     \u5B8C\u6210\u540E\u4E0B\u8F7D\u4EA7\u7269`);
});
reviewCommand.command("watch").description("Watch a review task until it finishes, then pull default artifacts").argument("<uuid>", "Review task uuid").option("--out <dir>", "Output directory for artifacts", ".").option("--json", "Print machine-readable JSON to stdout").action(async (uuid, opts) => {
  const json = setupJsonMode(opts.json);
  logger.info(`Watching review task: ${uuid}`);
  await watchTask(uuid.trim(), { out: opts.out, json });
});
reviewCommand.command("status").description("Query a review task once (exit 0 succeeded / 3 in progress / 1 failed)").argument("<uuid>", "Review task uuid").option("--json", "Print the full detail as JSON to stdout").action(async (uuid, opts) => {
  const json = setupJsonMode(opts.json);
  let detail;
  try {
    detail = await fetchReviewDetail(uuid.trim());
  } catch (error) {
    exitWithReviewError(error);
  }
  if (json) {
    printJson(detail);
  } else {
    const phase = detail.phase ? `\xB7${detail.phase}` : "";
    const pdfName = detail.pdfName ? `  ${detail.pdfName}` : "";
    const createdAt = detail.createdAtMs ? `  ${formatLocalTime(detail.createdAtMs)}` : "";
    const venue = detail.targetVenue ? `  venue:${detail.targetVenue}` : "";
    logger.info(
      `${detail.taskUuid}  ${detail.status}${phase}  mode:${detail.reviewMode}  fast:${detail.fastReviewStatus}${pdfName}${venue}${createdAt}`
    );
    if (detail.errorMessage) logger.error(detail.errorMessage);
  }
  if (detail.status === "succeeded") return;
  process.exit(detail.status === "failed" || detail.status === "timed_out" ? 1 : 3);
});
reviewCommand.command("list").description("List review tasks (newest first)").option("--status <status>", `Filter by status (${REVIEW_STATUSES.join(" / ")})`).option("--limit <n>", "Max tasks to return", "20").option("--offset <n>", "Skip the first n tasks", "0").option("--json", "Print machine-readable JSON to stdout").action(async (opts) => {
  const json = setupJsonMode(opts.json);
  if (opts.status && !REVIEW_STATUSES.includes(opts.status)) {
    logger.error(`\u4E0D\u652F\u6301\u7684\u72B6\u6001\uFF1A${opts.status}\u3002\u5141\u8BB8\u503C\uFF1A${REVIEW_STATUSES.join(" / ")}`);
    process.exit(2);
  }
  const limit = Number.parseInt(opts.limit, 10);
  const offset = Number.parseInt(opts.offset, 10);
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(offset) || offset < 0) {
    logger.error("--limit \u9700\u4E3A\u6B63\u6574\u6570\uFF0C--offset \u9700\u4E3A\u975E\u8D1F\u6574\u6570");
    process.exit(2);
  }
  let items;
  try {
    items = await listReviewTasks({
      limit,
      offset,
      ...opts.status ? { status: opts.status } : {}
    });
  } catch (error) {
    exitWithReviewError(error);
  }
  if (json) {
    printJson(items);
    return;
  }
  if (!items.length) {
    logger.info("\u6CA1\u6709\u5BA1\u7A3F\u4EFB\u52A1");
    return;
  }
  console.log(
    `${"UUID".padEnd(36)}  ${"MODE".padEnd(8)}  ${"STATUS".padEnd(9)}  ${"PHASE".padEnd(10)}  ${"PDF".padEnd(28)}  CREATED`
  );
  for (const item of items) {
    const pdfName = item.pdfName ?? "-";
    const truncated = pdfName.length > 28 ? `${pdfName.slice(0, 27)}\u2026` : pdfName;
    console.log(
      `${item.taskUuid.padEnd(36)}  ${item.reviewMode.padEnd(8)}  ${item.status.padEnd(9)}  ${(item.phase ?? "-").padEnd(10)}  ${truncated.padEnd(28)}  ${formatLocalTime(item.createdAtMs)}`
    );
  }
});
reviewCommand.command("pull").description("Download artifacts of a finished review task").argument("<uuid>", "Review task uuid").option("--out <dir>", "Output directory", ".").option("--only <keys>", `Comma-separated artifact keys (${ARTIFACT_KEYS.join(" / ")})`).option("--all", "Also pull manuscript and validation on top of the default set").option("--format <format>", "Report format: md / pdf / docx", "md").option("--json", "Print machine-readable JSON to stdout").action(async (uuid, opts) => {
  const json = setupJsonMode(opts.json);
  if (!PULL_FORMATS.includes(opts.format)) {
    logger.error(`\u4E0D\u652F\u6301\u7684\u683C\u5F0F\uFF1A${opts.format}\u3002\u5141\u8BB8\u503C\uFF1A${PULL_FORMATS.join(" / ")}`);
    process.exit(2);
  }
  let only;
  if (opts.only !== void 0) {
    if (opts.all === true) {
      logger.error("--only \u4E0E --all \u4E92\u65A5");
      process.exit(2);
    }
    const keys = opts.only.split(",").map((key) => key.trim()).filter(Boolean);
    const invalid = keys.filter((key) => !ARTIFACT_KEYS.includes(key));
    if (!keys.length || invalid.length) {
      logger.error(`--only \u4EC5\u63A5\u53D7\u4EA7\u7269\u952E\uFF1A${ARTIFACT_KEYS.join(" / ")}`);
      process.exit(2);
    }
    only = keys;
  }
  let result;
  try {
    result = await pullArtifacts(uuid.trim(), {
      outDir: opts.out,
      selection: { ...only ? { only } : {}, ...opts.all === true ? { all: true } : {} },
      format: opts.format
    });
  } catch (error) {
    exitWithReviewError(error);
  }
  if (json) {
    printJson({ taskUuid: uuid.trim(), dir: result.dir, files: result.files, missing: result.missing });
    return;
  }
  logger.success(`\u4EA7\u7269\u5DF2\u4FDD\u5B58\u5230 ${result.dir}`);
  for (const file of result.files) logger.info(`  ${file}`);
  if (result.missing.length) logger.warn(`\u4EE5\u4E0B\u4EA7\u7269\u670D\u52A1\u7AEF\u672A\u751F\u6210\uFF1A${result.missing.join(", ")}`);
});

// src/commands/search.ts
import { Command as Command5 } from "commander";
import { writeFileSync as writeFileSync3, mkdirSync as mkdirSync3, existsSync as existsSync2 } from "fs";
import { resolve as resolve3, join as join4 } from "path";

// src/formatters/table.ts
function formatAuthors(authors) {
  if (authors.length === 0) return "Unknown";
  if (authors.length === 1) return authors[0] ?? "Unknown";
  if (authors.length === 2) return `${authors[0]}, ${authors[1]}`;
  return `${authors[0] ?? "Unknown"} et al. (+${authors.length - 1})`;
}
function sourceLabel(source, c2) {
  switch (source) {
    case "arxiv":
      return `${c2.yellow}arXiv${c2.reset}`;
    case "pubmed":
      return `${c2.green}PubMed${c2.reset}`;
    case "doi":
      return `${c2.cyan}DOI${c2.reset}`;
    case "unknown":
      return `${c2.dim}unknown${c2.reset}`;
    default:
      return `${c2.dim}${source}${c2.reset}`;
  }
}
function makePalette(useColor) {
  return {
    bold: useColor ? "\x1B[1m" : "",
    reset: useColor ? "\x1B[0m" : "",
    dim: useColor ? "\x1B[2m" : "",
    cyan: useColor ? "\x1B[36m" : "",
    green: useColor ? "\x1B[32m" : "",
    yellow: useColor ? "\x1B[33m" : "",
    magenta: useColor ? "\x1B[35m" : ""
  };
}
function printTable(papers, query, opts = {}) {
  const c2 = makePalette(process.stdout.isTTY !== false);
  console.log();
  console.log(
    `${c2.bold}Search complete:${c2.reset} ${c2.cyan}${papers.length}${c2.reset} paper${papers.length !== 1 ? "s" : ""} found for ${c2.dim}"${query}"${c2.reset}`
  );
  const venueCounts = /* @__PURE__ */ new Map();
  for (const p of papers) {
    const key = p.venue ?? p.source ?? "unknown";
    venueCounts.set(key, (venueCounts.get(key) ?? 0) + 1);
  }
  const topVenues = [...venueCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topVenues.length > 0) {
    const venueStr = topVenues.map(([v, n]) => `${c2.cyan}${v}${c2.reset} \xD7${n}`).join(`${c2.dim},  ${c2.reset}`);
    console.log(`${c2.dim}Venues:${c2.reset}  ${venueStr}`);
  }
  if (opts.jsonPath) console.log(`${c2.dim}Saved:${c2.reset}   ${opts.jsonPath}`);
  if (opts.bibPath) console.log(`         ${opts.bibPath}`);
  console.log();
  papers.forEach((paper, i) => {
    const num = String(i + 1).padStart(2);
    console.log(
      `${c2.bold}${c2.cyan}${num}.${c2.reset} ${c2.bold}${paper.title}${c2.reset}`
    );
    const meta = [formatAuthors(paper.authors)];
    if (paper.year) meta.push(paper.year);
    meta.push(sourceLabel(paper.source, c2));
    if (paper.citations !== void 0) {
      meta.push(`${c2.dim}cited${c2.reset} ${paper.citations}`);
    }
    if (paper.selectScore !== void 0) {
      meta.push(`${c2.dim}score${c2.reset} ${c2.magenta}${paper.selectScore.toFixed(2)}${c2.reset}`);
    } else if (paper.originScore !== void 0) {
      meta.push(`${c2.dim}score${c2.reset} ${paper.originScore.toFixed(2)}`);
    }
    console.log(`    ${meta.join(`${c2.dim} \xB7 ${c2.reset}`)}`);
    const evals = [];
    if (paper.venue) {
      evals.push(`${c2.dim}venue:${c2.reset} ${c2.cyan}${paper.venue}${c2.reset}`);
    }
    if (paper.ccf) {
      evals.push(`${c2.dim}CCF:${c2.reset} ${c2.green}${paper.ccf}${c2.reset}`);
    }
    if (paper.impactFactor !== void 0) {
      evals.push(`${c2.dim}IF:${c2.reset} ${paper.impactFactor.toFixed(2)}`);
    }
    if (paper.h5Index !== void 0) {
      evals.push(`${c2.dim}H5:${c2.reset} ${paper.h5Index}`);
    }
    if (evals.length > 0) {
      console.log(`    ${evals.join("   ")}`);
    }
    if (paper.url) {
      console.log(`    ${c2.dim}${paper.url}${c2.reset}`);
    }
    console.log();
  });
}

// src/formatters/bibtex.ts
function sanitizeBibtexValue(val) {
  return val.replace(/[{}\\]/g, (ch) => `\\${ch}`);
}
function sanitizeBibtexUrl(url) {
  return url.replace(/\\/g, "\\\\");
}
function makeCiteKey(paper) {
  const firstAuthorLast = paper.authors[0]?.split(" ")[0] ?? "Unknown";
  return `${firstAuthorLast}${paper.year}_${paper.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
}
function formatAuthors2(authors) {
  return authors.map(sanitizeBibtexValue).join(" and ");
}
function toBibtex(papers) {
  return papers.map((paper) => {
    if (paper.bib && paper.bib.trim()) {
      return paper.bib.trim();
    }
    const key = makeCiteKey(paper);
    const lines = [
      `@article{${key},`,
      `  title     = {${sanitizeBibtexValue(paper.title)}},`,
      `  author    = {${formatAuthors2(paper.authors)}},`,
      `  year      = {${paper.year}},`
    ];
    if (paper.doi) {
      lines.push(`  doi       = {${sanitizeBibtexValue(paper.doi)}},`);
    }
    lines.push(`  url       = {${sanitizeBibtexUrl(paper.url)}},`);
    lines.push(`  note      = {Source: ${sanitizeBibtexValue(paper.source)}, ID: ${paper.id}}`);
    lines.push("}");
    return lines.join("\n");
  }).join("\n\n");
}

// src/commands/search.ts
var searchCommand = new Command5("search").description("Search papers and write results to .json and .bib files").argument("<query>", "Search query (natural language)").option("-n, --limit <number>", "Number of results to return (1-100)", "100").option("--out <dir>", "Output directory (created if absent)", ".").option("--prefix <name>", "Output filename prefix", "search-results").option(
  "--mode <mode>",
  `Override search mode for this run (${PASA_MODES.join(" / ")}). Defaults to the mode set via sci model.`
).option(
  "--preference <preference>",
  `Search language preference (${SEARCH_PREFERENCES.join(" / ")}). Defaults to English.`,
  "English"
).addHelpText(
  "after",
  `
Examples:
  sci search "CRISPR gene editing 2024"
  sci search "machine learning protein" --limit 20
  sci search "cancer immunotherapy" --mode mid --out ./papers
  sci search "transformer architecture" --prefix transformers --out ./refs

Output files are stamped with a local timestamp (e.g. search-results-20260529-191700.json)
so repeated searches never overwrite each other.`
).action(async (query, opts) => {
  let mode;
  if (opts.mode !== void 0) {
    if (!isPasaMode(opts.mode)) {
      logger.error(
        `\u4E0D\u652F\u6301\u7684\u6863\u4F4D: "${opts.mode}"\u3002\u5141\u8BB8\u503C: ${PASA_MODES.join(" / ")}`
      );
      process.exit(1);
    }
    mode = opts.mode;
  }
  if (!SEARCH_PREFERENCES.includes(opts.preference)) {
    logger.error(
      `\u4E0D\u652F\u6301\u7684\u8BED\u8A00\u504F\u597D: "${opts.preference}"\u3002\u5141\u8BB8\u503C: ${SEARCH_PREFERENCES.join(" / ")}`
    );
    process.exit(1);
  }
  const preference = opts.preference;
  const MAX_LIMIT = 50;
  const parsedLimit = Math.max(1, parseInt(opts.limit, 10) || MAX_LIMIT);
  if (parsedLimit > MAX_LIMIT) {
    logger.warn(
      `Considering retrieval relevance, results beyond ${MAX_LIMIT} papers are unlikely to be meaningful. The search will return up to ${MAX_LIMIT} papers.`
    );
  }
  const limit = Math.min(parsedLimit, MAX_LIMIT);
  const outDir = resolve3(opts.out);
  const prefix = opts.prefix;
  if (!existsSync2(outDir)) {
    mkdirSync3(outDir, { recursive: true });
  }
  const modeHint = mode ?? "default (from sci model)";
  logger.info(
    `Searching: "${query}" (up to ${limit} results, mode: ${modeHint}, preference: ${preference})...`
  );
  const useInlineProgress = process.stderr.isTTY === true;
  let lastPrintedLen = 0;
  const onProgress = (info) => {
    const seconds = Math.floor(info.elapsedMs / 1e3);
    const taskShort = info.taskId.length > 12 ? info.taskId.slice(0, 12) + "\u2026" : info.taskId;
    const line = `  \u23F3 Waiting ${seconds}s (poll #${info.pollCount}, task=${taskShort})`;
    if (useInlineProgress) {
      const padded = line.padEnd(lastPrintedLen, " ");
      process.stderr.write("\r" + padded);
      lastPrintedLen = line.length;
    } else if (info.pollCount === 1 || info.pollCount % 5 === 0) {
      process.stderr.write(line + "\n");
    }
  };
  const clearProgressLine = () => {
    if (useInlineProgress && lastPrintedLen > 0) {
      process.stderr.write("\r" + " ".repeat(lastPrintedLen) + "\r");
      lastPrintedLen = 0;
    }
  };
  const abortController = new AbortController();
  let sigintCount = 0;
  const onSigint = () => {
    sigintCount += 1;
    if (sigintCount === 1) {
      clearProgressLine();
      logger.warn("Interrupt received, stopping search (press Ctrl+C again to force quit)...");
      abortController.abort();
    } else {
      clearProgressLine();
      process.exit(130);
    }
  };
  process.on("SIGINT", onSigint);
  const MAX_RETRIES = 3;
  const NON_RETRYABLE = /* @__PURE__ */ new Set(["auth", "no_api_key", "cancelled"]);
  let result;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    if (attempt > 1) {
      logger.warn(`Retry ${attempt - 1}/${MAX_RETRIES}...`);
    }
    try {
      result = await runSearch(
        { query, limit, mode, preference },
        void 0,
        {
          onProgress,
          signal: abortController.signal
        }
      );
      break;
    } catch (err) {
      clearProgressLine();
      lastErr = err;
      if (err instanceof SearchError && NON_RETRYABLE.has(err.kind)) {
        if (err.kind === "auth") {
          logger.error(err.message);
          logger.info("Hint: API key may be invalid \u2014 run sci init to reconfigure");
        } else if (err.kind === "no_api_key") {
          logger.error(err.message);
          logger.info("Hint: run  sci init  or  sci --setApiKey <your-key>");
        } else if (err.kind === "cancelled") {
          process.removeListener("SIGINT", onSigint);
          process.exit(130);
        }
        process.removeListener("SIGINT", onSigint);
        process.exit(1);
      }
      if (attempt <= MAX_RETRIES) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Search failed (attempt ${attempt}/${MAX_RETRIES + 1}): ${msg}`);
      }
    }
  }
  if (!result) {
    clearProgressLine();
    if (lastErr instanceof SearchError) {
      logger.error(`Search failed after ${MAX_RETRIES + 1} attempts: ${lastErr.message}`);
      if (lastErr.kind === "timeout") {
        logger.info(
          "Hint: mid/high modes occasionally have long-tail tasks \u2014 try switching to low with sci model"
        );
      }
    } else {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      logger.error(`Search failed after ${MAX_RETRIES + 1} attempts: ${msg}`);
    }
    process.removeListener("SIGINT", onSigint);
    process.exit(1);
  }
  process.removeListener("SIGINT", onSigint);
  clearProgressLine();
  if (result.papers.length === 0) {
    logger.warn("No papers found. Try different keywords.");
    process.exit(0);
  }
  const stamp = fileStamp(/* @__PURE__ */ new Date());
  const jsonPath = join4(outDir, `${prefix}-${stamp}.json`);
  const bibPath = join4(outDir, `${prefix}-${stamp}.bib`);
  try {
    writeFileSync3(jsonPath, JSON.stringify(result.papers, null, 2), "utf-8");
    writeFileSync3(bibPath, toBibtex(result.papers), "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to write output files: ${msg}`);
    process.exit(1);
  }
  printTable(result.papers, result.effective.query, { jsonPath, bibPath });
});
function fileStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// src/commands/update.ts
import { execSync } from "child_process";
import { Command as Command6 } from "commander";

// src/version.ts
var VERSION = "0.3.15";

// src/commands/update.ts
async function fetchLatestVersion() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1e4);
  try {
    const res = await fetch("https://registry.npmjs.org/scimaster-cli/latest", {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
function isNewer(current, latest) {
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [cMaj, cMin, cPat] = parse(current);
  const [lMaj, lMin, lPat] = parse(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}
var updateCommand = new Command6("update").description("Check for a newer version and update if available").action(async () => {
  logger.info("Checking for updates...");
  const latest = await fetchLatestVersion();
  if (!latest) {
    logger.error("Could not reach npm registry. Check your network and try again.");
    process.exit(1);
  }
  if (!isNewer(VERSION, latest)) {
    logger.success(`Already up to date (${VERSION})`);
    return;
  }
  logger.info(`New version available: ${VERSION} \u2192 ${latest}`);
  logger.info("Running: npm install -g scimaster-cli@latest");
  try {
    execSync("npm install -g scimaster-cli@latest", { stdio: "inherit" });
  } catch {
    logger.error("Update failed. Try running manually: npm install -g scimaster-cli@latest");
    process.exit(1);
  }
  try {
    const cfg = readConfig();
    writeConfig({ ...cfg, updateCheck: void 0 });
  } catch {
  }
  logger.success(`Updated to ${latest}`);
});

// src/commands/usage.ts
import { Command as Command7 } from "commander";

// src/specs/usage.ts
var UsageError = class extends Error {
  constructor(kind, message, cause) {
    super(message);
    this.kind = kind;
    this.cause = cause;
    this.name = "UsageError";
  }
};
async function runUsage(cfg) {
  const resolved = cfg ?? readConfig();
  if (!resolved.apiKey) {
    throw new UsageError(
      "no_api_key",
      "\u672A\u914D\u7F6E API Key\uFF0C\u8BF7\u5148\u8FD0\u884C sci init \u6216\u901A\u8FC7 sci --setApiKey <key> \u8BBE\u7F6E"
    );
  }
  const client = new ScilandClient(resolved.apiKey, resolved.apiBaseUrl);
  try {
    const usage = await client.getUsage();
    return {
      ...usage,
      currentMode: resolved.defaults.mode
    };
  } catch (err) {
    throw mapUsageError(err);
  }
}
function mapUsageError(err) {
  if (err instanceof AuthError) return new UsageError("auth", err.message, err);
  if (err instanceof NetworkError) {
    return new UsageError("network", err.message, err);
  }
  if (err instanceof ApiError) return new UsageError("api", err.message, err);
  return new UsageError(
    "unknown",
    err instanceof Error ? err.message : String(err),
    err
  );
}

// src/commands/usage.ts
var usageCommand = new Command7("usage").description("Show free quota and estimated remaining calls per mode").action(async () => {
  try {
    const usage = await runUsage();
    logger.info(`Free quota: ${logger.bold(usage.freeQuota)}`);
    console.log();
    console.log("Estimated calls remaining (based on current balance):");
    for (const mode of PASA_MODES) {
      const marker = mode === usage.currentMode ? "*" : " ";
      const count = usage.modeCalls[mode] ?? 0;
      console.log(
        `  ${marker} ${mode.padEnd(10)} ${String(count).padStart(4)}  ${logger.dim(PASA_MODE_DESCRIPTIONS[mode])}`
      );
    }
    console.log();
    console.log(logger.dim("* = current default mode. Actual billing is calculated server-side from LLM + SN costs."));
  } catch (err) {
    if (err instanceof UsageError) {
      logger.error(err.message);
      if (err.kind === "auth") {
        logger.info("Hint: API key may be invalid \u2014 run sci init to reconfigure");
      } else if (err.kind === "no_api_key") {
        logger.info("Hint: run  sci init  or  sci --setApiKey <your-key>");
      }
      process.exit(1);
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    process.exit(1);
  }
});

// src/utils/update.ts
var NPM_REGISTRY_URL = "https://registry.npmjs.org/scimaster-cli/latest";
var CHECK_INTERVAL_MS = 24 * 60 * 60 * 1e3;
async function fetchLatestVersion2() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5e3);
  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
function isNewer2(current, latest) {
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [cMaj, cMin, cPat] = parse(current);
  const [lMaj, lMin, lPat] = parse(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}
async function checkForUpdate() {
  try {
    const cfg = readConfig();
    const now = Date.now();
    const lastChecked = cfg.updateCheck?.lastCheckedAt ?? 0;
    if (now - lastChecked < CHECK_INTERVAL_MS) return;
    const latestVersion = await fetchLatestVersion2();
    if (!latestVersion) return;
    const freshCfg = readConfig();
    writeConfig({ ...freshCfg, updateCheck: { lastCheckedAt: now, latestVersion } });
  } catch {
  }
}
function getUpdateNotice() {
  try {
    const cfg = readConfig();
    const latest = cfg.updateCheck?.latestVersion;
    if (!latest || !isNewer2(VERSION, latest)) return null;
    return `
  Update available: ${VERSION} \u2192 ${latest}
  Run: npm install -g scimaster-cli@latest
`;
  } catch {
    return null;
  }
}

// src/ui/welcome.tsx
import { useState } from "react";
import figlet from "figlet";
import { render, Box, Text, useApp, useInput } from "ink";
import { jsx, jsxs } from "react/jsx-runtime";
var BANNER = figlet.textSync("SciMaster", {
  font: "Big",
  horizontalLayout: "default"
});
var GRADIENT = ["#FF6B9D", "#C084FC", "#818CF8", "#38BDF8"];
function colorChar(_char, index) {
  return GRADIENT[index % GRADIENT.length];
}
function WelcomeApp({ onSearch }) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState(false);
  useInput((char, key) => {
    if (submitted) return;
    if (key.return) {
      const query = input.trim();
      if (query) {
        setSubmitted(true);
        exit();
        onSearch(query);
      }
      return;
    }
    if (key.escape || key.ctrl && char === "c") {
      exit();
      process.exit(0);
    }
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && char) {
      setInput((prev) => prev + char);
    }
  });
  const bannerLines = BANNER.split("\n");
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", paddingTop: 1, children: [
    /* @__PURE__ */ jsx(Box, { flexDirection: "column", alignItems: "center", children: bannerLines.map((line, lineIdx) => /* @__PURE__ */ jsx(Text, { children: line.split("").map((char, charIdx) => /* @__PURE__ */ jsx(Text, { color: colorChar(char, lineIdx * 2 + charIdx), children: char }, charIdx)) }, lineIdx)) }),
    /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", paddingLeft: 2, children: [
      /* @__PURE__ */ jsx(Text, { color: "gray", children: "Search scientific papers powered by SciMaster(https://scimaster.bohrium.com/)" }),
      /* @__PURE__ */ jsxs(Text, { color: "gray", children: [
        "Version ",
        "0.3.15",
        "  \xB7  Press Ctrl+C to exit"
      ] })
    ] }),
    /* @__PURE__ */ jsxs(
      Box,
      {
        marginTop: 1,
        marginLeft: 2,
        marginRight: 2,
        borderStyle: "round",
        borderColor: input ? "cyan" : "gray",
        paddingX: 1,
        children: [
          /* @__PURE__ */ jsx(Text, { color: "cyan", bold: true, children: "> " }),
          /* @__PURE__ */ jsx(Text, { children: input }),
          /* @__PURE__ */ jsx(Text, { color: "cyan", children: "\u2588" })
        ]
      }
    ),
    input.length === 0 && /* @__PURE__ */ jsx(Box, { paddingLeft: 4, marginTop: 0, children: /* @__PURE__ */ jsx(Text, { color: "gray", dimColor: true, children: "Type a query and press Enter to search papers..." }) })
  ] });
}
function showWelcome(onSearch) {
  render(/* @__PURE__ */ jsx(WelcomeApp, { onSearch }));
}

// src/cli.ts
var program = new Command8();
program.name("sci").description("Scientific literature search CLI powered by SciMaster").version("0.3.15").option(
  "--setApiKey <key>",
  "Set API key non-interactively (CI/scripts). Writes to ~/.scimaster/config.json, skips validation."
).addHelpText("after", "\n  First time? Run: sci init");
var setApiKeyIdx = process.argv.indexOf("--setApiKey");
if (setApiKeyIdx !== -1) {
  const key = process.argv[setApiKeyIdx + 1];
  if (!key || key.startsWith("-")) {
    logger.error("--setApiKey requires a key value, e.g.: sci --setApiKey sk-abc123");
    process.exit(1);
  }
  const cfg = readConfig();
  writeConfig({ ...cfg, apiKey: key.trim() });
  const masked = key.length > 8 ? `${key.slice(0, 4)}****${key.slice(-4)}` : "****";
  logger.success(`API key updated: ${masked}`);
  process.exit(0);
}
program.addCommand(initCommand);
program.addCommand(modelCommand);
program.addCommand(usageCommand);
program.addCommand(reviewCommand);
program.addCommand(searchCommand);
program.addCommand(updateCommand);
program.addCommand(envCommand, { hidden: true });
async function main() {
  const argv = process.argv.slice(2);
  const hasSubcommand = argv.filter((a) => !a.startsWith("-")).length > 0;
  const hasFlag = argv.some((a) => a.startsWith("-"));
  if (!hasSubcommand && !hasFlag && process.stdin.isTTY === true) {
    showWelcome((query) => {
      process.argv.push("search", query);
      runCli();
    });
    return;
  }
  await runCli();
}
async function runCli() {
  const updateCheckPromise = checkForUpdate();
  await program.parseAsync(process.argv);
  await updateCheckPromise;
  const notice = getUpdateNotice();
  if (notice) process.stderr.write(notice);
}
main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
