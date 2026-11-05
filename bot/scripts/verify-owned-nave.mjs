import assert from 'node:assert/strict';

const base = new URL(process.argv[2]);
async function get(path, expected = 200) {
  const response = await fetch(new URL(path, base), { redirect: 'error', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, expected, path);
  assert.equal(response.headers.get('x-cyberjudah-reference-hosting'), 'self-hosted', path);
  return response.json();
}

for (const [language, revision, faith] of [
  ['en', 'nave-en-a3ca283196d0eb084276', 'Faith'],
  ['fr', 'nave-fr-358b8cf8a5e5f48554de', 'La foi'],
]) {
  const topic = await get(language + '/topics/faith');
  assert.equal(topic.resource.revision, revision);
  assert.equal(topic.topic.name, faith);
  assert.ok(topic.topic.description.length > 100);
  const verse = await get(language + '/verses/58-11-1/topics');
  assert.equal(verse.verseKey, '58-11-1');
  assert.ok(verse.verseTopics.some(item => item.name === faith));
  const page = await get(language + '/topics?initial=a&limit=3');
  assert.equal(page.topics.length, 3);
  assert.ok(page.nextCursor);
  const next = await get(language + '/topics?initial=a&limit=3&cursor=' + encodeURIComponent(page.nextCursor));
  assert.equal(next.topics.length, 3);
  assert.equal(new Set([...page.topics, ...next.topics].map(item => item.normalizedName)).size, 6);
  const search = await get(language + '/topics?search=' + (language === 'fr' ? 'foi' : 'faith') + '&limit=20');
  assert.ok(search.topics.some(item => item.normalizedName === 'faith'));
  const random = await get(language + '/random');
  assert.equal(random.resource.revision, revision);
  await get(language + '/topics/no-such-nave-verification-topic', 404);
  console.log(language, revision, verse.verseTopics.map(item => item.name).join(', '));
}
