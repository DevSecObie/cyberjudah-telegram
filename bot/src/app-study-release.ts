/** Versioned serving policy, not a trained-weight registry. Provider-managed model
 * revisions are outside this repository; any new model needs evaluation before promotion. */
export const APP_STUDY_RELEASE = {
  version: 'teacher-grounded-study-v2',
  trainingEnabled: false,
  approvedModels: ['@cf/meta/llama-3.1-8b-instruct-fp8'],
  uiContract: 'study-v1',
  maxSupplementarySearches: 4,
  maxEvidenceSources: 24,
  maxDisplayedSources: 12,
  privateDataToolsEnabled: false,
  purchaseToolsEnabled: false,
} as const;
