import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const hash = text => createHash('sha1').update(text).digest('hex');
const root = new URL('../../../', import.meta.url);
export class FakeGithub {
  /** @type {any[]} */ rules = [];
  annotationOnly = false; failSave = ''; losePullResponse = false;
  calls = []; pulls = new Map(); refs = new Map(); commits = new Map(); checks = 'pending'; mergeable = true; extraFiles = []; wrongApp = false;
  constructor() {
    this.files = new Map();
    for (const path of ['app/scripts/final-captivity/events.json', 'app/scripts/final-captivity/drafts.json', 'app/scripts/final-captivity/periods.json', 'app/scripts/final-captivity/leaders.json', 'bot/data/ask-sources.json']) this.files.set(path, readFileSync(new URL(path, root), 'utf8'));
    this.files.set('blog/2026/test.md', '---\ntitle: Test class\ndate: 2026-01-01\nteacher: Test teacher\n---\n\nOriginal note.\n');
    this.main = hash('main'); this.commits.set(this.main, new Map(this.files));
  }
  /** @param {string} url @param {string} method @param {any} body @param {any} headers */
  respond(url, method = 'GET', body = null, headers = {}) {
    const u = new URL(url, 'https://api.github.com'), route = u.pathname.replace(/^\/github/, '');
    this.calls.push({ route, method, body, headers });
    const repo = route.includes('/cyberjudah-telegram/') ? 'DevSecObie/cyberjudah-telegram' : 'DevSecObie/cyberjudah';
    const p = route.replace(`/repos/${repo}`, '');
    const ok = value => ({ status: 200, body: value });
    if (p === '/rules/branches/main') return ok(this.rules);
    if (p === '/branches/main') return ok({ commit: { sha: this.main }, protected: true, protection: { required_status_checks: { checks: [{ context: repo.endsWith('-telegram') ? 'check' : 'validate', app_id: 15368 }] } } });
    if (p.startsWith('/contents/')) {
      const path = decodeURIComponent(p.slice('/contents/'.length));
      const ref = u.searchParams.get('ref') || body?.branch || this.main;
      const commit = this.refs.get(ref) || ref, files = this.commits.get(commit), text = files?.get(path);
      if (text == null) return { status: 404, body: {} };
      if (method === 'GET') return ok({ type: 'file', size: Buffer.byteLength(text), sha: hash(text), encoding: 'base64', content: Buffer.from(text).toString('base64') });
      if (method === 'PUT') {
        if (this.failSave === 'contents') return { status: 503, body: {} };
        if (!body.branch?.startsWith('cms/') || body.sha !== hash(text)) return { status: 409, body: {} };
        const changed = new Map(files); changed.set(path, Buffer.from(body.content, 'base64').toString());
        const sha = hash(JSON.stringify([...changed]) + this.calls.length); this.commits.set(sha, changed); this.refs.set(body.branch, sha);
        return ok({ commit: { sha } });
      }
    }
    if (p === '/git/refs' && method === 'POST') { this.refs.set(body.ref.replace('refs/heads/', ''), body.sha); return ok({}); }
    if (p.startsWith('/git/refs/heads/') && method === 'DELETE') { this.refs.delete(decodeURIComponent(p.slice('/git/refs/heads/'.length))); return ok({}); }
    if (p === '/pulls' && method === 'GET') return ok([...this.pulls.values()].filter(v => u.searchParams.get('head') === repo.split('/')[0] + ':' + v.head.ref));
    if (p === '/pulls' && method === 'POST') {
      if (this.failSave === 'pull') return { status: 503, body: {} };
      const number = this.pulls.size + 1;
      const pull = { number, html_url: `https://github.com/${repo}/pull/${number}`, state: 'open', merged: false, draft: body.draft, head: { sha: this.refs.get(body.head), ref: body.head, repo: { full_name: repo } }, base: { ref: body.base } };
      this.pulls.set(number, pull); return this.losePullResponse ? { status: 503, body: {} } : ok(pull);
    }
    const pull = /^\/pulls\/(\d+)(\/files|\/merge)?$/.exec(p);
    if (pull) {
      const value = this.pulls.get(+pull[1]); if (!value) return { status: 404, body: {} };
      if (pull[2] === '/files') {
        const files = this.commits.get(value.head.sha), base = this.commits.get(this.main);
        return ok([...files].filter(([path, text]) => base.get(path) !== text).map(([filename]) => ({ filename, status: 'modified' })).concat(this.extraFiles));
      }
      if (pull[2] === '/merge') {
        if (body.sha !== value.head.sha || this.checks !== 'success' || !this.mergeable || body.merge_method !== 'squash') return { status: 409, body: {} };
        value.merged = true; value.state = 'closed'; value.merge_commit_sha = value.head.sha; this.main = value.head.sha; this.files = this.commits.get(this.main); return ok({ merged: true, sha: this.main });
      }
      return ok({ ...value, mergeable: this.mergeable, mergeable_state: this.mergeable ? 'clean' : 'blocked' });
    }
    if (/^\/check-runs\/\d+\/annotations$/.test(p)) return ok([{annotation_level:'failure',message:'Process completed with exit code 1.'},{annotation_level:'failure',message:'The quote does not match the cited recording. Correct the quotation before publishing.'}]);
    if (/^\/commits\/[a-f0-9]+\/check-runs$/.test(p)) return ok({ check_runs: ['check', 'CodeQL', 'codeql', 'dependency-review', 'playwright', 'cms-content', 'validate'].map((name,i) => ({ id:i+1,name, app: { id: this.wrongApp ? 999 : 15368 }, status: this.checks === 'pending' ? 'in_progress' : 'completed', conclusion: this.checks === 'pending' ? null : this.checks, output: { summary: this.checks === 'failure' && !this.annotationOnly ? 'A quoted passage could not be found in the recording.' : '' } })) });
    return { status: 404, body: { error: `Unimplemented fake route ${method} ${p}` } };
  }
  fetch = async (url, init = {}) => { const result = this.respond(String(url), init.method, init.body ? JSON.parse(init.body) : null, init.headers); return Response.json(result.body, { status: result.status }); };
}
