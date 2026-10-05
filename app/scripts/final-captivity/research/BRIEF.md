# Research brief: The Final Captivity (a Timeline age)

You are researching one subperiod of a new Timeline age, "The Final Captivity", for the
CyberJudah app (the teaching of Israel United in Christ, IUIC). Read first, completely:
- SCHEMA AND RULES: <scratch>/tg-timeline/app/scripts/final-captivity/README.md
- PERIODS: .../tg-timeline/app/scripts/final-captivity/periods.json
- IUIC's own history page, already fetched as text: app/scripts/final-captivity/research/iuic/history.txt (and the other .txt files there)
- The coverage scan: .../scratchpad/fc/coverage.json (subjects, counts, the recordings that mention each most)

## Tools (all under app/scripts/final-captivity/research)
- `python3 tsearch.py find '<regex>' [--feed classes|history] [--n 20] [--ctx 400] [--title '<regex>']`
  searches all 7,446 class and Our Hidden History transcripts (lower-cased auto-captions). Each hit
  gives date, feed, video id, the timestamp and https://youtu.be/<id>?t=<seconds>.
  Each run takes ~20-40 s: make each regex count (alternations), don't loop over many tiny searches.
- `python3 tsearch.py read <videoId> <m:ss|h:mm:ss> --len 4000` reads the transcript from that moment.
  ALWAYS read the moment before you cite it, and read enough to know what was actually taught.
- `python3 wb.py <url> [--grep '<regex>'] [--max 20000]` reads a web page as text. Most sites are
  reachable directly (Wikipedia, archives.gov, loc.gov, nps.gov, slavevoyages.org, gutenberg.org,
  nypl.org, blackpast.org, encyclopediavirginia.org, archive.org, israelunite.org); sites that refuse
  (Britannica, si.edu) are read through their Wayback snapshot, and the script prints the URL it read
  ("READ …"): when that is a web.archive.org snapshot put it in the source's `via`. Prefer primary and
  institutional sources; Wikipedia is acceptable as a secondary source. archive.org full-text books:
  https://archive.org/advancedsearch.php?q=...&fl[]=identifier&output=json, then
  https://archive.org/stream/<id>/<id>_djvu.txt with --grep.
- TranscriptAPI connector (load with ToolSearch "select:mcp__transcriptAPI__get_video_metadata"):
  `get_video_metadata` gives a video's exact publish date and description (1 credit each). Use it
  only for a recording you cite whose date is missing in the transcript (tsearch prints the date,
  or nothing). Free: `get_youtube_video_info` (title/channel only) and `get_channel_latest_videos`.
- The KJV text: /home/user/cyberjudah/data/bible/<book slug>.json, chapters["<n>"][verse-1]. Check every scripture ref exists.

## What to produce
Write ONE JSON file (path given below) of the form
{ "period": "<id>", "events": [ ...published-candidate events... ], "drafts": [ ...events that lack support, with a "needs": "..." field... ],
  "ledger": [ { "kind": "class|history|site|web|book", "ref": "<video id or URL>", "title": "...", "status": "reviewed|inaccessible|unreviewed", "note": "what it gave or why not", "events": ["slug", ...] } ],
  "gaps": [ "subjects in this period the corpus teaches but you could not finish, or that need the owner's decision" ] }
Each event exactly in the README's shape (status "published" for events, "draft" for drafts).
Aim for 12-20 well-supported events across the period's required categories, chronological. Quality over count.

## Hard rules (the owner was explicit)
0. Israel United in Christ: only its leaders and the organization (founding, leaders, schools/camps, publications, broadcasts, missions at home and overseas, ministries). Never record outside characterisations of IUIC (designations, labels, accusations by critics, former members or third parties): not as events, not as disagreements, not as sources.
1. Every published event has (a) at least one teaching moment you READ in a transcript, with the
   exact video id, title, date, `ts` (m:ss or h:mm:ss, where that teaching begins) and url
   https://youtu.be/<id>?t=<seconds>; and (b) at least one documented historical source you READ.
   Missing either → it goes to "drafts" with "needs".
2. Never invent: no quotation, casualty figure, date, citation or connection that is not in what you
   read. Every number in `account` must appear in a cited source. `quote` must be words that are
   actually in the transcript at that moment, copied exactly (they are lower-case captions; you may
   fix only capitalisation and add punctuation; never change or add words; drop caption noise only
   at the ends). Prefer `points` (the class's meaning, said plainly) and use `quote` sparingly.
3. Three kinds of statement, never mixed: `summary`/`account` = documented history only, from the
   sources; `teaching` = what the class taught, attributed to its recording (write it plainly in the
   class's sense, e.g. "The slave trade began in 1441, not 1619: …"; never "the teacher says");
   `scriptures` = the verses the class read or cited with it at that moment, and how the class
   applied them. Do not add scriptures the class did not use.
4. Where the class and the documented sources differ (a date, a figure, a claim), record BOTH in
   `disagreements` plainly and neutrally. Do not correct the teaching and do not drop it.
5. `teacher`: only when the recording names who is teaching at that moment (e.g. "Bishop Nathanyel",
   "Deacon Malachi", "Captain ..."); otherwise leave it out. Bishops' and Deacons' teaching first.
6. Keep the class's strong language as said. Leave out bleeped words ("[ __ ]").
7. Dates: `start`/`end` integer years inside the period's startYear..endYear; `date.text` as precise
   as the sources allow; `precision` honest; anything unsure in `uncertainty`.
8. No images (leave `image` out); list image ideas (public-domain archival items with their source
   page) in "gaps" as "image: ...".
9. Do not edit any file except your output file. Do not run git. Work in plain Python/Bash.
10. Valid JSON (check with python -m json.tool). Then report back briefly: counts, and anything the
    owner must decide.
