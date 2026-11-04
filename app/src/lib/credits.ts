/**
 * Every outside source CyberJudah uses, with the credit its licence asks for. The Credits screen
 * (/settings/credits, also /credits) shows them; the iPhone and Android app links to the same page.
 * Add a source here in the same change that starts using it.
 */
export type Credit = {
  name: string;
  by?: string;
  license: string;
  licenseUrl?: string;
  source?: string;
  /** What CyberJudah changed, where the licence asks for it to be said. */
  changes?: string;
};

export type CreditGroup = { title: string; note?: string; items: Credit[] };

const GPL = "https://www.gnu.org/licenses/gpl-3.0.html";
const CC_BY_SA_4 = "https://creativecommons.org/licenses/by-sa/4.0/";
const OFL = "https://openfontlicense.org/open-font-license-official-text/";

export const CREDIT_GROUPS: CreditGroup[] = [
  {
    title: "Built on Bible Strong",
    note: "CyberJudah's iPhone, Android and web app, and parts of this app's Bible reader and Timeline, are built on Bible Strong, free software by Stéphane Montlouis-Calixte. CyberJudah has changed it since September 2026. Under its licence you may have the source code of CyberJudah's versions, and change and share them under the same licence.",
    items: [
      { name: "Bible Strong", by: "Stéphane Montlouis-Calixte, Le Studio 316", license: "GNU GPL v3", licenseUrl: GPL, source: "https://github.com/smontlouis/bible-strong" },
      { name: "CyberJudah app source code", by: "CyberJudah", license: "GNU GPL v3", licenseUrl: GPL, source: "https://github.com/DevSecObie/cyberjudah-app" },
      { name: "CyberJudah Telegram and server source code", by: "CyberJudah", license: "GNU GPL v3", licenseUrl: GPL, source: "https://github.com/DevSecObie/cyberjudah-telegram" },
    ],
  },
  {
    title: "Scripture",
    items: [
      { name: "King James Version with the Apocrypha", license: "Public domain (Crown rights in the United Kingdom)", source: "https://github.com/DevSecObie/cyberjudah/tree/main/data/bible" },
      { name: "Strong's numbers in the King James text", by: "James Strong, Exhaustive Concordance of the Bible (1890); tagged text from github.com/kaiserlik/kjv", license: "Public domain", source: "https://github.com/kaiserlik/kjv" },
      { name: "Strong's Hebrew and Greek dictionaries (1894)", by: "James Strong; JSON edition by Open Scriptures", license: "CC BY-SA (Open Scriptures)", source: "https://github.com/openscriptures/strongs", changes: "Where a definition calls the land of Israel \"Palestine\", it says \"Canaan\"." },
      { name: "Swete's Septuagint (1909–1930), the Greek of the Apocrypha", by: "Henry Barclay Swete; digital text by Eliran Wong", license: "Public domain; digital text GNU GPL v3", licenseUrl: GPL, source: "https://github.com/eliranwong/LXX-Swete-1930" },
      { name: "Cross references", by: "OpenBible.info", license: "CC BY (OpenBible.info)", source: "https://www.openbible.info/labs/cross-references/", changes: "Up to twelve references a verse, in Bible order." },
    ],
  },
  {
    title: "Reference Works",
    note: "Reference works, not the classes' teaching.",
    items: [
      { name: "Dictionary and Nave's Topical Bible entries", by: "Supplied by Bible Strong's reference service", license: "Public-domain texts", source: "https://bible-strong.app" },
      { name: "Translation Words", by: "unfoldingWord, through Bible Strong's reference service", license: "CC BY-SA 4.0", licenseUrl: CC_BY_SA_4, source: "https://www.unfoldingword.org/" },
      { name: "Easton's Bible Dictionary (1897)", by: "Matthew George Easton", license: "Public domain" },
      { name: "The Jewish Encyclopedia (1901–1906)", by: "Isidore Singer, editor; from CyberJudah's own scans", license: "Public domain" },
      { name: "Who's Who in the Bible", by: "Joan Comay and Ronald Brownrigg", license: "Only its kings' reign dates are used, on the Timeline" },
    ],
  },
  {
    title: "Classes and Timeline",
    items: [
      { name: "The classes", by: "Every class belongs to the teacher who taught it. Videos play from the original uploads on YouTube.", license: "The teachers' own" },
      { name: "Captivity packets", by: "Nathanyel Ben Israel", license: "Cited on each captivity period, with its page" },
      { name: "Timeline layout and events", by: "Bible Strong", license: "GNU GPL v3", licenseUrl: GPL },
      { name: "Timeline pictures", license: "Each picture's source and licence is given in its period's text" },
    ],
  },
  {
    title: "Typefaces",
    note: "Served with the app.",
    items: [
      { name: "Literata", by: "TypeTogether", license: "SIL Open Font License 1.1", licenseUrl: OFL },
      { name: "Newsreader", by: "Production Type", license: "SIL Open Font License 1.1", licenseUrl: OFL },
      { name: "Plus Jakarta Sans", by: "Tokotype", license: "SIL Open Font License 1.1", licenseUrl: OFL },
      { name: "JetBrains Mono", by: "JetBrains", license: "SIL Open Font License 1.1", licenseUrl: OFL },
      { name: "Inter (iPhone and Android app)", by: "Rasmus Andersson", license: "SIL Open Font License 1.1", licenseUrl: OFL },
      { name: "Fira Code (iPhone and Android app)", by: "Nikita Prokopov", license: "SIL Open Font License 1.1", licenseUrl: OFL },
    ],
  },
  {
    title: "Software",
    note: "Open-source software CyberJudah runs on. Each package's licence and copyright notice ships in the source code linked above.",
    items: [
      { name: "React and React Native", by: "Meta Platforms", license: "MIT", licenseUrl: "https://opensource.org/license/mit" },
      { name: "Expo", by: "650 Industries", license: "MIT", licenseUrl: "https://opensource.org/license/mit" },
      { name: "Feather icons", by: "Cole Bemis", license: "MIT", licenseUrl: "https://opensource.org/license/mit" },
      { name: "Lucide icons", by: "Lucide contributors", license: "ISC", licenseUrl: "https://opensource.org/license/isc-license-txt" },
      { name: "Lottie", by: "Airbnb", license: "Apache 2.0", licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0" },
    ],
  },
];
