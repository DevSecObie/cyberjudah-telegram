#!/usr/bin/env python3
"""Release manager for the CyberJudah iPhone and Android app (DevSecObie/cyberjudah-app).

Standard library only. It reuses the GitHub helpers in ../custodian/custodian.py and reads its
settings from config.json next to this file. The app repository is public, so the workflow's own
GITHUB_TOKEN is enough to read it.

What it checks on the release branch (the branch store builds are made from):
  * app.config.ts: app version, iOS build number, Android version code, Expo project id.
  * eas.json store profile: channel, bundle id, the settings a store build must have, no
    staging or local server in any of its values, the App Store Connect app id, and that the
    Firebase file it names exists and belongs to the store bundle id.
  * The build number is higher than every build already sent to App Store Connect
    (config.json "store_builds"), so the next store upload is not refused.
  * Checks on the release branch's newest commit, open pull requests into it, the latest run of
    each build workflow, and runs waiting for an Approve.
  * What changed on the release branch since the last store build.

Tasks
  report            Write the report to the run summary. While something is red, also send the
                    owner one Telegram message. With dry=true (pull requests) it only prints.
                    It writes nothing to GitHub.

It never builds, submits, merges, approves, changes a setting or reads a secret's value into a log.
"""
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "custodian"))
import custodian as C  # noqa: E402

OK, WARN, FAIL = "✅", "⚠️", "❌"


