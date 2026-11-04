#!/usr/bin/env python3
"""Repository custodian: deployment health report, merged-branch cleanup, revert PRs.

Standard library only, so the job installs nothing. It talks to the GitHub REST API with the
workflow's own GITHUB_TOKEN and reads its settings from .github/custodian/config.json.

Subcommands
  health    Write the daily "Deployment health" issue (edits one issue; comments only when
            something new turns red).
  branches  Delete branches whose pull request merged and that nobody has touched since.
  revert    After a production deploy failed AFTER going live (and deploy.yml already put the
            previous version back), open a revert pull request for the owner to approve.

Safety rules (kept in code, not only in config):
  * A branch is deleted only when a MERGED pull request's head commit is still the branch tip,
    no open pull request uses it as head or base, it is not the default branch, not protected,
    no ruleset applies to it, and its name is not on the keep list (codex/*, *revenuecat*,
    release/*, staging*, archive/* and the rest).
  * Secret values are never printed. Presence arrives as true/false from the workflow; the
    validity checks print only "valid", "invalid", "expires <date>".
  * Nothing here merges, deploys, approves, or deletes environments.
"""
import datetime as dt
import fnmatch
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")
REPO = os.environ.get("GITHUB_REPOSITORY", "")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
SERVER = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
NOW = dt.datetime.now(dt.timezone.utc)
MARK = "<!-- custodian-state:"

DEFAULT_KEEP = [
    "main", "master", "develop", "gh-pages", "gh-readonly-queue/*",
    "release", "release/*", "releases/*", "staging", "staging/*", "*staging*", "*release*",
    "codex/*", "*revenuecat*", "archive/*", "backup/*", "hotfix/*", "data",
]


# ---------------------------------------------------------------- GitHub API

class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


def gh(method, path, body=None, ok404=False):
    url = path if path.startswith("http") else f"{API}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "repo-custodian",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        if ok404 and e.code == 404:
            return None
        try:
            msg = json.loads(e.read()).get("message", "")
        except Exception:
            msg = ""
        raise ApiError(e.code, msg) from None


def paged(path, key=None, limit=3000, stop=None):
    """Yield items from a paginated list endpoint. `stop(item)` ends the walk early."""
    sep = "&" if "?" in path else "?"
    page, seen = 1, 0
    while seen < limit:
        data = gh("GET", f"{path}{sep}per_page=100&page={page}")
        items = data.get(key, []) if key else data
        if not items:
            return
        for it in items:
            if stop and stop(it):
                return
            yield it
            seen += 1
        if len(items) < 100:
            return
        page += 1


def ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def ago(t):
    if not t:
        return "never"
    d = NOW - t
    if d.days >= 1:
        return f"{d.days}d ago"
    h = d.seconds // 3600
    return f"{h}h ago" if h else f"{d.seconds // 60}m ago"


def load_config():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")) as f:
        return json.load(f)


def summary(text):
    p = os.environ.get("GITHUB_STEP_SUMMARY")
    if p:
        with open(p, "a") as f:
            f.write(text + "\n")
    print(text)


# ---------------------------------------------------------------- branches

def keep_patterns(cfg):
    return DEFAULT_KEEP + cfg.get("keep_branches", [])


def is_kept(name, patterns):
    low = name.lower()
    return any(fnmatch.fnmatchcase(low, p.lower()) for p in patterns)


def has_rules(branch):
    """True when any ruleset applies, or when we cannot tell (fail safe)."""
    try:
        rules = gh("GET", f"/repos/{REPO}/rules/branches/{urllib.parse.quote(branch, safe='')}")
        return bool(rules)
    except ApiError:
        return True


def branch_candidates(cfg, since=None, only=None):
    """Return (candidates, skipped) where candidates are dicts with name, pr, sha."""
    repo = gh("GET", f"/repos/{REPO}")
    default = repo["default_branch"]
    patterns = keep_patterns(cfg)

    open_heads, open_bases = set(), set()
    for pr in paged(f"/repos/{REPO}/pulls?state=open"):
        if pr["head"]["repo"] and pr["head"]["repo"]["full_name"] == REPO:
            open_heads.add(pr["head"]["ref"])
        open_bases.add(pr["base"]["ref"])

    branches = {}
    if only:
        b = gh("GET", f"/repos/{REPO}/branches/{urllib.parse.quote(only, safe='')}", ok404=True)
        if b:
            branches[b["name"]] = b
    else:
        for b in paged(f"/repos/{REPO}/branches"):
            branches[b["name"]] = b

    # Merged pull requests by head branch -> list of (head sha, number, merged_at).
    merged = {}
    stop = (lambda pr: since is not None and ts(pr["updated_at"]) < since)
    for pr in paged(f"/repos/{REPO}/pulls?state=closed&sort=updated&direction=desc", stop=stop):
        if not pr.get("merged_at"):
            continue
        if not pr["head"]["repo"] or pr["head"]["repo"]["full_name"] != REPO:
            continue
        if since is not None and ts(pr["merged_at"]) < since:
            continue
        merged.setdefault(pr["head"]["ref"], []).append((pr["head"]["sha"], pr["number"], pr["merged_at"]))

    cands, skipped = [], []
    for name, b in sorted(branches.items()):
        if name not in merged:
            continue
        sha = b["commit"]["sha"]
        match = next((m for m in merged[name] if m[0] == sha), None)
        why = None
        if name == default:
            why = "default branch"
        elif b.get("protected"):
            why = "protected"
        elif is_kept(name, patterns):
            why = "on the keep list"
        elif name in open_heads:
            why = "an open pull request uses it"
        elif name in open_bases:
            why = "an open pull request targets it"
        elif not match:
            why = "has commits after its merge"
        if why:
            skipped.append((name, why))
            continue
        cands.append({"name": name, "sha": sha, "pr": match[1], "merged_at": match[2]})
    return cands, skipped


