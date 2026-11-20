import type { HubItem } from './types'

const API = 'https://api.github.com'

/** Repo full names come from HTTP bodies/config — they end up inside the API path */
const FULL_NAME = /^[\w.-]+\/[\w.-]+$/
export function assertRepoName(fullName: string) {
  if (!FULL_NAME.test(String(fullName))) throw new Error('Repositório inválido (use "dono/nome")')
  return fullName
}

function headers(extra: Record<string, string> = {}) {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('Adicione um token do GitHub em 🔑 Chaves de API › Ferramentas › GitHub')
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'jarvis-hub', ...extra }
}

export async function gh<T>(pathname: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const res = await fetch(`${API}${pathname}`, { ...init, headers: { ...headers(init.raw ? { Accept: 'application/vnd.github.raw+json' } : {}), ...(init.headers as Record<string, string> || {}) }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = ((await res.json()) as { message?: string }).message || msg } catch {}
    const hint = res.status === 403 || res.status === 404 ? ' (o token pode não ter permissão para isso)' : ''
    throw Object.assign(new Error(`GitHub ${res.status}: ${msg}${hint}`), { status: res.status })
  }
  return (init.raw ? res.text() : res.json()) as Promise<T>
}

interface Repo { full_name: string; name: string; description: string | null; html_url: string; private: boolean; pushed_at: string; language: string | null; default_branch: string; open_issues_count: number; owner: { login: string } }
interface Issue { number: number; title: string; body: string | null; state: string; html_url: string; user?: { login: string }; created_at: string; updated_at: string; labels?: Array<{ name: string }>; pull_request?: unknown; assignees?: Array<{ login: string }> }
interface Commit { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } } }

export async function syncGitHub(maxRepos = 25): Promise<{ items: HubItem[]; account: string; errors: string[] }> {
  const user = await gh<{ login: string }>('/user')
  const repos = await gh<Repo[]>('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member')
  const items: HubItem[] = []
  const errors: string[] = []
  const now = Date.now()

  for (const r of repos.slice(0, maxRepos)) {
    let readme = ''
    try { readme = (await gh<string>(`/repos/${r.full_name}/readme`, { raw: true })).slice(0, 8000) } catch {}
    items.push({
      id: `gh-repo-${r.full_name}`,
      source: 'github', kind: 'repo',
      title: r.full_name,
      text: `${r.description || ''}\nLinguagem: ${r.language || '—'}\n${readme}`,
      origin: { source: 'github', where: r.full_name, author: r.owner.login, at: Date.parse(r.pushed_at), url: r.html_url },
      meta: { fullName: r.full_name, private: r.private, branch: r.default_branch, openIssues: r.open_issues_count, language: r.language },
      importedAt: now,
    })
    try {
      const issues = await gh<Issue[]>(`/repos/${r.full_name}/issues?state=all&per_page=30&sort=updated`)
      for (const i of issues) {
        const isPr = !!i.pull_request
        items.push({
          id: `gh-${isPr ? 'pr' : 'issue'}-${r.full_name}-${i.number}`,
          source: 'github', kind: isPr ? 'pr' : 'issue',
          title: `${r.full_name}#${i.number} ${i.title}`,
          text: `${i.title}\n${i.body || ''}`.slice(0, 6000),
          origin: { source: 'github', where: `${r.full_name} › ${isPr ? 'pull request' : 'issue'} #${i.number}`, author: i.user?.login, at: Date.parse(i.updated_at), url: i.html_url },
          meta: { state: i.state, labels: (i.labels || []).map(l => l.name), assignees: (i.assignees || []).map(a => a.login), repo: r.full_name, number: i.number, assignedToMe: (i.assignees || []).some(a => a.login === user.login) },
          importedAt: now,
        })
      }
    } catch (e) { errors.push(`${r.full_name} issues: ${(e as Error).message}`) }
    try {
      const commits = await gh<Commit[]>(`/repos/${r.full_name}/commits?per_page=10`)
      for (const c of commits) {
        items.push({
          id: `gh-commit-${c.sha}`,
          source: 'github', kind: 'commit',
          title: `${r.full_name}: ${c.commit.message.split('\n')[0].slice(0, 120)}`,
          text: c.commit.message.slice(0, 3000),
          origin: { source: 'github', where: `${r.full_name} › commit ${c.sha.slice(0, 7)}`, author: c.commit.author?.name, at: c.commit.author?.date ? Date.parse(c.commit.author.date) : undefined, url: c.html_url },
          meta: { repo: r.full_name, sha: c.sha },
          importedAt: now,
        })
      }
    } catch (e) {
      // Empty repositories answer 409
      if (!/409/.test((e as Error).message)) errors.push(`${r.full_name} commits: ${(e as Error).message}`)
    }
  }
  return { items, account: user.login, errors }
}

export async function repoTree(fullName: string, branch?: string): Promise<string[]> {
  assertRepoName(fullName)
  const ref = branch || (await gh<Repo>(`/repos/${fullName}`)).default_branch
  const tree = await gh<{ tree: Array<{ path: string; type: string }>; truncated: boolean }>(`/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
  return tree.tree.filter(t => t.type === 'blob').map(t => t.path).slice(0, 2000)
}

export async function readRepoFile(fullName: string, filePath: string): Promise<string> {
  assertRepoName(fullName)
  const text = await gh<string>(`/repos/${fullName}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}`, { raw: true })
  return text.slice(0, 60_000)
}

/** Only called after the user approved the action. */
export async function createIssue(fullName: string, title: string, body: string) {
  assertRepoName(fullName)
  const r = await gh<{ html_url: string; number: number }>(`/repos/${fullName}/issues`, { method: 'POST', body: JSON.stringify({ title, body }) })
  return `Issue #${r.number} criada: ${r.html_url}`
}

/** Only called after the user approved the action. Creates or updates one file as a commit. */
export async function commitFile(fullName: string, filePath: string, content: string, message: string, branch?: string) {
  assertRepoName(fullName)
  const encoded = filePath.split('/').map(encodeURIComponent).join('/')
  let sha: string | undefined
  try { sha = (await gh<{ sha: string }>(`/repos/${fullName}/contents/${encoded}${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`)).sha } catch {}
  const r = await gh<{ commit: { html_url: string } }>(`/repos/${fullName}/contents/${encoded}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: Buffer.from(content, 'utf-8').toString('base64'), sha, ...(branch ? { branch } : {}) }),
  })
  return `Commit enviado: ${r.commit.html_url}`
}