def load_config():
    with open(os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def q(s):
    return urllib.parse.quote(s, safe="")


def read_file(repo, path, ref):
    """A text file from `repo` at `ref`, or None when it does not exist."""
    data = C.gh("GET", f"/repos/{repo}/contents/{q(path).replace('%2F', '/')}?ref={q(ref)}", ok404=True)
    if not data or isinstance(data, list) or data.get("type") != "file":
        return None
    if data.get("encoding") == "base64" and data.get("content") is not None:
        import base64
        return base64.b64decode(data["content"]).decode("utf-8", "replace")
    # Files over 1 MB come without content; the release files are far smaller.
    return None


def version_tuple(v):
    return tuple(int(x) for x in v.split("."))


def resolve_profile(builds, name, seen=()):
    """An eas.json build profile with its `extends` chain applied (env merged)."""
    if name in seen or name not in builds:
        return None
    prof = dict(builds[name])
    parent = prof.pop("extends", None)
    if parent:
        base = resolve_profile(builds, parent, seen + (name,))
        if base is None:
            return None
        env = dict(base.get("env", {}))
        env.update(prof.get("env", {}))
        merged = dict(base)
        merged.update(prof)
        merged["env"] = env
        return merged
    return prof


# ---------------------------------------------------------------- checks

def check_config(cfg, sha):
    """Release settings at `sha`. Returns (rows, facts); each row is (state, item, detail)."""
    repo, app_dir = cfg["app_repo"], cfg["app_dir"].rstrip("/")
    rows, facts = [], {}

    conf = read_file(repo, f"{app_dir}/app.config.ts", sha)
    if conf is None:
        rows.append((FAIL, "app.config.ts", f"`{app_dir}/app.config.ts` not found"))
    else:
        found = {
            "version": re.search(r"const APP_VERSION = isCyberJudah \? '([^']+)'", conf),
            "build": re.search(r"buildNumber: isCyberJudah \? '([^']+)'", conf),
            "project": re.search(r"CYBERJUDAH_EAS_PROJECT_ID = '([^']+)'", conf),
            "android": re.search(r"CYBERJUDAH_ANDROID_VERSION_CODE \|\| (\d+)", conf),
        }
        version = found["version"].group(1) if found["version"] else None
        build = found["build"].group(1) if found["build"] else None
        if version and re.fullmatch(r"\d+\.\d+\.\d+", version):
            facts["version"] = version
            rows.append((OK, "App version", f"`{version}` (runtime `{'.'.join(version.split('.')[:2])}`)"))
        else:
            rows.append((FAIL, "App version", "could not read `APP_VERSION` for CyberJudah in app.config.ts"))
        if build and build.isdigit():
            facts["build"] = build
            rows.append((OK, "iOS build number", f"`{build}`"))
        else:
            rows.append((FAIL, "iOS build number", "could not read `buildNumber` for CyberJudah in app.config.ts"))
        if found["android"]:
            rows.append((OK, "Android version code", f"`{found['android'].group(1)}` (the Play build sets a higher one itself)"))
        project = found["project"].group(1) if found["project"] else None
        if project == cfg["eas_project_id"]:
            rows.append((OK, "Expo project", f"`{project}`"))
        else:
            rows.append((FAIL, "Expo project", f"app.config.ts has `{project}`, expected `{cfg['eas_project_id']}`"))

    raw = read_file(repo, f"{app_dir}/eas.json", sha)
    try:
        eas = json.loads(raw) if raw is not None else None
    except ValueError as e:
        eas = None
        rows.append((FAIL, "eas.json", f"not valid JSON ({e})"))
    if raw is None:
        rows.append((FAIL, "eas.json", f"`{app_dir}/eas.json` not found"))
    if eas is None:
        return rows, facts

    source = (eas.get("cli") or {}).get("appVersionSource")
    facts["version_source"] = source or "local"
    profile_name = cfg["store_profile"]
    prof = resolve_profile(eas.get("build") or {}, profile_name)
    if prof is None:
        rows.append((FAIL, "Store profile", f"build profile `{profile_name}` missing (or its `extends` chain is broken)"))
        return rows, facts
    env = prof.get("env") or {}

    channel = prof.get("channel")
    rows.append((OK if channel == cfg["store_channel"] else FAIL, "Update channel",
                 f"`{channel}`" + ("" if channel == cfg["store_channel"] else f", expected `{cfg['store_channel']}`")))
    if env.get("EAS_BUILD_CHANNEL") not in (None, channel):
        rows.append((FAIL, "EAS_BUILD_CHANNEL", f"`{env.get('EAS_BUILD_CHANNEL')}` does not match the channel `{channel}`"))
    bundle = env.get("BUNDLE_IDENTIFIER")
    rows.append((OK if bundle == cfg["bundle_identifier"] else FAIL, "Bundle id",
                 f"`{bundle}`" + ("" if bundle == cfg["bundle_identifier"] else f", expected `{cfg['bundle_identifier']}`")))
    wrong = [f"`{k}`" for k, v in cfg.get("store_env_expected", {}).items() if str(env.get(k)) != v]
    rows.append((FAIL if wrong else OK, "Store settings",
                 ("not as expected: " + ", ".join(wrong)) if wrong else
                 ", ".join(f"`{k}={v}`" for k, v in cfg.get("store_env_expected", {}).items())))
    bad = sorted(k for k, v in env.items() if isinstance(v, str)
                 and any(w in v.lower() for w in cfg.get("store_env_forbidden", [])))
    rows.append((FAIL if bad else OK, "Servers",
                 ("staging or local address in " + ", ".join(f"`{k}`" for k in bad)) if bad
                 else "no staging or local address in the store profile"))
    if (prof.get("ios") or {}).get("simulator") or prof.get("developmentClient") or prof.get("distribution") == "internal":
        rows.append((FAIL, "Distribution", "the store profile builds a simulator, development or internal app"))

    plist_path = env.get("IOS_GOOGLE_SERVICES_FILE")
    if plist_path:
        rel = os.path.normpath(os.path.join(app_dir, plist_path)).replace(os.sep, "/")
        plist = read_file(repo, rel, sha)
        if plist is None:
            rows.append((FAIL, "Firebase (iOS)", f"`{rel}` not found"))
        else:
            m = re.search(r"<key>BUNDLE_ID</key>\s*<string>([^<]+)</string>", plist)
            pid = m.group(1) if m else None
            rows.append((OK if pid == cfg["bundle_identifier"] else FAIL, "Firebase (iOS)",
                         f"`{rel}` is for `{pid}`" + ("" if pid == cfg["bundle_identifier"] else f", expected `{cfg['bundle_identifier']}`")))

    asc = str((((eas.get("submit") or {}).get(profile_name) or {}).get("ios") or {}).get("ascAppId"))
    rows.append((OK if asc == cfg["asc_app_id"] else FAIL, "App Store Connect app",
                 f"`{asc}`" + ("" if asc == cfg["asc_app_id"] else f", expected `{cfg['asc_app_id']}`")))
    return rows, facts


def check_numbers(cfg, facts):
    """The next store upload needs a higher build number than any build already sent."""
    rows = []
    shipped = cfg.get("store_builds", [])
    if not shipped or "build" not in facts or "version" not in facts:
        return rows
    if facts.get("version_source") == "remote":
        rows.append((OK, "Next build number", "EAS sets it (`appVersionSource: remote`)"))
        return rows
    top = max(shipped, key=lambda b: int(b["build"]))
    top_version = max((b["version"] for b in shipped), key=version_tuple)
    if version_tuple(facts["version"]) < version_tuple(top_version):
        rows.append((FAIL, "Next version", f"`{facts['version']}` is lower than `{top_version}`, already sent to App Store Connect"))
    if int(facts["build"]) <= int(top["build"]):
        rows.append((WARN, "Next build number",
                     f"`{facts['build']}` is already used ({top['version']} ({top['build']}), {top['date']}). "
                     f"Raise `buildNumber` in app.config.ts to `{int(top['build']) + 1}` or higher before the next store build"))
    else:
        rows.append((OK, "Next build number", f"`{facts['build']}` is new (highest sent: `{top['build']}`)"))
    return rows


def check_head(cfg, sha):
    rows, problems = [], []
    repo = cfg["app_repo"]
    known = cfg.get("known_failing_checks", {})
    runs = C.gh("GET", f"/repos/{repo}/commits/{sha}/check-runs?per_page=100").get("check_runs", [])
    latest = {}
    for r in runs:  # one row per check name: the newest attempt
        if r["name"] not in latest or (r.get("started_at") or "") > (latest[r["name"]].get("started_at") or ""):
            latest[r["name"]] = r
    for name in sorted(latest):
        r = latest[name]
        result = r["conclusion"] or r["status"]
        if result in ("success", "skipped", "neutral"):
            state = OK
        elif result in ("queued", "in_progress", "waiting", "pending", "requested"):
            state = "🔄"
        elif name in known:
            state, result = WARN, f"{result} (known: {known[name]})"
        else:
            state = FAIL
            problems.append(f"check {name} {result} on the release branch")
        rows.append((state, name, f"[{result}]({r['html_url']})"))
    if not rows:
        rows.append((OK, "Checks", "none reported for this commit"))
    return rows, problems


def check_prs(cfg):
    lines = []
    repo, branch = cfg["app_repo"], cfg["release_branch"]
    prs = list(C.paged(f"/repos/{repo}/pulls?state=open&base={q(branch)}", limit=100))
    stale_h = int(cfg.get("stale_pr_hours", 48))
    for p in sorted(prs, key=lambda p: p["created_at"]):
        age = (C.NOW - C.ts(p["created_at"])).total_seconds() / 3600
        tag = "draft" if p.get("draft") else (f"ready, waiting {int(age)}h" if age > stale_h else "ready")
        lines.append(f"- [#{p['number']} {p['title']}]({p['html_url']}) ({tag})")
    return lines


def workflow_rows(cfg):
    rows = []
    repo = cfg["app_repo"]
    for wf in cfg.get("watch_workflows", []):
        qs = "per_page=10&exclude_pull_requests=true"
        if wf.get("branch"):
            qs += "&branch=" + q(wf["branch"])
        try:
            runs = C.gh("GET", f"/repos/{repo}/actions/workflows/{q(wf['file'])}/runs?{qs}").get("workflow_runs", [])
        except C.ApiError as e:
            rows.append(f"| {wf['name']} | could not read ({e.status}) | | |")
            continue
        if not runs:
            rows.append(f"| {wf['name']} | no runs yet | | |")
            continue
        r = runs[0]
        good = next((x for x in runs if x["conclusion"] == "success"), None)
        rows.append(f"| {wf['name']} | [#{r['run_number']}]({r['html_url']}) {C.ago(C.ts(r['created_at']))} "
                    f"| {r['conclusion'] or r['status']} "
                    f"| {('[' + C.ago(C.ts(good['created_at'])) + '](' + good['html_url'] + ')') if good else 'none in the last 10'} |")
    return rows


def changes_since(cfg, sha):
    shipped = [b for b in cfg.get("store_builds", []) if b.get("sha")]
    if not shipped:
        return []
    last = max(shipped, key=lambda b: int(b["build"]))
    if last["sha"] == sha:
        return [f"Nothing new: the release branch is still at {last['version']} ({last['build']})."]
    try:
        cmp = C.gh("GET", f"/repos/{cfg['app_repo']}/compare/{last['sha']}...{sha}")
    except C.ApiError as e:
        return [f"Could not compare with {last['version']} ({last['build']}): HTTP {e.status}"]
    titles = []
    for c in cmp.get("commits", []):
        msg = c["commit"]["message"]
        first = msg.splitlines()[0] if msg else ""
        m = re.match(r"Merge pull request #(\d+)", first)
        if m:  # a merged pull request: its title is the next non-empty line
            rest = [x for x in msg.splitlines()[1:] if x.strip()]
            titles.append(f"#{m.group(1)} {rest[0] if rest else ''}".rstrip())
    out = [f"{cmp.get('ahead_by', 0)} commit(s) since {last['version']} ({last['build']}):"]
    out += [f"- {t}" for t in titles[-20:]] or ["- (direct commits only)"]
    return out


# ---------------------------------------------------------------- report

def table(rows):
    out = ["| | Item | Detail |", "|---|---|---|"]
    out += [f"| {s} | {i} | {d} |" for s, i, d in rows]
    return out


def build_report(cfg):
    repo, branch = cfg["app_repo"], cfg["release_branch"]
    head = C.gh("GET", f"/repos/{repo}/commits/{q(branch)}")
    sha = head["sha"]
    problems, lines = [], []
    lines.append(f"_{C.NOW:%Y-%m-%d %H:%M} UTC. Release branch "
                 f"[`{branch}`]({C.SERVER}/{repo}/tree/{branch}) at "
                 f"[`{sha[:7]}`]({C.SERVER}/{repo}/commit/{sha})._\n")

    cfg_rows, facts = check_config(cfg, sha)
    num_rows = check_numbers(cfg, facts)
    lines.append("### Store build settings\n")
    lines += table(cfg_rows + num_rows)
    problems += [f"{i}: {d}" for s, i, d in cfg_rows + num_rows if s == FAIL]

    head_rows, head_problems = check_head(cfg, sha)
    problems += head_problems
    lines.append("\n### Checks on the release branch\n")
    lines += table(head_rows)

    lines.append("\n### Build workflows\n")
    lines.append("| Workflow | Latest run | Result | Last success |\n|---|---|---|---|")
    lines += workflow_rows(cfg)
    try:
        waiting = C.gh("GET", f"/repos/{repo}/actions/runs?status=waiting&per_page=20").get("workflow_runs", [])
    except C.ApiError:
        waiting = []
    if waiting:
        lines.append("\n**Waiting for Approve:** " + ", ".join(
            f"[{w['name']} #{w['run_number']}]({w['html_url']})" for w in waiting))
    lines.append("\nStore builds made on Expo's servers (EAS) are not visible here.")

    prs = check_prs(cfg)
    lines.append(f"\n### Pull requests into the release branch ({len(prs)} open)\n")
    lines += prs or ["None."]

    since = changes_since(cfg, sha)
    if since:
        lines.append("\n### In the next release\n")
        lines += since

    status = "🟢 Ready" if not problems else "🔴 Needs attention: " + "; ".join(problems)
    return f"## {status}\n\n" + "\n".join(lines), problems


def alert(problems):
    """While something is red, one Telegram message per run (daily). Nothing is sent when all is green.
    Never prints a token."""
    if not problems or not os.environ.get("ALERT_BOT_TOKEN"):
        return
    run = ""
    if os.environ.get("GITHUB_RUN_ID"):
        run = f"\n\n{C.SERVER}/{C.REPO}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    C.telegram("CyberJudah release watch: the app's release branch needs attention.\n\n"
               + "\n".join("• " + p for p in problems[:15]) + run)


def cmd_report(cfg, args):
    body, problems = build_report(cfg)
    C.summary(body)
    print(f"\n{len(problems)} problem(s).")
    if args.get("dry") is not True:
        alert(problems)
    return 0


def main():
    if not C.REPO or not C.TOKEN:
        sys.exit("GITHUB_REPOSITORY and GITHUB_TOKEN are required.")
    cfg = load_config()
    cmd = sys.argv[1] if len(sys.argv) > 1 else "report"
    args = {}
    for a in sys.argv[2:]:
        k, _, v = a.partition("=")
        args[k.lstrip("-")] = {"true": True, "false": False}.get(v, v)
    fn = {"report": cmd_report}.get(cmd)
    if not fn:
        sys.exit(f"Unknown task {cmd!r}")
    sys.exit(fn(cfg, args))


if __name__ == "__main__":
    main()
