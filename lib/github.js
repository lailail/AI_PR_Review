const GITHUB_API_BASE_URL = "https://api.github.com";
const MAX_FILE_PAGES = 10;

export class GitHubPrError extends Error {
  constructor(code, message, status = 500) {
    super(code);
    this.name = "GitHubPrError";
    this.code = code;
    this.status = status;
    this.clientMessage = message;
  }
}

/**
 * 解析用户输入的 GitHub PR 链接。
 * 后续 GitHub API 请求必须依赖 owner、repo 和 pullNumber，因此这里集中做格式校验。
 */
export function parseGitHubPullRequestUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    const [owner, repo, pullSegment, pullNumberSegment] = segments;
    const pullNumber = Number(pullNumberSegment);

    if (
      parsedUrl.hostname !== "github.com" ||
      !owner ||
      !repo ||
      pullSegment !== "pull" ||
      !Number.isInteger(pullNumber) ||
      pullNumber <= 0
    ) {
      throw new Error("Invalid GitHub pull request URL");
    }

    return { owner, repo, pullNumber };
  } catch {
    throw new GitHubPrError(
      "INVALID_PR_URL",
      "请输入有效的 GitHub Pull Request 链接，例如 https://github.com/owner/repo/pull/123。",
      400,
    );
  }
}

/**
 * 统一封装 GitHub API 请求。
 * Token 只在服务端读取并写入请求头，避免把 GitHub Token 暴露给浏览器端代码。
 */
export async function fetchGitHubJson(endpoint) {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ai-pr-review-assistant",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${GITHUB_API_BASE_URL}${endpoint}`, {
    headers,
    cache: "no-store",
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw mapGitHubResponseError(response, data);
  }

  return { data, headers: response.headers };
}

/**
 * 将 GitHub 的 HTTP 状态转换成前端可理解的业务错误。
 * 这样 API Route 不需要散落很多状态码判断，前端也能显示稳定的中文提示。
 */
export function mapGitHubResponseError(response, data) {
  const message = data?.message || "GitHub API 请求失败。";

  if (response.status === 404) {
    return new GitHubPrError("GITHUB_NOT_FOUND", "没有找到对应的 Pull Request 或仓库不可访问。", 404);
  }

  if (response.status === 401) {
    return new GitHubPrError("GITHUB_UNAUTHORIZED", "GitHub Token 无效，请检查环境变量配置。", 401);
  }

  if (response.status === 403 && message.toLowerCase().includes("rate limit")) {
    return new GitHubPrError("GITHUB_RATE_LIMITED", "GitHub API 请求已达到限流，请配置 Token 或稍后重试。", 429);
  }

  if (response.status === 403) {
    return new GitHubPrError("GITHUB_UNAUTHORIZED", "当前 Token 没有访问该 Pull Request 的权限。", 403);
  }

  return new GitHubPrError("GITHUB_API_ERROR", message, response.status);
}

/**
 * 裁剪 PR 基础信息，只保留前端展示和后续 AI 分析需要的字段。
 * 这样可以减少浏览器端数据量，也避免把无关 GitHub 响应直接透传出去。
 */
export function formatPullRequestInfo(pullRequest) {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    author: pullRequest.user?.login || "unknown",
    state: pullRequest.state,
    htmlUrl: pullRequest.html_url,
    createdAt: pullRequest.created_at,
    updatedAt: pullRequest.updated_at,
    body: pullRequest.body || "",
    additions: pullRequest.additions || 0,
    deletions: pullRequest.deletions || 0,
    changedFiles: pullRequest.changed_files || 0,
  };
}

/**
 * 裁剪 changed files 数据。
 * patch 是后续 AI 上下文的核心输入，其他 raw_url、blob_url 等字段暂时不返回。
 */
export function formatPullRequestFiles(files) {
  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions || 0,
    deletions: file.deletions || 0,
    changes: file.changes || 0,
    patch: file.patch || "",
  }));
}

export async function fetchPullRequestInfo({ owner, repo, pullNumber }) {
  const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`;
  const { data } = await fetchGitHubJson(endpoint);

  return formatPullRequestInfo(data);
}

export async function fetchPullRequestFiles({ owner, repo, pullNumber }) {
  const files = [];
  let page = 1;
  let hasNextPage = true;

  /**
   * GitHub changed files 接口分页返回。这里最多拉取 10 页，兼顾大 PR 的完整性和响应速度。
   */
  while (hasNextPage && page <= MAX_FILE_PAGES) {
    const endpoint = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/pulls/${pullNumber}/files?per_page=100&page=${page}`;
    const { data, headers } = await fetchGitHubJson(endpoint);

    files.push(...data);
    hasNextPage = headers.get("link")?.includes('rel="next"') || false;
    page += 1;
  }

  return formatPullRequestFiles(files);
}
