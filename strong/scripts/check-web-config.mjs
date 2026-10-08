import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const [directory, expectedProject] = process.argv.slice(2)
if (!directory || !expectedProject) throw new Error('Usage: check-web-config.mjs <dist> <Firebase project>')
const scripts = resolve(directory, '_expo/static/js/web')
const entries = (await readdir(scripts)).filter(name => /^entry-.*\.js$/.test(name))
if (entries.length !== 1) throw new Error('Expected one exported app entry')
const source = await readFile(resolve(scripts, entries[0]), 'utf8')
// The config validator also contains the key-to-option mapping ('projectId').
const projects = [...source.matchAll(/EXPO_PUBLIC_FIREBASE_PROJECT_ID\s*:\s*["']([^"']+)["']/g)].map(match => match[1]).filter(value => value !== 'projectId')
if (projects.length !== 1 || projects[0] !== expectedProject) {
  throw new Error('The exported Firebase project does not match this build; clear the Expo cache')
}
if (/preview-only|preview\.invalid|cyberjudah-preview/.test(source)) {
  throw new Error('Preview settings leaked into the exported app; clear the Expo cache')
}
console.log(`Verified exported Firebase project: ${expectedProject}`)