def cmd_branches(cfg, args):
    mode = args.get("mode", "recent")          # recent | backlog | pr
    delete = args.get("delete", False)
    cap = int(cfg.get("max_deletions_per_run", 100))
    since = None
    if mode == "recent":
        since = NOW - dt.timedelta(days=int(cfg.get("recent_days", 14)))
    only = args.get("branch") if mode == "pr" else None
    if mode == "pr" and not only:
        print("No branch given.")
        return 0

    cands, skipped = branch_candidates(cfg, since=since, only=only)
    deleted, failed, left = [], [], []
    for c in cands:
        if not delete or len(deleted) >= cap:
            left.append(c)
            continue
        if has_rules(c["name"]):
            skipped.append((c["name"], "a ruleset applies (or rules could not be read)"))
            continue
        # Re-check the tip right before deleting, so a push made a moment ago is never lost.
        b = gh("GET", f"/repos/{REPO}/branches/{urllib.parse.quote(c['name'], safe='')}", ok404=True)
        if not b or b["commit"]["sha"] != c["sha"]:
            skipped.append((c["name"], "changed while the custodian was running"))
            continue
        try:
            gh("DELETE", f"/repos/{REPO}/git/refs/heads/{urllib.parse.quote(c['name'], safe='/')}")
            deleted.append(c)
        except ApiError as e:
            failed.append((c["name"], str(e)))

    title = {"recent": f"merged in the last {cfg.get('recent_days', 14)} days",
             "backlog": "every merged branch", "pr": f"branch {only}"}[mode]
    summary(f"## Branch cleanup: {title}\n")
    summary(f"Deleted {len(deleted)}, " + (f"would delete {len(left)}" if not delete else f"left for the next run {len(left)}")
            + f", kept {len(skipped)}, failed {len(failed)}.\n")
    summary("Every deleted branch can be restored from its pull request page (Restore branch).\n")
    for c in deleted[:200]:
        summary(f"- deleted `{c['name']}` (#{c['pr']})")
    for c in left[:200]:
        summary(f"- {'would delete' if not delete else 'next run'} `{c['name']}` (#{c['pr']})")
    for n, why in skipped[:200]:
        summary(f"- kept `{n}`: {why}")
    for n, err in failed:
        summary(f"- could not delete `{n}`: {err}")
    return 1 if failed else 0


# ---------------------------------------------------------------- health

def latest_runs(workflow, branch=None, event=None, limit=10):
    q = f"per_page={limit}&exclude_pull_requests=true"
    if branch:
        q += "&branch=" + urllib.parse.quote(branch, safe="")
    if event:
        q += "&event=" + urllib.parse.quote(event, safe="")
    try:
        data = gh("GET", f"/repos/{REPO}/actions/workflows/{workflow}/runs?{q}")
        return data.get("workflow_runs", [])
    except ApiError as e:
        return [{"error": str(e)}]


