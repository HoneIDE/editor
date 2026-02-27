/**
 * Perry config for the markdown editor example.
 */
export default {
  name: 'hone-editor-markdown-example',
  entry: 'main.ts',
  perry: '0.2.162',
  targets: {
    macos: {
      ffi: '../../native/macos/',
    },
  },
  dev: {
    defaultTarget: 'macos',
    hotReload: true,
  },
};
