/**
 * Perry config for the diff viewer example.
 */
export default {
  name: 'hone-editor-diff-viewer-example',
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
