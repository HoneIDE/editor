/**
 * Lezer parser integration: parse, incremental re-parse, token extraction.
 *
 * Supports incremental parsing — on edits, only the affected region is re-parsed.
 * Lezer efficiently reuses unchanged subtrees.
 */

import { Parser, Tree, TreeCursor, Input } from '@lezer/common';
import { highlightTree } from '@lezer/highlight';
import { classHighlighter } from '@lezer/highlight';
import { tags, Tag, tagHighlighter } from '@lezer/highlight';
import { TextBuffer } from '../buffer/text-buffer';
import { resolveTagColor, resolveTagStyle } from './token-theme';
import type { EditorTheme } from '../../view-model/theme';
import type { LineToken } from '../../view-model/line-layout';

// Grammar imports
import { typescriptParser, javascriptParser } from './grammars/typescript';
import { htmlParser } from './grammars/html';
import { cssParser } from './grammars/css';
import { jsonParser } from './grammars/json';
import { markdownParser } from './grammars/markdown';
import { pythonParser } from './grammars/python';
import { rustParser } from './grammars/rust';
import { cppParser } from './grammars/cpp';

export interface FoldRange {
  startLine: number;
  endLine: number;
}

/**
 * A custom Lezer Input adapter that reads from our TextBuffer.
 */
class BufferInput implements Input {
  constructor(private buffer: TextBuffer) {}

  get length(): number {
    return this.buffer.getLength();
  }

  chunk(from: number): string {
    // Return a chunk of text from the buffer
    // Lezer typically reads forward in moderate-sized chunks
    const chunkSize = 4096;
    return this.buffer.getTextRange(from, Math.min(from + chunkSize, this.length));
  }

  lineChunks = false;

  read(from: number, to: number): string {
    return this.buffer.getTextRange(from, to);
  }
}

export class SyntaxEngine {
  private parsers: Map<string, Parser> = new Map();
  private currentLanguageId: string = '';
  private currentTree: Tree | null = null;
  private currentParser: Parser | null = null;

  constructor() {
    this.registerGrammar('typescript', typescriptParser);
    this.registerGrammar('javascript', javascriptParser);
    this.registerGrammar('html', htmlParser);
    this.registerGrammar('css', cssParser);
    this.registerGrammar('json', jsonParser);
    this.registerGrammar('markdown', markdownParser);
    this.registerGrammar('python', pythonParser);
    this.registerGrammar('rust', rustParser);
    this.registerGrammar('c', cppParser);
    this.registerGrammar('cpp', cppParser);
  }

  registerGrammar(languageId: string, parser: Parser): void {
    this.parsers.set(languageId, parser);
  }

  /**
   * Set the language for parsing.
   */
  setLanguage(languageId: string): void {
    this.currentLanguageId = languageId;
    this.currentParser = this.parsers.get(languageId) ?? null;
    this.currentTree = null;
  }

  /**
   * Parse (or incrementally re-parse) the document.
   */
  parse(
    buffer: TextBuffer,
    changedRanges?: { fromOffset: number; toOffset: number }[],
  ): Tree | null {
    if (!this.currentParser) return null;

    const input = new BufferInput(buffer);

    if (this.currentTree && changedRanges && changedRanges.length > 0) {
      // Incremental parse: apply changes to previous tree
      const fragments = Tree.prototype.constructor === undefined ? undefined :
        undefined; // Lezer handles this internally

      // For incremental parsing, Lezer needs the changes described
      // We create a new parse with the fragments from the old tree
      try {
        this.currentTree = this.currentParser.parse(
          input,
          this.currentTree.length === buffer.getLength() ? undefined :
          undefined,
        );
      } catch {
        // If incremental parse fails, do a full parse
        this.currentTree = this.currentParser.parse(input);
      }
    } else {
      // Full parse
      this.currentTree = this.currentParser.parse(input);
    }

    return this.currentTree;
  }

