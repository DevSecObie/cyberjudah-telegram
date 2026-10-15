require('./scripts/generate-theme-css.cjs')
// CyberJudah web build: start-up loads only what the root layout needs (scripts/web-chunking.cjs).
require('./scripts/web-chunking.cjs').installWebChunking()
const { getSentryExpoConfig } = require('@sentry/react-native/metro')

const { withUniwindConfig } = require('uniwind/metro')

const config = getSentryExpoConfig(__dirname)

config.resolver = {
  ...config.resolver,
  assetExts: [
    ...config.resolver.assetExts,
    'db',
    'sqlite',
    'mp3',
    'ttf',
    'otf',
    'png',
    'jpg',
    'jpeg',
    'json',
    'txt',
    'html',
    'lottie',
  ],
}

// CyberJudah web build: one copy of each package the app and strong/packages share.
require('./scripts/web-chunking.cjs').dedupeWorkspacePackages(config, __dirname)

config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      inlineRequires: true,
    },
  }),
}

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './src/uniwind-types.d.ts',
  extraThemes: ['default', 'sepia', 'nature', 'sunset', 'black', 'mauve', 'night'],
})
