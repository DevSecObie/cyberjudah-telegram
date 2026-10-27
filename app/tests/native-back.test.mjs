import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('native Back delegates open sheets and nested reader history, and minimizes only at Home', async () => {
  const source = new URL('../src/native/NativeLifecycle.tsx', import.meta.url).pathname;
  const output = await build({ entryPoints: [source], bundle: true, format: 'esm', write: false, plugins: [{ name: 'native-back-fixture', setup(b) {
    b.onResolve({ filter: /^(react|react-router|@capacitor\/app|@\/tg\/hooks|\.\/platform)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: ({
      react: 'export const useEffect = fn => { globalThis.__back.cleanup = fn(); };',
      'react-router': 'export const useNavigate = () => (...args) => globalThis.__back.navigation.push(args); export const useLocation = () => ({ pathname: globalThis.__back.path });',
      './platform': 'export const native = true;',
      '@/tg/hooks': 'export const topOpenSheet = () => globalThis.__back.sheet; export const goBack = () => { globalThis.__back.delegated++; return globalThis.__back.handled; };',
      '@capacitor/app': 'export const App = { addListener: async (_name, fn) => { globalThis.__back.press = fn; return { remove: async () => {} }; }, minimizeApp: () => { globalThis.__back.minimized++; } };',
    })[path] }));
  } }] });
  const { NativeLifecycle } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
  try {
    for (const scenario of [
      { path: '/', sheet: true, handled: true, delegated: 1, minimized: 0 },
      { path: '/read/john/3', sheet: false, handled: true, delegated: 1, minimized: 0 },
      { path: '/', sheet: false, handled: true, delegated: 0, minimized: 1 },
    ]) {
      globalThis.__back = { ...scenario, delegated: 0, minimized: 0, navigation: [] };
      NativeLifecycle(); await new Promise(resolve => setImmediate(resolve));
      globalThis.__back.press({ canGoBack: true });
      assert.equal(globalThis.__back.delegated, scenario.delegated);
      assert.equal(globalThis.__back.minimized, scenario.minimized);
      assert.deepEqual(globalThis.__back.navigation, []);
      globalThis.__back.cleanup();
    }
  } finally { delete globalThis.__back; }
});
