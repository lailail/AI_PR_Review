export const HISTORY_STORAGE_KEY = "ai-pr-review-history:v1";
export const DEFAULT_MAX_HISTORY_RECORDS = 50;
export const DEFAULT_MAX_PATCH_DIGEST_FILES = 10;
export const DEFAULT_MAX_PATCH_EXCERPT_LENGTH = 600;

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

export function buildHistoryRecord(pr, files = [], summary = null, risks = [], suggestions = [], options = {}) {
  const analyzedAt = options.now || new Date().toISOString();

  /**
   * 历史记录只保存 AI 分析摘要和截断后的 patchDigest，不保存完整代码或完整 diff。
   * 这样既能表达上下文来源，也能控制浏览器 localStorage 体积和敏感代码暴露范围。
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
    suggestions,
    patchDigest: buildPatchDigest(files, risks, options),
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
        (record.patchDigest === undefined || Array.isArray(record.patchDigest))
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
      suggestions: Array.isArray(record.suggestions) ? record.suggestions : [],
      patchDigest: Array.isArray(record.patchDigest) ? record.patchDigest : [],
    }));
}
