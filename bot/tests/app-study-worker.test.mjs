import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const { outputFiles } = await build({
  stdin: {
    contents: `import { getAppStudyPrompt, validateStudyProgram } from './src/app-study-ui.ts';
      export default { fetch() {
        const checked = validateStudyProgram('root = StudyAnswer([Teaching("A sourced statement.", [1])])',
          [{ n: 1, kind: 'spoken', evidence: 'teaching', title: 'Lesson', text: 'A sourced statement.', url: '/classes/test' }]);
        return Response.json({ promptReady: getAppStudyPrompt().includes('RelatedScriptures'), ...checked });
      } };`,
    resolveDir: new URL('..', import.meta.url).pathname,
  },
  bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'error',
});

test('the OpenUI route starts and validates an answer inside the actual Workers runtime', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: outputFiles[0].text, compatibilityDate: '2025-05-01',
    outboundService: () => new Response(null, { status: 204 }),
  }));
  try {
    for (let request = 0; request < 2; request++) {
      const response = await mf.dispatchFetch('https://cyberjudah.test/study');
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.promptReady, true);
      assert.equal(result.teachingFound, true);
      assert.match(result.program, /Teaching/);
      assert.deepEqual(result.sources.map(source => source.n), [1]);
    }
  } finally { await mf.dispose(); }
});
