export const HISTORY_STORAGE_KEY = "ai-pr-review-history:v1";
export const DEFAULT_MAX_HISTORY_RECORDS = 50;
export const DEFAULT_MAX_PATCH_DIGEST_FILES = 10;
export const DEFAULT_MAX_PATCH_EXCERPT_LENGTH = 600;
export const DEFAULT_MAX_CHANGED_FILE_PATCH_LENGTH = 12000;

export function getRepositoryKey(pr) {
  return `${pr.owner}/${pr.repo}`;
}

export function buildPatchDigest(files = [], risks = [], options = {}) {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_PATCH_DIGEST_FILES;
  const maxExcerptLength = options.maxExcerptLength ?? DEFAULT_MAX_PATCH_EXCERPT_LENGTH;
  const riskFiles = new Set(risks.map((risk) => risk.file || risk.filename).filter(Boolean));

  /**
   * 历史上下文不能无限保存完整 diff，所以这里只保留最值得回看的文件。
   * 优先保存已识别风险的文件，其次保存变更行数最多的文件，便于后续跨 PR 对比时快速定位重点。
   */
  return [...files]
    .sort((firstFile, secondFile) => {
      const firstRiskScore = riskFiles.has(firstFile.filename) ? 1 : 0;
      const secondRiskScore = riskFiles.has(secondFile.filename) ? 1 : 0;

      if (firstRiskScore !== secondRiskScore) {
        return secondRiskScore - firstRiskScore;
      }

      return (secondFile.changes || 0) - (firstFile.changes || 0);
    })
    .slice(0, maxFiles)
    .map((file) => ({
      filename: file.filename,
      status: file.status,
      changes: file.changes || 0,
      excerpt: (file.patch || "").slice(0, maxExcerptLength),
    }));
}

export function buildChangedFileSnapshots(files = [], options = {}) {
  const maxPatchLength = options.maxPatchLength ?? options.maxChangedFilePatchLength ?? DEFAULT_MAX_CHANGED_FILE_PATCH_LENGTH;

  /**
   * changedFileSnapshots 专门服务页面“全部变更内容”展示。
   * 它保留每个 changed file 的状态、增删行数和 diff patch；单文件 patch 做长度保护，避免 localStorage 被超大 PR 撑爆。
   */
  return files.map((file) => {
    const patch = typeof file.patch === "string" ? file.patch : "";
    const displayPatch = patch.slice(0, maxPatchLength);

    return {
      filename: file.filename,
      status: file.status || "changed",
      additions: Number.isFinite(file.additions) ? file.additions : 0,
      deletions: Number.isFinite(file.deletions) ? file.deletions : 0,
      changes: Number.isFinite(file.changes) ? file.changes : 0,
      patch: displayPatch,
      isPatchTruncated: patch.length > maxPatchLength,
      hasPatch: patch.length > 0,
    };
  });
}

export function buildHistoryRecord(pr, files = [], summary = null, risks = [], suggestions = [], options = {}) {
  const analyzedAt = options.now || new Date().toISOString();
  const ruleSignals = Array.isArray(options.ruleSignals) ? options.ruleSignals : [];

  /**
   * patchDigest 用于模型历史对比上下文，changedFileSnapshots 用于用户回看“全部变更内容”。
   * 两者分开可以同时兼顾模型输入体积和页面展示完整度。
   */
  return {
    repositoryKey: getRepositoryKey(pr),
    prNumber: pr.number,
    prUrl: pr.htmlUrl,
    title: pr.title,
    author: pr.author,
    analyzedAt,
    changedFiles: pr.changedFiles || files.length,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    summary,
    risks,
    ruleSignals,
    suggestions,
    patchDigest: buildPatchDigest(files, risks, options),
    changedFileSnapshots: buildChangedFileSnapshots(files, options),
  };
}

export function upsertHistoryRecord(records = [], record, options = {}) {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_HISTORY_RECORDS;

  /**
   * 同一个仓库的同一个 PR 重新分析时覆盖旧记录，避免历史列表重复堆积。
   * 同时限制最多保存固定数量，防止 localStorage 因大 PR 摘要过多而膨胀。
   */
  return [
    record,
    ...records.filter(
      (item) => !(item.repositoryKey === record.repositoryKey && item.prNumber === record.prNumber),
    ),
  ].slice(0, maxRecords);
}

export function groupHistoryByRepository(records = []) {
  /**
   * 按仓库分组是后续“同仓库历史 PR 对比”的基础，现在先用于页面展示历史上下文来源。
   */
  return records.reduce((groups, record) => {
    if (!groups[record.repositoryKey]) {
      groups[record.repositoryKey] = [];
    }

    groups[record.repositoryKey].push(record);
    return groups;
  }, {});
}

export function findHistoryByRepository(records = [], repositoryKey) {
  return records.filter((record) => record.repositoryKey === repositoryKey);
}

export function normalizeHistoryRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  /**
   * localStorage 里的数据可能被用户手动修改，也可能来自旧版本结构。
   * 这里统一清洗字段，丢弃缺少仓库 key 或 PR 编号的无效记录，避免坏缓存拖垮页面渲染。
   */
  return records
    .filter((record) => {
      if (!record || typeof record !== "object") {
        return false;
      }

      return (
        typeof record.repositoryKey === "string" &&
        record.repositoryKey.trim() &&
        Number.isInteger(record.prNumber) &&
        (record.patchDigest === undefined || Array.isArray(record.patchDigest)) &&
        (record.changedFileSnapshots === undefined || Array.isArray(record.changedFileSnapshots))
      );
    })
    .map((record) => ({
      repositoryKey: record.repositoryKey,
      prNumber: record.prNumber,
      prUrl: typeof record.prUrl === "string" ? record.prUrl : "",
      title: typeof record.title === "string" ? record.title : `PR #${record.prNumber}`,
      author: typeof record.author === "string" ? record.author : "unknown",
      analyzedAt: typeof record.analyzedAt === "string" ? record.analyzedAt : "",
      changedFiles: Number.isFinite(record.changedFiles) ? record.changedFiles : 0,
      additions: Number.isFinite(record.additions) ? record.additions : 0,
      deletions: Number.isFinite(record.deletions) ? record.deletions : 0,
      summary: record.summary && typeof record.summary === "object" ? record.summary : null,
      risks: Array.isArray(record.risks) ? record.risks : [],
      ruleSignals: Array.isArray(record.ruleSignals)
        ? record.ruleSignals.map((signal) => ({
            file: typeof signal.file === "string" ? signal.file : "",
            labels: Array.isArray(signal.labels) ? signal.labels.map(String) : [],
            reason: typeof signal.reason === "string" ? signal.reason : "",
          }))
        : [],
      suggestions: Array.isArray(record.suggestions) ? record.suggestions : [],
      patchDigest: Array.isArray(record.patchDigest) ? record.patchDigest : [],
      changedFileSnapshots: Array.isArray(record.changedFileSnapshots)
        ? record.changedFileSnapshots.map((file) => ({
            filename: typeof file.filename === "string" ? file.filename : "unknown",
            status: typeof file.status === "string" ? file.status : "changed",
            additions: Number.isFinite(file.additions) ? file.additions : 0,
            deletions: Number.isFinite(file.deletions) ? file.deletions : 0,
            changes: Number.isFinite(file.changes) ? file.changes : 0,
            patch: typeof file.patch === "string" ? file.patch : "",
            isPatchTruncated: Boolean(file.isPatchTruncated),
            hasPatch: Boolean(file.hasPatch),
          }))
        : [],
    }));
}