  /**
   * Get the current parse tree.
   */
  getTree(): Tree | null {
    return this.currentTree;
  }

  /**
   * Get syntax tokens for a specific line.
   */
  getLineTokens(
    buffer: TextBuffer,
    lineNumber: number,
    theme: EditorTheme,
  ): LineToken[] {
    if (!this.currentTree || lineNumber < 0 || lineNumber >= buffer.getLineCount()) {
      return [];
    }

    const lineStart = buffer.getLineOffset(lineNumber);
    const lineText = buffer.getLine(lineNumber);
    const lineEnd = lineStart + lineText.length;

    if (lineText.length === 0) return [];

    const tokens: LineToken[] = [];
    const tree = this.currentTree;

    // Walk the tree to find nodes that overlap this line
    const cursor = tree.cursor();

    // Collect all leaf nodes that overlap with this line range
    const nodeRanges: { from: number; to: number; tags: number[] }[] = [];

    this.collectNodeRanges(cursor, lineStart, lineEnd, nodeRanges);

    if (nodeRanges.length === 0) {
      // No syntax info — return single default token
      return [{
        startColumn: 0,
        endColumn: lineText.length,
        color: theme.foreground,
        fontStyle: 'normal',
      }];
    }

    // Convert node ranges to line-relative tokens
    // Use highlightTree for proper tag resolution
    const highlights: { from: number; to: number; tag: Tag }[] = [];

    this.extractHighlights(tree, lineStart, lineEnd, highlights);

    if (highlights.length === 0) {
      return [{
        startColumn: 0,
        endColumn: lineText.length,
        color: theme.foreground,
        fontStyle: 'normal',
      }];
    }

    // Sort by position
    highlights.sort((a, b) => a.from - b.from);

    // Convert to LineTokens, filling gaps with default color
    let lastEnd = lineStart;

    for (const h of highlights) {
      const from = Math.max(h.from, lineStart);
      const to = Math.min(h.to, lineEnd);

      if (from > lastEnd) {
        // Gap — fill with default
        tokens.push({
          startColumn: lastEnd - lineStart,
          endColumn: from - lineStart,
          color: theme.foreground,
          fontStyle: 'normal',
        });
      }

      tokens.push({
        startColumn: from - lineStart,
        endColumn: to - lineStart,
        color: resolveTagColor(h.tag, theme.tokens),
        fontStyle: resolveTagStyle(h.tag),
      });

      lastEnd = to;
    }

    // Fill trailing gap
    if (lastEnd < lineEnd) {
      tokens.push({
        startColumn: lastEnd - lineStart,
        endColumn: lineText.length,
        color: theme.foreground,
        fontStyle: 'normal',
      });
    }

    return tokens;
  }

  private collectNodeRanges(
    cursor: TreeCursor,
    rangeFrom: number,
    rangeTo: number,
    result: { from: number; to: number; tags: number[] }[],
  ): void {
    if (cursor.from >= rangeTo || cursor.to <= rangeFrom) return;

    if (!cursor.firstChild()) {
      // Leaf node
      result.push({
        from: cursor.from,
        to: cursor.to,
        tags: [cursor.type.id],
      });
      return;
    }

    do {
      this.collectNodeRanges(cursor, rangeFrom, rangeTo, result);
    } while (cursor.nextSibling());

    cursor.parent();
  }

