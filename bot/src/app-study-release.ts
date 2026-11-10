/** Versioned serving policy, not a trained-weight registry. Provider-managed model
 * revisions are outside this repository; any new model needs evaluation before promotion. */
export const APP_STUDY_RELEASE = {
  version: 'teacher-grounded-study-v6-thorough',
  trainingEnabled: false,
  approvedModels: ['@cf/moonshotai/kimi-k2.6', '@cf/google/gemma-4-26b-a4b-it', '@cf/deepseek-ai/deepseek-v4-flash-0731'],
  uiContract: 'study-v1',
  maxSupplementarySearches: 6,
  maxEvidenceSources: 24,
  maxDisplayedSources: 12,
  privateDataToolsEnabled: false,
  purchaseToolsEnabled: false,
} as const;
