/**
 * What Ask CyberJudah says while it works, chosen by the question. A question of doctrine, the
 * law, judgment, history or prophecy gets a serious line, drawn from the King James words the
 * assembly reads; a question about the app, or a short follow-up, gets a lighter one. The verse
 * each line comes from is noted beside it (checked against the KJV text). A line in "-ing" form
 * adapts the verse's own verb ("Search the scriptures" → "Searching the scriptures"), so lines are
 * never shown in quotation marks or with a reference. Nothing sacred is made light of: the humour
 * is only ever about the waiting. The real research steps (what is being searched or read) are shown as they happen; these lines
 * fill the time between them.
 */
export type Tone = "scripture" | "law" | "judgment" | "people" | "app" | "time" | "memory" | "light";

/** The lines, by tone, with the verse each is drawn from. */
export const SPINNER: Record<Tone, string[]> = {
  // Doctrine and the Scripture: serious.
  scripture: [
    "Rightly dividing the word of truth", // 2 Timothy 2:15
    "Laying precept upon precept", // Isaiah 28:10
    "Comparing spiritual things with spiritual", // 1 Corinthians 2:13
    "Searching the scriptures", // John 5:39
    "Searching the scriptures daily, whether those things were so", // Acts 17:11
    "Giving the sense", // Nehemiah 8:8
    "Causing them to understand the reading", // Nehemiah 8:8
    "Proving all things", // 1 Thessalonians 5:21
    "Line upon line", // Isaiah 28:10
    "Opening the scriptures", // Luke 24:32
    "Beginning at Moses and all the prophets", // Luke 24:27
    "Meditating day and night", // Psalms 1:2
    "Searching the deep things", // 1 Corinthians 2:10
    "Holding forth the word of life", // Philippians 2:16
    "Profitable for doctrine, for reproof, for correction", // 2 Timothy 3:16
    "Opening the eyes of understanding", // Ephesians 1:18
    "Beholding wondrous things out of the law", // Psalms 119:18
    "Seeking her as silver", // Proverbs 2:4
    "Searching as for hid treasures", // Proverbs 2:4
    "Asking where the place of understanding is", // Job 28:12
    "Getting wisdom; getting understanding", // Proverbs 4:7
    "Seeking out the wisdom of all the ancient", // Sirach 39:1
    "Bringing forth things new and old", // Matthew 13:52
    "Uttering dark sayings of old", // Psalms 78:2
  ],
  // The law, the statutes and the commandments: serious.
  law: [
    "Reading in the book of the law distinctly", // Nehemiah 8:8
    "Hearkening unto the statutes and unto the judgments", // Deuteronomy 4:1
    "Weighing the statutes and the judgments",
    "Opening the law handbook",
    "Keeping the commandments in view",
    "Holding fast that which is good", // 1 Thessalonians 5:21
    "Delighting in the law", // Psalms 1:2
    "Hearing the commandments of life", // Baruch 3:9
    "Teaching them diligently", // Deuteronomy 6:7
    "Writing them upon the posts", // Deuteronomy 6:9
    "Holy, and just, and good", // Romans 7:12
    "Not come to destroy, but to fulfil", // Matthew 5:17
    "Concerning the feasts of the Lord", // Leviticus 23:2
    "Remembering the sabbath day, to keep it holy", // Exodus 20:8
    "Keep therefore and do them", // Deuteronomy 4:6
    "Attentive unto the book of the law", // Nehemiah 8:3
  ],
  // Judgment, captivity, history and prophecy: solemn.
  judgment: [
    "Searching out a matter", // Proverbs 25:2
    "Reading the case studies",
    "Going back through the generations",
    "Weighing the judgments",
    "Here a little, and there a little", // Isaiah 28:10
    "Remembering the days of old", // Deuteronomy 32:7
    "Considering the years of many generations", // Deuteronomy 32:7
    "Asking for the old paths", // Jeremiah 6:16
    "Weighed in the balances", // Daniel 5:27
    "By the rivers of Babylon", // Psalms 137:1
    "Remembering Zion", // Psalms 137:1
    "Scattered from the one end of the earth even unto the other", // Deuteronomy 28:64
    "Until the reign of the kingdom of Persia", // 2 Chronicles 36:20
    "From the four corners of the earth", // Isaiah 11:12
    "Assembling the outcasts of Israel", // Isaiah 11:12
    "Can these bones live?", // Ezekiel 37:3
    "Raising up the former desolations", // Isaiah 61:4
    "Bringing again the captivity", // Jeremiah 30:3; Amos 9:14
    "Building the old waste places", // Isaiah 58:12
    "Even to the time of the end", // Daniel 12:4
    "Revealing the secret unto the prophets", // Amos 3:7
  ],
  // People and names: steady, with a little warmth.
  people: [
    "Tracing the generations",
    "Reading through the begats",
    "Looking up the family line",
    "Finding where the name is first read",
    "Reading the book of the generations", // Genesis 5:1
    "Counting fourteen generations", // Matthew 1:17
    "From Abraham to David", // Matthew 1:17
    "Every man by his own standard", // Numbers 2:2
    "With the ensign of their father's house", // Numbers 2:2
    "To the twelve tribes scattered abroad", // James 1:1
    "Asking thy father, and he will shew thee", // Deuteronomy 32:7
  ],
  // Questions about the app: light.
  app: [
    "Asking, seeking, knocking", // Matthew 7:7
    "Making it plain", // Habakkuk 2:2
    "Iron sharpening iron", // Proverbs 27:17
    "Turning the right page",
    "Knocking on the right door", // Matthew 7:7
    "Finding the place where it was written", // Luke 4:17
    "Opening the door", // Revelation 3:20
    "Setting in order the things that are wanting", // Titus 1:5
    "Decently and in order", // 1 Corinthians 14:40
    "Making straight paths", // Hebrews 12:13
    "This is the way, walk ye in it", // Isaiah 30:21
    "Where is the good way?", // Jeremiah 6:16
  ],
  // Reminders, the reading plan, the Sabbath's time: light, about time.
  time: [
    "Redeeming the time", // Ephesians 5:16
    "Numbering our days", // Psalms 90:12
    "A time to every purpose", // Ecclesiastes 3:1
    "To every thing there is a season", // Ecclesiastes 3:1
    "Seeking early", // Proverbs 8:17
    "From the morning until midday", // Nehemiah 8:3
    "When thou liest down, and when thou risest up", // Deuteronomy 6:7
    "Remembering the sabbath day", // Exodus 20:8
  ],
  // The reader's own earlier chats: warm.
  memory: [
    "Remembering the former things", // Isaiah 46:9
    "Pondering these things", // Luke 2:19
    "Keeping all these things", // Luke 2:19
    "Gathering up the fragments, that nothing be lost", // John 6:12
    "Hid in mine heart", // Psalms 119:11
    "Bringing forth things new and old", // Matthew 13:52
  ],
  // A short follow-up, a greeting, a long wait: gentle humour about the waiting.
  light: [
    "Here a little, and there a little", // Isaiah 28:10
    "Line upon line, line upon line", // Isaiah 28:10
    "Of making many books there is no end", // Ecclesiastes 12:12
    "Much study, no weariness yet", // a play on Ecclesiastes 12:12
    "Running to and fro; knowledge shall be increased", // Daniel 12:4
    "Letting patience have her perfect work", // James 1:4
    "In your patience possess ye your souls", // Luke 21:19
    "Running, and not weary", // Isaiah 40:31
    "Mounting up with wings as eagles", // Isaiah 40:31
    "Sitting down first, and counting the cost", // Luke 14:28
    "Reading three or four leaves", // Jeremiah 36:23
    "Written plain, that he may run that readeth it", // Habakkuk 2:2
    "Taking heed how ye hear", // Luke 8:18
    "Understandest thou what thou readest?", // Acts 8:30
  ],
};

