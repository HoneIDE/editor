/**
 * Snippet engine — expands snippet templates with tab stops and variables.
 *
 * Snippet syntax (VS Code compatible subset):
 *   $1, $2, ...    — tab stops (navigate with Tab/Shift+Tab)
 *   ${1:default}   — tab stop with default text
 *   $0             — final cursor position
 *   $TM_FILENAME   — variable: current filename
 *   $TM_FILEPATH   — variable: current file path
 *   $CLIPBOARD     — variable: clipboard content
 *   \$             — escaped dollar sign
 */

/** A tab stop within a snippet. */
export interface TabStop {
  /** 0-based index in the expanded text where this stop begins. */
  offset: number;
  /** Length of the default text (0 if no default). */
  length: number;
  /** Tab stop number ($1, $2, etc. — $0 is always last). */
  index: number;
}

/** Result of expanding a snippet. */
export interface ExpandedSnippet {
  /** The fully expanded text (with defaults filled in). */
  text: string;
  /** Tab stops sorted by index (navigate in this order). */
  tabStops: TabStop[];
}

/** Variables available during snippet expansion. */
export interface SnippetVariables {
  TM_FILENAME?: string;
  TM_FILEPATH?: string;
  TM_DIRECTORY?: string;
  TM_LINE_INDEX?: string;
  TM_LINE_NUMBER?: string;
  CLIPBOARD?: string;
  CURRENT_YEAR?: string;
  CURRENT_MONTH?: string;
  CURRENT_DATE?: string;
}

/**
 * Expand a snippet template into text + tab stops.
 *
 * @param template The snippet template string
 * @param variables Variable values for substitution
 * @param indentation Leading whitespace to prepend to each line
 * @returns The expanded snippet with tab stop positions
 */
export function expandSnippet(
  template: string,
  variables: SnippetVariables = {},
  indentation: string = '',
): ExpandedSnippet {
  const tabStops: TabStop[] = [];
  let result = '';
  let i = 0;

  while (i < template.length) {
    const ch = template.charCodeAt(i);

    // Escaped dollar
    if (ch === 92 && i + 1 < template.length && template.charCodeAt(i + 1) === 36) {
      result += '$';
      i += 2;
      continue;
    }

    // Newline — add indentation
    if (ch === 10) {
      result += '\n';
      result += indentation;
      i += 1;
      continue;
    }

    // Dollar sign — tab stop or variable
    if (ch === 36 && i + 1 < template.length) {
      const next = template.charCodeAt(i + 1);

      // ${N:default} — tab stop with default
      if (next === 123) {
        const closeIdx = findClosingBrace(template, i + 2);
        if (closeIdx > 0) {
          const inner = template.slice(i + 2, closeIdx);
          const colonIdx = inner.indexOf(':');
          if (colonIdx >= 0) {
            const stopNum = parseInt(inner.slice(0, colonIdx));
            const defaultText = inner.slice(colonIdx + 1);
            if (!isNaN(stopNum)) {
              tabStops.push({
                offset: result.length,
                length: defaultText.length,
                index: stopNum,
              });
              result += defaultText;
              i = closeIdx + 1;
              continue;
            }
          } else {
            // ${VARIABLE} — variable reference
            const varName = inner;
            const varValue = resolveVariable(varName, variables);
            result += varValue;
            i = closeIdx + 1;
            continue;
          }
        }
      }

      // $N — simple tab stop
      if (next >= 48 && next <= 57) {
        const stopNum = next - 48;
        tabStops.push({
          offset: result.length,
          length: 0,
          index: stopNum,
        });
        i += 2;
        continue;
      }

      // $VARIABLE — variable without braces
      if ((next >= 65 && next <= 90) || next === 95) {
        let end = i + 1;
        while (end < template.length) {
          const c = template.charCodeAt(end);
          if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || (c >= 48 && c <= 57)) {
            end++;
          } else {
            break;
          }
        }
        const varName = template.slice(i + 1, end);
        const varValue = resolveVariable(varName, variables);
        result += varValue;
        i = end;
        continue;
      }
    }

    result += template.charAt(i);
    i += 1;
  }

  // Sort tab stops by index ($1 first, $2 next, ..., $0 last)
  tabStops.sort((a, b) => {
    if (a.index === 0) return 1;
    if (b.index === 0) return -1;
    return a.index - b.index;
  });

  return { text: result, tabStops };
}

/** Find the matching closing brace for ${...}. */
function findClosingBrace(s: string, start: number): number {
  let depth = 1;
  for (let i = start; i < s.length; i++) {
    if (s.charCodeAt(i) === 123) depth++;
    if (s.charCodeAt(i) === 125) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Resolve a variable name to its value. */
function resolveVariable(name: string, vars: SnippetVariables): string {
  if (name === 'TM_FILENAME' && vars.TM_FILENAME) return vars.TM_FILENAME;
  if (name === 'TM_FILEPATH' && vars.TM_FILEPATH) return vars.TM_FILEPATH;
  if (name === 'TM_DIRECTORY' && vars.TM_DIRECTORY) return vars.TM_DIRECTORY;
  if (name === 'TM_LINE_INDEX' && vars.TM_LINE_INDEX) return vars.TM_LINE_INDEX;
  if (name === 'TM_LINE_NUMBER' && vars.TM_LINE_NUMBER) return vars.TM_LINE_NUMBER;
  if (name === 'CLIPBOARD' && vars.CLIPBOARD) return vars.CLIPBOARD;
  if (name === 'CURRENT_YEAR' && vars.CURRENT_YEAR) return vars.CURRENT_YEAR;
  if (name === 'CURRENT_MONTH' && vars.CURRENT_MONTH) return vars.CURRENT_MONTH;
  if (name === 'CURRENT_DATE' && vars.CURRENT_DATE) return vars.CURRENT_DATE;
  return '';
}