def check_url(url):
    req = urllib.request.Request(url, headers={"User-Agent": "repo-custodian"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, None
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # DNS, TLS, timeout
        return None, type(e).__name__


def secret_checks(cfg):
    """Presence from the workflow (true/false only) and safe validity checks."""
    rows, problems = [], []
    present = json.loads(os.environ.get("CUSTODIAN_SECRETS_PRESENT", "{}") or "{}")
    required = set(cfg.get("required_secrets", []))
    for name in sorted(cfg.get("production_only_secrets", [])):
        # Kept inside a deploy environment, behind the owner's Approve. This job never asks for them.
        rows.append((name, "kept in a deploy environment behind your Approve (not checked here)"))
    for name in sorted(present):
        ok = present[name] is True or present[name] == "true"
        state = "set" if ok else ("**missing**" if name in required else "not set (optional)")
        if not ok and name in required:
            problems.append(f"secret {name} missing")
        rows.append((name, state))

    def cf_verify(token, account):
        for path in ("/user/tokens/verify", f"/accounts/{account}/tokens/verify" if account else None):
            if not path:
                continue
            req = urllib.request.Request("https://api.cloudflare.com/client/v4" + path,
                                         headers={"Authorization": f"Bearer {token}", "User-Agent": "repo-custodian"})
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    res = json.load(r).get("result") or {}
                    return res.get("status"), res.get("expires_on")
            except Exception:
                continue
        return None, None

    tok = os.environ.get("CHECK_CLOUDFLARE_API_TOKEN")
    if tok:
        status, exp = cf_verify(tok, os.environ.get("CHECK_CLOUDFLARE_ACCOUNT_ID", ""))
        if status != "active":
            problems.append("CLOUDFLARE_API_TOKEN is not active")
            rows.append(("CLOUDFLARE_API_TOKEN check", f"**{status or 'rejected'}**"))
        else:
            note = "valid"
            if exp:
                left = ts(exp) - NOW
                note += f", expires {exp[:10]}"
                if left.days < 14:
                    problems.append(f"CLOUDFLARE_API_TOKEN expires {exp[:10]}")
                    note = f"**{note}**"
            rows.append(("CLOUDFLARE_API_TOKEN check", note))

    for var in [k for k in os.environ if k.startswith("CHECK_TELEGRAM_")]:
        name = var[len("CHECK_TELEGRAM_"):]
        tok = os.environ[var]
        if not tok:
            continue
        # The token is part of the URL, so no exception text from this call is ever printed.
        try:
            with urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/getMe", timeout=20) as r:
                ok = json.load(r).get("ok") is True
        except Exception:
            ok = False
        rows.append((f"{name} check", "valid" if ok else "**rejected by Telegram**"))
        if not ok:
            problems.append(f"{name} rejected by Telegram")

    for var in [k for k in os.environ if k.startswith("CHECK_GITHUB_")]:
        name = var[len("CHECK_GITHUB_"):]
        tok = os.environ[var]
        if not tok:
            continue
        req = urllib.request.Request("https://api.github.com/rate_limit",
                                     headers={"Authorization": f"Bearer {tok}", "User-Agent": "repo-custodian"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                exp = r.headers.get("github-authentication-token-expiration")
            note = "valid"
            if exp:
                exp_t = dt.datetime.strptime(exp[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.timezone.utc)
                note += f", expires {exp[:10]}"
                if (exp_t - NOW).days < 14:
                    problems.append(f"{name} expires {exp[:10]}")
                    note = f"**{note}**"
            rows.append((f"{name} check", note))
        except Exception:
            rows.append((f"{name} check", "**rejected by GitHub (expired or revoked)**"))
            problems.append(f"{name} rejected by GitHub")
    return rows, problems


def cmd_health(cfg, args):
    repo = gh("GET", f"/repos/{REPO}")
    default = repo["default_branch"]
    problems, lines = [], []
    lines.append(f"_Updated {NOW:%Y-%m-%d %H:%M} UTC by the custodian workflow. "
                 "This issue is edited daily; a comment is added only when something new needs you._\n")

    # Workflows
    lines.append("### Deploys and checks\n")
    lines.append("| Workflow | Latest run | Result | Last success |\n|---|---|---|---|")
    for wf in cfg.get("watch_workflows", []):
        runs = latest_runs(wf["file"], wf.get("branch"), wf.get("event"))
        if runs and "error" in runs[0]:
            lines.append(f"| {wf['name']} | could not read | {runs[0]['error']} | |")
            continue
        if not runs:
            lines.append(f"| {wf['name']} | no runs yet | | |")
            continue
        r = runs[0]
        result = r["conclusion"] or r["status"]
        good = next((x for x in runs if x["conclusion"] == "success"), None)
        icon = {"success": "✅", "failure": "❌", "cancelled": "⚪", "waiting": "⏸️ waiting for your approval",
                "in_progress": "🔄", "queued": "🔄", "action_required": "⏸️"}.get(result, result)
        lines.append(f"| {wf['name']} | [#{r['run_number']}]({r['html_url']}) {ago(ts(r['created_at']))} "
                     f"| {icon} | {('[' + ago(ts(good['created_at'])) + '](' + good['html_url'] + ')') if good else 'none in the last 10'} |")
        if result == "failure" and wf.get("critical", True):
            problems.append(f"{wf['name']} failed (run #{r['run_number']})")

    # Runs waiting for approval
    try:
        waiting = gh("GET", f"/repos/{REPO}/actions/runs?status=waiting&per_page=20").get("workflow_runs", [])
    except ApiError:
        waiting = []
    if waiting:
        lines.append("\n**Waiting for your approval:** " + ", ".join(
            f"[{w['name']} #{w['run_number']}]({w['html_url']}) ({ago(ts(w['created_at']))})" for w in waiting))

    # Environments, from the deployments history (works with the workflow token).
    lines.append("\n### Environments\n")
    envs = {}
    try:
        for d in paged(f"/repos/{REPO}/deployments", limit=300):
            e = d["environment"]
            if e not in envs:
                envs[e] = d
    except ApiError as e:
        lines.append(f"Could not read deployments: {e}")
    try:
        listed = gh("GET", f"/repos/{REPO}/environments?per_page=100")
        for e in (listed or {}).get("environments", []):
            envs.setdefault(e["name"], None)
    except ApiError:
        pass
    inactive_days = int(cfg.get("inactive_environment_days", 30))
    if envs:
        lines.append("| Environment | Last deployment | State |\n|---|---|---|")
        for name, d in sorted(envs.items()):
            if not d:
                lines.append(f"| {name} | none recorded | |")
                continue
            try:
                st = gh("GET", f"/repos/{REPO}/deployments/{d['id']}/statuses?per_page=1")
                state = st[0]["state"] if st else "unknown"
            except ApiError:
                state = "unknown"
            when = ts(d["created_at"])
            flag = " (inactive; remove only if you say so)" if (NOW - when).days > inactive_days else ""
            lines.append(f"| {name} | {ago(when)} (`{d['sha'][:7]}`) | {state}{flag} |")
    else:
        lines.append("No deployments recorded.")

    # Live endpoints
    if cfg.get("endpoints"):
        lines.append("\n### Live endpoints\n")
        lines.append("| Endpoint | Status |\n|---|---|")
        for ep in cfg["endpoints"]:
            code, err = check_url(ep["url"])
            ok = code is not None and code < 400
            lines.append(f"| [{ep['name']}]({ep['url']}) | {'✅ ' + str(code) if ok else '❌ ' + str(code or err)} |")
            if not ok and ep.get("critical", True):
                problems.append(f"{ep['name']} is down ({code or err})")

    # Secrets
    rows, sp = secret_checks(cfg)
    problems += sp
    if rows:
        lines.append("\n### Secrets (names only; values are never read into this report)\n")
        lines.append("| Secret | State |\n|---|---|")
        lines += [f"| {n} | {s} |" for n, s in rows]
        if cfg.get("environment_secrets_note"):
            lines.append("\n" + cfg["environment_secrets_note"])

    # Pull requests and branches
    lines.append("\n### Pull requests and branches\n")
    stale_h = int(cfg.get("stale_pr_hours", 48))
    open_prs = list(paged(f"/repos/{REPO}/pulls?state=open"))
    stale = [p for p in open_prs if not p.get("draft") and (NOW - ts(p["created_at"])).total_seconds() > stale_h * 3600]
    lines.append(f"{len(open_prs)} open pull requests; {len(stale)} ready ones older than {stale_h}h.")
    for p in sorted(stale, key=lambda p: p["created_at"])[:10]:
        lines.append(f"- [#{p['number']} {p['title']}]({p['html_url']}) ({ago(ts(p['created_at']))})")
    try:
        cands, _ = branch_candidates(cfg)
        lines.append(f"\n{len(cands)} merged branches are waiting to be cleaned up "
                     f"(new merges are cleaned up automatically; run the custodian with "
                     f"task `branches`, backlog on, to clear older ones).")
    except ApiError as e:
        lines.append(f"Could not count merged branches: {e}")

    rec = release_section(cfg, default)
    if rec:
        lines[1:1] = rec

    others, other_lines = other_repos(cfg)
    if other_lines:
        lines.append("\n### Other repositories\n")
        lines += other_lines

    status = "🟢 All clear" if not problems else "🔴 Needs attention: " + "; ".join(problems)
    body = f"## {status}\n\n" + "\n".join(lines)
    try:
        issue = upsert_issue(cfg, body, problems)
    except ApiError as e:
        if e.status != 410:
            raise
        # Issues are turned off in this repository: the report lives only in the run's summary.
        issue = None
        body += "\n\n_Issues are turned off in this repository, so this report is kept only in the run summary._"
    if issue:
        send_alerts(cfg, issue, problems, others)
    summary(body)
    return 0


def release_section(cfg, default):
    """Today's deploy recommendation: what is merged but not live yet."""
    rc = cfg.get("release")
    if not rc:
        return []
    out = ["### Today's release recommendation\n"]
    runs = latest_runs(rc["workflow"], rc.get("branch", default), rc.get("event"), limit=30)
    if runs and "error" in runs[0]:
        return out + [f"Could not read deploys: {runs[0]['error']}", ""]
    live = next((r for r in runs if r["conclusion"] == "success"), None)
    head = gh("GET", f"/repos/{REPO}/commits/{urllib.parse.quote(rc.get('branch', default), safe='')}")
    if not live:
        return out + ["No successful deploy in the last 30 runs, so what is live is unknown.", ""]
    if live["head_sha"] == head["sha"]:
        return out + [f"Nothing to deploy: production runs the newest `{default}` "
                      f"([deploy #{live['run_number']}]({live['html_url']}), {ago(ts(live['created_at']))}).", ""]
    try:
        cmp = gh("GET", f"/repos/{REPO}/compare/{live['head_sha']}...{head['sha']}")
    except ApiError as e:
        return out + [f"Could not compare the live release with `{default}`: {e}", ""]
    titles = []
    for c in cmp.get("commits", [])[-30:]:
        first = c["commit"]["message"].splitlines()[0]
        if "[skip ci]" in first:
            continue
        titles.append(first)
    waiting = [r for r in runs if r["status"] in ("waiting", "action_required") and r["head_sha"] == head["sha"]]
    out.append(f"**{cmp.get('ahead_by', len(titles))} change(s) are merged but not live** "
               f"(live: `{live['head_sha'][:7]}` from {ago(ts(live['created_at']))}).")
    for t in titles[-15:]:
        out.append(f"- {t}")
    if waiting:
        w = waiting[0]
        out.append(f"\n**Recommendation:** approve [deploy #{w['run_number']}]({w['html_url']}). It is the newest "
                   "and carries every change above; older runs still waiting can be rejected.")
    else:
        out.append("\n**Recommendation:** no deploy of the newest commit is waiting. "
                   f"Run **{rc['workflow']}** by hand when you want these live.")
    out.append("")
    return out


def read_marker(body, mark):
    if body and mark in body:
        try:
            return json.loads(body.split(mark, 1)[1].split("-->", 1)[0])
        except Exception:
            return None
    return None


def other_repos(cfg):
    """Read the other repositories' Deployment health issues (state only) for one combined view."""
    others, lines = {}, []
    title = cfg.get("health_issue_title", "Deployment health")
    for repo in cfg.get("watch_repos", []):
        try:
            items = gh("GET", f"/repos/{repo}/issues?state=open&labels={urllib.parse.quote(cfg.get('label', 'custodian'))}&per_page=20")
        except ApiError as e:
            lines.append(f"- {repo}: issues are turned off there; see its custodian run summary" if e.status == 410
                         else f"- {repo}: could not read ({e.status})")
            continue
        issue = next((i for i in items if i["title"] == title and "pull_request" not in i), None)
        if not issue:
            lines.append(f"- {repo}: no report yet")
            continue
        probs = read_marker(issue.get("body"), MARK)
        if probs is None:
            lines.append(f"- [{repo}]({issue['html_url']}): report unreadable")
            continue
        others[repo] = probs
        lines.append(f"- [{repo}]({issue['html_url']}): " + ("🟢 all clear" if not probs else "🔴 " + "; ".join(probs)))
    return others, lines


ALERT_MARK = "<!-- custodian-alerted:"


def telegram(text):
    """Send one message to the owner. Returns True when at least one chat got it. Never prints the token."""
    token = os.environ.get("ALERT_BOT_TOKEN", "")
    chats = [c.strip() for c in os.environ.get("ALERT_CHAT_IDS", "").split(",") if c.strip()]
    sent = False
    for chat in chats[:3]:
        data = urllib.parse.urlencode({"chat_id": chat, "text": text, "disable_web_page_preview": "true"}).encode()
        try:
            # The token is part of the URL, so no exception text from this call is ever printed.
            urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data=data, timeout=20).read()
            sent = True
        except Exception:
            pass
    print("Telegram alert sent." if sent else "Telegram alert could not be sent.")
    return sent


def send_alerts(cfg, issue, problems, others):
    """Message the owner on Telegram about problems not alerted before. Never prints the token."""
    token = os.environ.get("ALERT_BOT_TOKEN", "")
    chats = [c.strip() for c in os.environ.get("ALERT_CHAT_IDS", "").split(",") if c.strip()]
    if not token or not chats or not issue:
        return
    keys = [f"{REPO.split('/')[1]}: {p}" for p in problems]
    for repo, probs in others.items():
        keys += [f"{repo.split('/')[1]}: {p}" for p in probs]
    body = gh("GET", f"/repos/{REPO}/issues/{issue['number']}").get("body") or ""
    before = read_marker(body, ALERT_MARK)
    new = [k for k in keys if k not in (before or [])]
    cleared = bool(before) and not keys
    if before is None:
        before = []
    sent = True
    if new or cleared:
        sent = False
        if new:
            text = "CyberJudah deploy watch: something new needs you.\n\n" + "\n".join("• " + k for k in new[:15])
        else:
            text = "CyberJudah deploy watch: all clear again."
        text += f"\n\n{issue.get('html_url', '')}"
        sent = telegram(text)
    if not sent:
        return  # try again on the next run
    # Remember what was alerted, so the same problem is never sent twice.
    head, _, tail = body.partition(ALERT_MARK)
    tail = tail.split("-->", 1)[1] if "-->" in tail else ""
    body = head.rstrip() + f"\n{ALERT_MARK}{json.dumps(keys)}-->" + tail
    gh("PATCH", f"/repos/{REPO}/issues/{issue['number']}", {"body": body})


def ensure_label(name):
    if gh("GET", f"/repos/{REPO}/labels/{urllib.parse.quote(name)}", ok404=True) is None:
        try:
            gh("POST", f"/repos/{REPO}/labels", {"name": name, "color": "5319e7",
                                                   "description": "Kept up to date by the custodian workflow"})
        except ApiError:
            pass


def find_issue(cfg):
    label = cfg.get("label", "custodian")
    title = cfg.get("health_issue_title", "Deployment health")
    for it in paged(f"/repos/{REPO}/issues?state=open&labels={urllib.parse.quote(label)}&creator=github-actions%5Bbot%5D", limit=50):
        if it["title"] == title and "pull_request" not in it:
            return it
    return None


def upsert_issue(cfg, body, problems):
    label = cfg.get("label", "custodian")
    ensure_label(label)
    issue = find_issue(cfg)
    old = []
    if issue and MARK in (issue.get("body") or ""):
        try:
            old = json.loads(issue["body"].split(MARK, 1)[1].split("-->", 1)[0])
        except Exception:
            old = []
    full = body + f"\n\n{MARK}{json.dumps(problems)}-->"
    for keep in (ALERT_MARK, OTA_MARK, WAIT_MARK):
        kept = (issue.get("body") or "").split(keep, 1) if issue else [""]
        if len(kept) == 2:
            full += f"\n{keep}" + kept[1].split("-->", 1)[0] + "-->"
    if issue:
        gh("PATCH", f"/repos/{REPO}/issues/{issue['number']}", {"body": full})
    else:
        issue = gh("POST", f"/repos/{REPO}/issues", {
            "title": cfg.get("health_issue_title", "Deployment health"), "body": full, "labels": [label]})
    new = [p for p in problems if p not in old]
    cleared = [p for p in old if p not in problems]
    if new or (cleared and not problems):
        msg = []
        if new:
            msg.append("New problem" + ("s" if len(new) > 1 else "") + ": " + "; ".join(new) + ".")
        if cleared and not problems:
            msg.append("All clear again.")
        owner = cfg.get("owner_mention")
        text = " ".join(msg) + (f" {owner}" if owner and new else "")
        gh("POST", f"/repos/{REPO}/issues/{issue['number']}/comments", {"body": text})
    return issue


# ---------------------------------------------------------------- app update watch

OTA_MARK = "<!-- custodian-ota:"


def ota_serving(url, channel, platform, runtime, client_id=""):
    """What the public manifest endpoint serves a device with no update yet: an update id, a directive or an error."""
    headers = {
        "User-Agent": "repo-custodian", "expo-protocol-version": "1", "expo-platform": platform,
        "expo-runtime-version": runtime, "expo-channel-name": channel,
        "accept": "multipart/mixed,application/expo+json,application/json"}
    if client_id:
        # One fixed id, so the watch shows up as a single device in the update server's metrics.
        headers["eas-client-id"] = client_id
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read(2_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return f"error {e.code}"
    except Exception as e:
        return f"error {type(e).__name__}"
    for part in ("manifest", "directive"):
        tag = f'name="{part}"'
        if tag in raw:
            body = raw.split(tag, 1)[1]
            body = body.split("\r\n\r\n", 1)[-1] if "\r\n\r\n" in body else body.split("\n\n", 1)[-1]
            body = body.split("\n--", 1)[0].strip()
            try:
                doc = json.loads(body)
            except Exception:
                return f"unreadable {part}"
            # Server text goes into a chat message and an issue comment: keep it short and plain.
            clean = lambda v: re.sub(r"[^A-Za-z0-9._:-]", "", str(v))[:64] or "?"
            if part == "manifest":
                return "update " + clean(doc.get("id", "?"))
            return clean(doc.get("type", "directive"))
    return "no update"


def cmd_ota(cfg, args):
    """Alert the owner whenever what the update server serves changes (a publish, promote, rollback or rollout
    reaching every device). Uses only the public manifest endpoint: no update-server secret is needed."""
    w = cfg.get("ota_watch")
    if not w:
        print("No update server to watch.")
        return 0
    now = {}
    for ch in w.get("channels", []):
        for pf in w.get("platforms", ["ios", "android"]):
            for rt in w.get("runtimes", []):
                now[f"{ch} {pf} {rt}"] = ota_serving(w["url"], ch, pf, rt, w.get("client_id", ""))
    for k, v in sorted(now.items()):
        print(f"{k}: {v}")
    issue = find_issue(cfg)
    if not issue:
        print("No Deployment health issue yet; the next health run creates it.")
        return 0
    body = gh("GET", f"/repos/{REPO}/issues/{issue['number']}").get("body") or ""
    before = read_marker(body, OTA_MARK)
    changed = [(k, (before or {}).get(k), v) for k, v in sorted(now.items())
               if before is not None and (before or {}).get(k) != v and not v.startswith("error")]
    errors = [k for k, v in now.items() if v.startswith("error")]
    if errors:
        print("Could not read: " + ", ".join(sorted(errors)))
    if changed:
        lines = [f"• {k}: {old or 'nothing recorded'} → {new}" for k, old, new in changed]
        text = ("CyberJudah app updates changed on updates.cyberjudah.io. If you did not publish or roll back, "
                "treat it as an incident.\n\n" + "\n".join(lines[:12]) + f"\n\n{issue.get('html_url', '')}")
        sent = telegram(text) if os.environ.get("ALERT_BOT_TOKEN") else False
        owner = cfg.get("owner_mention", "")
        gh("POST", f"/repos/{REPO}/issues/{issue['number']}/comments",
           {"body": "App update server now serves something new:\n" + "\n".join(l.replace("• ", "- ") for l in lines)
                    + f"\n\nIf you did not publish or roll back, treat it as an incident. {owner}".rstrip()})
        if not sent:
            print("Owner told on GitHub only.")
    if before is None or changed:
        keep = {k: v for k, v in now.items() if not v.startswith("error")}
        merged = {**(before or {}), **keep}
        body = body.split(OTA_MARK, 1)
        rest = body[1].split("-->", 1)[1] if len(body) == 2 else ""
        body = body[0].rstrip() + f"\n{OTA_MARK}{json.dumps(merged)}-->" + rest
        gh("PATCH", f"/repos/{REPO}/issues/{issue['number']}", {"body": body})
    return 0


# ---------------------------------------------------------------- approval watch

WAIT_MARK = "<!-- custodian-waiting:"


def waiting_runs(repo):
    """Runs in `repo` paused at an environment's Approve gate, newest first."""
    runs = gh("GET", f"/repos/{repo}/actions/runs?status=waiting&per_page=30").get("workflow_runs", [])
    return sorted(runs, key=lambda r: r["created_at"], reverse=True)


def gate_names(repo, run_id):
    try:
        pend = gh("GET", f"/repos/{repo}/actions/runs/{run_id}/pending_deployments") or []
        return sorted({p["environment"]["name"] for p in pend if p.get("environment")})
    except ApiError:
        return []


def cmd_waiting(cfg, args):
    """Tell the owner on Telegram, once per run, when a deploy is waiting for their Approve.
    It only reads: it never approves, rejects or cancels anything."""
    repos = [REPO] + [r for r in cfg.get("watch_repos", []) if r != REPO]
    wait_for = str(args.get("wait_for") or "")
    if wait_for.isdigit():
        # Called from a deploy itself: give its gated job up to 3 minutes to reach the Approve gate.
        for _ in range(18):
            run = gh("GET", f"/repos/{REPO}/actions/runs/{wait_for}")
            if run["status"] in ("waiting", "completed"):
                break
            time.sleep(10)
    now, failed = {}, []
    for repo in repos:
        try:
            now[repo] = waiting_runs(repo)
        except ApiError as e:
            failed.append(repo)
            print(f"{repo}: could not read waiting runs ({e.status})")
    issue = find_issue(cfg)
    if not issue:
        print("No Deployment health issue yet; the next health run creates it.")
        return 0
    body = gh("GET", f"/repos/{REPO}/issues/{issue['number']}").get("body") or ""
    before = read_marker(body, WAIT_MARK) or []
    current = [f"{repo}:{r['id']}" for repo, runs in now.items() for r in runs]
    blocks = []
    for repo, runs in now.items():
        newest = {}
        for r in runs:  # newest first
            group = (r["workflow_id"], r.get("head_branch"))
            newer = newest.setdefault(group, r)
            if f"{repo}:{r['id']}" in before:
                continue
            title = ((r.get("head_commit") or {}).get("message") or "").splitlines()[:1]
            # Commit text goes into a chat message: keep it short and plain.
            title = re.sub(r"\s+", " ", title[0])[:90] if title else ""
            gates = gate_names(repo, r["id"])
            line = (f"• {repo.split('/')[1]}: {r['name']} #{r['run_number']}"
                    + (f" (needs Approve for {', '.join(gates)})" if gates else "")
                    + f"\n  {r['head_sha'][:7]} {title}".rstrip()
                    + f"\n  {r['html_url']}")
            if newer is not r:
                line += (f"\n  Superseded by #{newer['run_number']}, which carries this change too, "
                         "so this one can be rejected.")
            blocks.append(line)
    for b in blocks:
        print(b)
    if blocks:
        text = ("CyberJudah: " + ("a deploy is" if len(blocks) == 1 else f"{len(blocks)} deploys are")
                + " waiting for your Approve.\n\n" + "\n\n".join(blocks[:10]))
        if not (os.environ.get("ALERT_BOT_TOKEN") and telegram(text)):
            return 0  # try again on the next run
    # Remember what was sent. Runs no longer waiting drop out; a repo that could not be read keeps its ids.
    keep = current + [k for k in before if k.split(":", 1)[0] in failed]
    if sorted(keep) != sorted(before):
        head, _, tail = body.partition(WAIT_MARK)
        tail = tail.split("-->", 1)[1] if "-->" in tail else ""
        body = head.rstrip() + f"\n{WAIT_MARK}{json.dumps(keep)}-->" + tail
        gh("PATCH", f"/repos/{REPO}/issues/{issue['number']}", {"body": body})
    return 0


# ---------------------------------------------------------------- revert

def cmd_revert(cfg, args):
    rc = cfg.get("revert")
    run_id = args.get("run_id")
    if not rc or not run_id:
        print("Revert is not configured for this repository.")
        return 0
    run = gh("GET", f"/repos/{REPO}/actions/runs/{int(run_id)}")
    repo = gh("GET", f"/repos/{REPO}")
    if run["conclusion"] != "failure" or run["event"] != "push" or run["head_branch"] != repo["default_branch"]:
        print("Not a failed deploy of the default branch; nothing to do.")
        return 0
    jobs = gh("GET", f"/repos/{REPO}/actions/runs/{run['id']}/jobs?per_page=100")["jobs"]
    went_live = rolled_back = False
    for j in jobs:
        for s in j.get("steps", []):
            if s["name"] == rc["live_step"] and s["conclusion"] == "success":
                went_live = True
            if s["name"] == rc["rollback_step"] and s["conclusion"] in ("success", "failure"):
                rolled_back = s["conclusion"] == "success"
    if not went_live:
        print("The release never went live; production was not changed. No revert needed.")
        return 0

    sha = run["head_sha"]
    # Which pull request brought this commit?
    prs = gh("GET", f"/repos/{REPO}/commits/{sha}/pulls") or []
    pr = next((p for p in prs if p.get("merged_at")), None)
    branch = f"custodian/revert-{sha[:7]}"
    existing = gh("GET", f"/repos/{REPO}/pulls?state=all&head={REPO.split('/')[0]}:{urllib.parse.quote(branch)}")
    if existing:
        print(f"A revert pull request already exists: #{existing[0]['number']}")
        return 0

    git = lambda *a: subprocess.run(["git", *a], check=True)
    head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    if head != sha:
        print(f"The default branch moved on ({head[:7]}); reverting {sha[:7]} on top of it.")
    git("config", "user.name", "github-actions[bot]")
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    git("checkout", "-b", branch)
    parents = subprocess.run(["git", "rev-list", "--parents", "-n", "1", sha], capture_output=True, text=True, check=True).stdout.split()
    revert = ["revert", "--no-edit"] + (["-m", "1"] if len(parents) > 2 else []) + [sha]
    if subprocess.run(["git", *revert]).returncode != 0:
        subprocess.run(["git", "revert", "--abort"])
        note = (f"Deploy run [{run['run_number']}]({run['html_url']}) failed after going live"
                f"{' and was rolled back to the version serving before it' if rolled_back else ''}. "
                f"`{sha[:7]}` does not revert cleanly, so no revert pull request was opened.")
        comment_somewhere(cfg, pr, note)
        return 1
    git("push", "origin", branch)
    who = f"#{pr['number']} ({pr['title']})" if pr else f"commit {sha[:7]}"
    body = (f"Production deploy [run #{run['run_number']}]({run['html_url']}) failed **after going live**. "
            + ("deploy.yml already put production back on the version serving before it, so readers are fine. "
               if rolled_back else "**The automatic rollback did not finish; check production now.** ")
            + f"\n\nThis reverts {who} so the next merge does not ship it again. Merge it only if you agree; "
            "closing it keeps the change on main.\n\n"
            "Pull requests opened by a workflow do not start the checks by themselves. "
            "Push to this branch or run the checks by hand if you want them before merging.\n\n"
            "_Opened by the custodian workflow._")
    try:
        new = gh("POST", f"/repos/{REPO}/pulls", {"title": f"Revert {who}", "head": branch,
                                                  "base": repo["default_branch"], "body": body})
        print(f"Opened revert pull request #{new['number']}")
        comment_somewhere(cfg, pr, f"Deploy failed after going live; revert pull request #{new['number']} is waiting for you.")
    except ApiError as e:
        comment_somewhere(cfg, pr, body + f"\n\n(The custodian pushed branch `{branch}` but could not open the "
                          f"pull request: {e}. Allow GitHub Actions to create pull requests under "
                          "Settings → Actions → General, or open it from the branch.)")
    return 0


def comment_somewhere(cfg, pr, text):
    target = pr["number"] if pr else None
    try:
        if target is None:
            issue = find_issue(cfg)
            target = issue["number"] if issue else None
        if target:
            gh("POST", f"/repos/{REPO}/issues/{target}/comments", {"body": text})
    except ApiError as e:
        if e.status != 410:
            raise
    summary(text)


# ---------------------------------------------------------------- main

def main():
    if not REPO or not TOKEN:
        sys.exit("GITHUB_REPOSITORY and GITHUB_TOKEN are required.")
    cfg = load_config()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "health"
    args = {}
    for a in sys.argv[2:]:
        k, _, v = a.partition("=")
        args[k.lstrip("-")] = {"true": True, "false": False}.get(v, v)
    fn = {"health": cmd_health, "branches": cmd_branches, "revert": cmd_revert, "ota": cmd_ota, "waiting": cmd_waiting}.get(cmd)
    if not fn:
        sys.exit(f"Unknown task {cmd!r}")
    sys.exit(fn(cfg, args))


if __name__ == "__main__":
    main()
