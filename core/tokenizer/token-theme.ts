/**
 * Token-to-theme-color mapping: resolve Lezer tags to editor theme colors.
 *
 * Lezer provides a tag system (tags.keyword, tags.string, etc.).
 * This module maps those tags to hex color strings from the current theme.
 */

import { tags, Tag } from '@lezer/highlight';
import type { EditorTheme, TokenThemeMapping } from '../../view-model/theme';

/**
 * Resolve a Lezer highlight tag to a theme color.
 */
export function resolveTagColor(tag: Tag, tokens: TokenThemeMapping): string {
  // Direct tag mappings
  if (tag === tags.keyword || tag === tags.controlKeyword || tag === tags.operatorKeyword ||
      tag === tags.definitionKeyword || tag === tags.moduleKeyword) {
    return tokens.keyword;
  }
  if (tag === tags.string || tag === tags.special(tags.string)) {
    return tokens.string;
  }
  if (tag === tags.comment || tag === tags.lineComment || tag === tags.blockComment ||
      tag === tags.docComment) {
    return tokens.comment;
  }
  if (tag === tags.variableName) {
    return tokens.variableName;
  }
  if (tag === tags.definition(tags.variableName)) {
    return tokens.definition;
  }
  if (tag === tags.typeName) {
    return tokens.typeName;
  }
  if (tag === tags.definition(tags.typeName) || tag === tags.className) {
    return tokens.className;
  }
  if (tag === tags.function(tags.variableName) || tag === tags.definition(tags.function(tags.variableName))) {
    return tokens.functionName;
  }
  if (tag === tags.number || tag === tags.integer || tag === tags.float) {
    return tokens.number;
  }
  if (tag === tags.operator || tag === tags.arithmeticOperator || tag === tags.logicOperator ||
      tag === tags.bitwiseOperator || tag === tags.compareOperator || tag === tags.updateOperator) {
    return tokens.operator;
  }
  if (tag === tags.punctuation || tag === tags.paren || tag === tags.brace ||
      tag === tags.squareBracket || tag === tags.angleBracket || tag === tags.separator ||
      tag === tags.derefOperator) {
    return tokens.punctuation;
  }
  if (tag === tags.regexp) {
    return tokens.regexp;
  }
  if (tag === tags.tagName) {
    return tokens.tagName;
  }
  if (tag === tags.attributeName) {
    return tokens.attributeName;
  }
  if (tag === tags.attributeValue) {
    return tokens.attributeValue;
  }
  if (tag === tags.heading) {
    return tokens.heading;
  }
  if (tag === tags.link || tag === tags.url) {
    return tokens.link;
  }
  if (tag === tags.meta) {
    return tokens.meta;
  }
  if (tag === tags.atom || tag === tags.unit) {
    return tokens.atom;
  }
  if (tag === tags.bool) {
    return tokens.bool;
  }
  if (tag === tags.special(tags.variableName) || tag === tags.standard(tags.variableName)) {
    return tokens.builtin;
  }
  if (tag === tags.propertyName || tag === tags.definition(tags.propertyName)) {
    return tokens.property;
  }
  if (tag === tags.namespace) {
    return tokens.namespace;
  }
  if (tag === tags.labelName) {
    return tokens.labelName;
  }
  if (tag === tags.macroName) {
    return tokens.macroName;
  }
  if (tag === tags.literal) {
    return tokens.literal;
  }
  if (tag === tags.inserted) {
    return tokens.inserted;
  }
  if (tag === tags.deleted) {
    return tokens.deleted;
  }
  if (tag === tags.changed) {
    return tokens.changed;
  }
  if (tag === tags.invalid) {
    return tokens.invalid;
  }
  if (tag === tags.self) {
    return tokens.keyword;
  }
  if (tag === tags.null) {
    return tokens.keyword;
  }
  if (tag === tags.escape) {
    return tokens.special;
  }
  if (tag === tags.character) {
    return tokens.string;
  }
  if (tag === tags.content) {
    return tokens.variableName;
  }

  // Default fallback
  return tokens.variableName;
}

/**
 * Resolve a Lezer tag to a font style.
 */
export function resolveTagStyle(tag: Tag): 'normal' | 'italic' | 'bold' | 'bold-italic' {
  if (tag === tags.comment || tag === tags.lineComment || tag === tags.blockComment ||
      tag === tags.docComment) {
    return 'italic';
  }
  if (tag === tags.heading || tag === tags.strong) {
    return 'bold';
  }
  if (tag === tags.emphasis) {
    return 'italic';
  }
  return 'normal';
}
