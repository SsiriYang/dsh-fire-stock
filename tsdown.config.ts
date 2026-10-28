// 客户端 bundle 构建：复刻官方 clientConfig 的闭包工厂输出格式。
// 产物 lib/client.js = window.__ModuleLoader__.load({ id, factory: (require) => {...} })。
const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
]

export default {
  name: 'dsh-stock-assistant/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  deps: {
    neverBundle: (specifier) => EXTERNALS.includes(specifier),
    alwaysBundle: (specifier) => !EXTERNALS.includes(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-stock-assistant", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
