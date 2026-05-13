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
  /** SHIP-V1-GAPS.md #83: choices for `${N|a,b,c|}` — undefined when not a choice stop. */
  choices?: string[];
  /**
   * SHIP-V1-GAPS.md #83: transform for `${N/regex/sub/flags}`. The renderer
   * applies the regex to whatever the user types into the stop. `flags`
   * follows standard JS RegExp flag semantics; `sub` may contain `$1`..`$9`
   * group backrefs.
   */
  transform?: { regex: string; sub: string; flags: string };
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

          // SHIP-V1-GAPS.md #83 — `${N|a,b,c|}` choice stop.
          const pipeIdx = inner.indexOf('|');
          if (pipeIdx > 0 && inner.charCodeAt(inner.length - 1) === 124) {
            const stopNum = parseInt(inner.slice(0, pipeIdx));
            if (!isNaN(stopNum)) {
              const optsRaw = inner.slice(pipeIdx + 1, inner.length - 1);
              const opts: string[] = [];
              let s = 0;
              for (let k = 0; k <= optsRaw.length; k++) {
                if (k === optsRaw.length || optsRaw.charCodeAt(k) === 44) {
                  if (k > s) opts.push(optsRaw.slice(s, k));
                  s = k + 1;
                }
              }
              const first = opts.length > 0 ? opts[0] : '';
              tabStops.push({
                offset: result.length,
                length: first.length,
                index: stopNum,
                choices: opts,
              });
              result += first;
              i = closeIdx + 1;
              continue;
            }
          }

          // SHIP-V1-GAPS.md #83 — `${N/regex/sub/flags}` transform stop.
          // We look for two unescaped slashes after the numeric prefix.
          const slashIdx = inner.indexOf('/');
          if (slashIdx > 0) {
            const stopNum = parseInt(inner.slice(0, slashIdx));
            if (!isNaN(stopNum)) {
              // Find second + third slashes, respecting backslash escapes.
              let mid = -1;
              let end = -1;
              for (let k = slashIdx + 1; k < inner.length; k++) {
                if (inner.charCodeAt(k) === 92) { k++; continue; } // skip escape
                if (inner.charCodeAt(k) === 47) {
                  if (mid < 0) mid = k;
                  else { end = k; break; }
                }
              }
              if (mid > slashIdx && end > mid) {
                const regex = inner.slice(slashIdx + 1, mid);
                const sub = inner.slice(mid + 1, end);
                const flags = inner.slice(end + 1);
                tabStops.push({
                  offset: result.length,
                  length: 0,
                  index: stopNum,
                  transform: { regex: regex, sub: sub, flags: flags },
                });
                i = closeIdx + 1;
                continue;
              }
            }
          }

          const colonIdx = inner.indexOf(':');
          if (colonIdx >= 0) {
            const stopNum = parseInt(inner.slice(0, colonIdx));
            // SHIP-V1-GAPS.md #83 — nested placeholders: recursively expand
            // the default text so `${1:func(${2:arg})}` produces two stops.
            if (!isNaN(stopNum)) {
              const defaultRaw = inner.slice(colonIdx + 1);
              const nested = expandSnippet(defaultRaw, variables, '');
              const baseOffset = result.length;
              tabStops.push({
                offset: baseOffset,
                length: nested.text.length,
                index: stopNum,
              });
              // Re-anchor the nested tab stops to our offset.
              for (let k = 0; k < nested.tabStops.length; k++) {
                const ts = nested.tabStops[k];
                tabStops.push({
                  offset: baseOffset + ts.offset,
                  length: ts.length,
                  index: ts.index,
                  choices: ts.choices,
                  transform: ts.transform,
                });
              }
              result += nested.text;
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
