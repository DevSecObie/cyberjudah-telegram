/** Public CyberJudah content used by the Bible Strong fork. No account data. */
export type StrongTeaching = {
  kind: "class" | "captains" | "history";
  url: string;
  title: string;
  date: string;
  teacher: string;
  thumb: string;
  video?: string;
  pending?: boolean;
  broadcastAt?: string;
  label: string;
  sub?: string;
};

export type StrongTeachings = {
  teachings: StrongTeaching[];
  feedOk: boolean;
  unavailable: string[];
};
