/**
 * Perry config for the minimal editor example.
 */
export default {
  name: 'hone-editor-minimal-example',
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