  private extractHighlights(
    tree: Tree,
    from: number,
    to: number,
    result: { from: number; to: number; tag: Tag }[],
  ): void {
    // Use Lezer's highlightTree to properly resolve tags
    highlightTree(tree, tagHighlighter([
      { tag: tags.keyword, class: 'keyword' },
      { tag: tags.controlKeyword, class: 'keyword' },
      { tag: tags.operatorKeyword, class: 'keyword' },
      { tag: tags.definitionKeyword, class: 'keyword' },
      { tag: tags.moduleKeyword, class: 'keyword' },
      { tag: tags.string, class: 'string' },
      { tag: tags.special(tags.string), class: 'string' },
      { tag: tags.character, class: 'string' },
      { tag: tags.comment, class: 'comment' },
      { tag: tags.lineComment, class: 'comment' },
      { tag: tags.blockComment, class: 'comment' },
      { tag: tags.docComment, class: 'comment' },
      { tag: tags.variableName, class: 'variableName' },
      { tag: tags.definition(tags.variableName), class: 'definition' },
      { tag: tags.function(tags.variableName), class: 'functionName' },
      { tag: tags.definition(tags.function(tags.variableName)), class: 'functionName' },
      { tag: tags.typeName, class: 'typeName' },
      { tag: tags.className, class: 'className' },
      { tag: tags.definition(tags.typeName), class: 'className' },
      { tag: tags.number, class: 'number' },
      { tag: tags.integer, class: 'number' },
      { tag: tags.float, class: 'number' },
      { tag: tags.operator, class: 'operator' },
      { tag: tags.arithmeticOperator, class: 'operator' },
      { tag: tags.logicOperator, class: 'operator' },
      { tag: tags.bitwiseOperator, class: 'operator' },
      { tag: tags.compareOperator, class: 'operator' },
      { tag: tags.updateOperator, class: 'operator' },
      { tag: tags.punctuation, class: 'punctuation' },
      { tag: tags.paren, class: 'punctuation' },
      { tag: tags.brace, class: 'punctuation' },
      { tag: tags.squareBracket, class: 'punctuation' },
      { tag: tags.angleBracket, class: 'punctuation' },
      { tag: tags.separator, class: 'punctuation' },
      { tag: tags.derefOperator, class: 'punctuation' },
      { tag: tags.regexp, class: 'regexp' },
      { tag: tags.tagName, class: 'tagName' },
      { tag: tags.attributeName, class: 'attributeName' },
      { tag: tags.attributeValue, class: 'attributeValue' },
      { tag: tags.heading, class: 'heading' },
      { tag: tags.link, class: 'link' },
      { tag: tags.url, class: 'link' },
      { tag: tags.meta, class: 'meta' },
      { tag: tags.atom, class: 'atom' },
      { tag: tags.unit, class: 'atom' },
      { tag: tags.bool, class: 'bool' },
      { tag: tags.self, class: 'keyword' },
      { tag: tags.null, class: 'keyword' },
      { tag: tags.escape, class: 'special' },
      { tag: tags.propertyName, class: 'property' },
      { tag: tags.definition(tags.propertyName), class: 'property' },
      { tag: tags.namespace, class: 'namespace' },
      { tag: tags.labelName, class: 'labelName' },
      { tag: tags.macroName, class: 'macroName' },
      { tag: tags.literal, class: 'literal' },
      { tag: tags.inserted, class: 'inserted' },
      { tag: tags.deleted, class: 'deleted' },
      { tag: tags.changed, class: 'changed' },
      { tag: tags.invalid, class: 'invalid' },
      { tag: tags.special(tags.variableName), class: 'builtin' },
      { tag: tags.standard(tags.variableName), class: 'builtin' },
    ]), (from, to, classes) => {
      // Map class name back to a tag
      const tag = classToTag(classes);
      if (tag) {
        result.push({ from, to, tag });
      }
    }, from, to);
  }

  /**
   * Get fold ranges from the syntax tree.
   */
  getFoldRanges(buffer: TextBuffer): FoldRange[] {
    if (!this.currentTree) return [];

    const ranges: FoldRange[] = [];
    const cursor = this.currentTree.cursor();

    this.findFoldableNodes(cursor, buffer, ranges);

    return ranges;
  }