const has = (q: string, re: RegExp) => re.test(q);
/** The question's tone, from its words. Doctrine is the default: when in doubt, serious. */
export function toneOf(question: string): Tone {
  const q = question.toLowerCase();
  if (has(q, /\b(saved chats?|my chats?|ask(ed)? (you )?(before|earlier|last)|did i ask|last time|earlier (question|chat)|previous (question|chat)|conversation history)\b/)) return "memory";
  if (has(q, /\b(remind(er)?s?|reading plan|plan|schedule|what time|when does (the )?sabbath|sunset|daily reading|every (day|morning|night))\b/)) return "time";
  if (has(q, /\b(app|screen|button|settings?|notification|bookmark|highlight|tab|download|offline|font|theme|dark mode|how do i|where (is|do i|can i))\b/)) return "app";
  if (has(q, /\b(law|laws|statutes?|commandments?|ordinances?|usury|unclean|clean meats?|tithes?|sabbath day|feasts? days?)\b/)) return "law";
  if (has(q, /\b(judg(e?ment|ed)|curse[ds]?|captivity|plagues?|wrath|destroy(ed)?|punish(ment|ed)?|prophec(y|ies)|history|empire|nations?|edom|esau|scattered|slavery|babylon|persia|rome|end of days|last days)\b/)) return "judgment";
  if (has(q, /\b(who (was|were|is)|genealog(y|ies)|begat|sons? of|daughters? of|tribes?|father of|mother of|lineage|family)\b/)) return "people";
  if (q.trim().split(/\s+/).length <= 3) return "light";
  return "scripture";
}

/** The line for this moment: a new one every few seconds, starting at a different one each question. */
export function spinnerLine(question: string, tick: number): string {
  const lines = SPINNER[toneOf(question)];
  let seed = 0;
  for (const c of question) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  return lines[(seed + tick) % lines.length];
}
