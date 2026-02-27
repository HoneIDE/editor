/**
 * Theme system: color tokens, font settings, resolved colors for all UI elements.
 */

export interface TokenThemeMapping {
  keyword: string;
  string: string;
  comment: string;
  variableName: string;
  typeName: string;
  functionName: string;
  number: string;
  operator: string;
  punctuation: string;
  regexp: string;
  tagName: string;
  attributeName: string;
  attributeValue: string;
  heading: string;
  link: string;
  meta: string;
  builtin: string;
  atom: string;
  bool: string;
  special: string;
  definition: string;
  property: string;
  namespace: string;
  className: string;
  labelName: string;
  macroName: string;
  literal: string;
  inserted: string;
  deleted: string;
  changed: string;
  invalid: string;
}

export interface EditorTheme {
  // Editor chrome
  background: string;
  foreground: string;
  selectionBackground: string;
  cursorColor: string;
  lineHighlight: string;
  gutterBackground: string;
  gutterForeground: string;

  // Syntax token colors
  tokens: TokenThemeMapping;

  // Diff colors
  diffAddedBackground: string;
  diffDeletedBackground: string;
  diffModifiedBackground: string;

  // Diagnostic colors
  errorForeground: string;
  warningForeground: string;
  infoForeground: string;

  // AI colors
  ghostTextForeground: string;
  aiAnnotationBackground: string;

  // Font settings
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number; // multiplier
  letterSpacing: number; // pixels
}

/** Dark theme (default, similar to One Dark Pro). */
export const DARK_THEME: EditorTheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  selectionBackground: '#264f78',
  cursorColor: '#aeafad',
  lineHighlight: '#2a2d2e',
  gutterBackground: '#1e1e1e',
  gutterForeground: '#858585',

  tokens: {
    keyword: '#569cd6',
    string: '#ce9178',
    comment: '#6a9955',
    variableName: '#9cdcfe',
    typeName: '#4ec9b0',
    functionName: '#dcdcaa',
    number: '#b5cea8',
    operator: '#d4d4d4',
    punctuation: '#d4d4d4',
    regexp: '#d16969',
    tagName: '#569cd6',
    attributeName: '#9cdcfe',
    attributeValue: '#ce9178',
    heading: '#569cd6',
    link: '#3794ff',
    meta: '#569cd6',
    builtin: '#4ec9b0',
    atom: '#569cd6',
    bool: '#569cd6',
    special: '#d7ba7d',
    definition: '#dcdcaa',
    property: '#9cdcfe',
    namespace: '#4ec9b0',
    className: '#4ec9b0',
    labelName: '#c586c0',
    macroName: '#dcdcaa',
    literal: '#ce9178',
    inserted: '#b5cea8',
    deleted: '#ce9178',
    changed: '#569cd6',
    invalid: '#f44747',
  },

  diffAddedBackground: '#2ea04333',
  diffDeletedBackground: '#f8514933',
  diffModifiedBackground: '#0078d433',

  errorForeground: '#f44747',
  warningForeground: '#cca700',
  infoForeground: '#3794ff',

  ghostTextForeground: '#6e7681',
  aiAnnotationBackground: '#1a3a5c',

  fontFamily: 'JetBrains Mono',
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: 0,
};

/** Light theme (similar to GitHub Light). */
export const LIGHT_THEME: EditorTheme = {
  background: '#ffffff',
  foreground: '#24292e',
  selectionBackground: '#0366d625',
  cursorColor: '#24292e',
  lineHighlight: '#f6f8fa',
  gutterBackground: '#ffffff',
  gutterForeground: '#959da5',

  tokens: {
    keyword: '#d73a49',
    string: '#032f62',
    comment: '#6a737d',
    variableName: '#24292e',
    typeName: '#6f42c1',
    functionName: '#6f42c1',
    number: '#005cc5',
    operator: '#24292e',
    punctuation: '#24292e',
    regexp: '#032f62',
    tagName: '#22863a',
    attributeName: '#6f42c1',
    attributeValue: '#032f62',
    heading: '#005cc5',
    link: '#0366d6',
    meta: '#d73a49',
    builtin: '#005cc5',
    atom: '#005cc5',
    bool: '#005cc5',
    special: '#e36209',
    definition: '#6f42c1',
    property: '#005cc5',
    namespace: '#6f42c1',
    className: '#6f42c1',
    labelName: '#d73a49',
    macroName: '#6f42c1',
    literal: '#032f62',
    inserted: '#22863a',
    deleted: '#d73a49',
    changed: '#005cc5',
    invalid: '#cb2431',
  },

  diffAddedBackground: '#e6ffed',
  diffDeletedBackground: '#ffeef0',
  diffModifiedBackground: '#dbedff',

  errorForeground: '#cb2431',
  warningForeground: '#e36209',
  infoForeground: '#0366d6',

  ghostTextForeground: '#959da5',
  aiAnnotationBackground: '#dbedff',

  fontFamily: 'JetBrains Mono',
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: 0,
};