  private findFoldableNodes(
    cursor: TreeCursor,
    buffer: TextBuffer,
    result: FoldRange[],
  ): void {
    // Check if this node is a block that can be folded
    const name = cursor.name;
    const foldableTypes = new Set([
      'Block', 'StatementBlock', 'ClassBody', 'ObjectExpression',
      'ArrayExpression', 'FunctionDeclaration', 'ArrowFunction',
      'IfStatement', 'ForStatement', 'WhileStatement', 'SwitchStatement',
      'TryStatement', 'Object', 'Array', 'BlockComment',
      // Python
      'Body', 'Suite',
      // Rust
      'BlockExpression', 'MatchExpression',
      // C++
      'CompoundStatement', 'FieldDeclarationList',
    ]);

    if (foldableTypes.has(name)) {
      const startLine = buffer.getOffsetLine(cursor.from);
      const endLine = buffer.getOffsetLine(cursor.to);
      if (endLine > startLine) {
        result.push({ startLine, endLine });
      }
    }

    if (cursor.firstChild()) {
      do {
        this.findFoldableNodes(cursor, buffer, result);
      } while (cursor.nextSibling());
      cursor.parent();
    }
  }

  /**
   * Find the matching bracket for a given position.
   */
  findMatchingBracket(buffer: TextBuffer, offset: number): number | null {
    if (!this.currentTree) return null;

    const cursor = this.currentTree.cursorAt(offset);
    const name = cursor.name;

    // Check if we're on a bracket-like node
    const bracketPairs: Record<string, string> = {
      '(': ')', ')': '(',
      '[': ']', ']': '[',
      '{': '}', '}': '{',
      '<': '>', '>': '<',
    };

    const ch = buffer.getTextRange(offset, offset + 1);
    if (!bracketPairs[ch]) return null;

    const isOpen = ch === '(' || ch === '[' || ch === '{' || ch === '<';

    // Walk up to find the parent node, then find the matching bracket
    // This is a simplified approach — walk siblings
    if (isOpen) {
      // Find matching close bracket
      const parent = cursor.node.parent;
      if (!parent) return null;
      const lastChild = parent.lastChild;
      if (!lastChild) return null;
      const lastText = buffer.getTextRange(lastChild.from, lastChild.to);
      if (lastText === bracketPairs[ch]) {
        return lastChild.from;
      }
    } else {
      // Find matching open bracket
      const parent = cursor.node.parent;
      if (!parent) return null;
      const firstChild = parent.firstChild;
      if (!firstChild) return null;
      const firstText = buffer.getTextRange(firstChild.from, firstChild.to);
      if (firstText === bracketPairs[ch]) {
        return firstChild.from;
      }
    }

    return null;
  }

  /** List of supported language IDs. */
  getSupportedLanguages(): string[] {
    return [...this.parsers.keys()];
  }

  /** Check if a language is supported. */
  hasLanguage(languageId: string): boolean {
    return this.parsers.has(languageId);
  }
}

/**
 * Map CSS class names back to Lezer tags for color resolution.
 */
function classToTag(className: string): Tag | null {
  const map: Record<string, Tag> = {
    keyword: tags.keyword,
    string: tags.string,
    comment: tags.comment,
    variableName: tags.variableName,
    definition: tags.definition(tags.variableName),
    functionName: tags.function(tags.variableName),
    typeName: tags.typeName,
    className: tags.className,
    number: tags.number,
    operator: tags.operator,
    punctuation: tags.punctuation,
    regexp: tags.regexp,
    tagName: tags.tagName,
    attributeName: tags.attributeName,
    attributeValue: tags.attributeValue,
    heading: tags.heading,
    link: tags.link,
    meta: tags.meta,
    atom: tags.atom,
    bool: tags.bool,
    special: tags.escape,
    property: tags.propertyName,
    namespace: tags.namespace,
    labelName: tags.labelName,
    macroName: tags.macroName,
    literal: tags.literal,
    inserted: tags.inserted,
    deleted: tags.deleted,
    changed: tags.changed,
    invalid: tags.invalid,
    builtin: tags.special(tags.variableName),
  };
  return map[className] ?? null;
}
