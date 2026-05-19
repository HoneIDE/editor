/**
 * Scope-string → theme-color resolver.
 *
 * Operates on TextMate-style scope strings (e.g. `entity.name.function`)
 * produced by the Rust tokenizer / tree-sitter bridge. No Lezer dependency
 * — safe for every Perry target including web.
 *
 * For Lezer Tag-object resolution (used by the optional Lezer SyntaxEngine
 * pulled in only by tsc consumers), see `tag-theme.ts`.
 */

import type { EditorTheme } from '../../view-model/theme';

/**
 * Resolve a TextMate-style scope string (e.g. `entity.name.function`) to a theme color.
 *
 * Used by the tree-sitter engine (SHIP-V1-GAPS.md #18). Scope strings are
 * dot-separated, most-general-first per TextMate convention — we match the
 * longest known prefix and fall back to the theme's foreground.
 *
 * Phase 1 follow-up: derive the full mapping from the theme's `tokenColors`
 * array (which 15 themes already ship) instead of this hand-rolled table.
 */
export function resolveTokenScope(theme: EditorTheme, scope: string): string {
  if (scope.length === 0) return theme.foreground;
  const t = theme.tokens;

  // Comment / string / number / regexp — single-segment matches.
  if (startsWith(scope, 'comment')) return t.comment;
  if (startsWith(scope, 'string.regexp')) return t.regexp;
  if (startsWith(scope, 'string')) return t.string;
  if (startsWith(scope, 'constant.numeric')) return t.number;
  if (startsWith(scope, 'constant.language')) return t.atom;
  if (startsWith(scope, 'constant.character.escape')) return t.special;
  if (startsWith(scope, 'constant')) return t.literal;

  // Keywords + storage + control flow.
  if (startsWith(scope, 'keyword.control')) return t.keyword;
  if (startsWith(scope, 'keyword.operator')) return t.operator;
  if (startsWith(scope, 'keyword')) return t.keyword;
  if (startsWith(scope, 'storage.modifier')) return t.keyword;
  if (startsWith(scope, 'storage.type')) return t.keyword;
  if (startsWith(scope, 'storage')) return t.keyword;

  // Functions / methods / classes / types.
  if (startsWith(scope, 'entity.name.function.call')) return t.functionName;
  if (startsWith(scope, 'entity.name.function')) return t.functionName;
  if (startsWith(scope, 'entity.name.method')) return t.functionName;
  if (startsWith(scope, 'entity.name.class')) return t.className;
  if (startsWith(scope, 'entity.name.type')) return t.typeName;
  if (startsWith(scope, 'entity.name.namespace')) return t.namespace;
  if (startsWith(scope, 'entity.name.tag')) return t.tagName;
  if (startsWith(scope, 'entity.name.label')) return t.labelName;
  if (startsWith(scope, 'entity.other.attribute-name')) return t.attributeName;
  if (startsWith(scope, 'entity.other.inherited-class')) return t.className;

  // Variables, properties, parameters.
  if (startsWith(scope, 'variable.other.property')) return t.property;
  if (startsWith(scope, 'variable.parameter')) return t.variableName;
  if (startsWith(scope, 'variable.language')) return t.builtin;
  if (startsWith(scope, 'variable.other.constant')) return t.literal;
  if (startsWith(scope, 'variable')) return t.variableName;

  // Punctuation / operators / brackets.
  // Bracket pair colorization (SHIP-V1-GAPS.md #22). The Rust tokenizer
  // post-processes brackets into level0/1/2 cycling scopes; map those onto
  // three distinct theme slots that every theme already populates.
  if (startsWith(scope, 'punctuation.bracket.level0')) return t.regexp;
  if (startsWith(scope, 'punctuation.bracket.level1')) return t.tagName;
  if (startsWith(scope, 'punctuation.bracket.level2')) return t.atom;
  if (startsWith(scope, 'punctuation.bracket')) return t.punctuation;
  if (startsWith(scope, 'punctuation.definition.string')) return t.string;
  if (startsWith(scope, 'punctuation')) return t.punctuation;

  // Support library (built-ins).
  if (startsWith(scope, 'support.function')) return t.functionName;
  if (startsWith(scope, 'support.class')) return t.className;
  if (startsWith(scope, 'support.type')) return t.typeName;
  if (startsWith(scope, 'support.constant')) return t.literal;
  if (startsWith(scope, 'support.variable')) return t.builtin;
  if (startsWith(scope, 'support')) return t.builtin;

  // Markup.
  if (startsWith(scope, 'markup.heading')) return t.heading;
  if (startsWith(scope, 'markup.bold')) return t.special;
  if (startsWith(scope, 'markup.italic')) return t.special;
  if (startsWith(scope, 'markup.underline.link')) return t.link;
  if (startsWith(scope, 'markup.inserted')) return t.inserted;
  if (startsWith(scope, 'markup.deleted')) return t.deleted;
  if (startsWith(scope, 'markup.changed')) return t.changed;

  // Meta / invalid.
  if (startsWith(scope, 'meta.tag')) return t.tagName;
  if (startsWith(scope, 'meta')) return t.meta;
  if (startsWith(scope, 'invalid')) return t.invalid;

  return theme.foreground;
}

/**
 * scope `prefix` match: returns true iff `scope` equals `prefix` exactly or
 * starts with `prefix + '.'`. Used by the resolver above.
 */
function startsWith(scope: string, prefix: string): boolean {
  if (scope.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (scope.charCodeAt(i) !== prefix.charCodeAt(i)) return false;
  }
  if (scope.length === prefix.length) return true;
  return scope.charCodeAt(prefix.length) === 46; // '.'
}
