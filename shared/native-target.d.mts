export type NativeEnvironment = "production" | "staging";
export type NativeTarget = Readonly<{ environment: NativeEnvironment; appId: string; appName: string; origin: string; syncScope: string; profile: "free-study" | "linked-ask-test"; paidAsk: boolean }>;
export function nativeTarget(environment?: string): NativeTarget;
export function nativeAccountURL(environment: string, code: string): string;
export function nativeRequestURL(source: string, localHref: string, environment: string): string | null;
