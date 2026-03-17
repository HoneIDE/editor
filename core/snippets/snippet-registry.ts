/**
 * Snippet registry — stores snippet definitions per language.
 *
 * Built-in snippets for common languages. Users can add custom snippets
 * via settings or plugin-provided snippet files.
 */

import { expandSnippet, type ExpandedSnippet, type SnippetVariables } from './snippet-engine';

/** A snippet definition. */
export interface SnippetDef {
  /** Short trigger prefix (e.g., "for", "fn", "cl"). */
  prefix: string;
  /** Display name (e.g., "For Loop"). */
  name: string;
  /** The template body with tab stops. */
  body: string;
  /** Optional description. */
  description: string;
}

/** The snippet registry. */
export class SnippetRegistry {
  /** Map from languageId to array of snippets. */
  private snippets: Map<string, SnippetDef[]> = new Map();

  constructor() {
    this.loadBuiltins();
  }

  /** Register a snippet for a language. */
  register(languageId: string, snippet: SnippetDef): void {
    let list = this.snippets.get(languageId);
    if (!list) {
      list = [];
      this.snippets.set(languageId, list);
    }
    list.push(snippet);
  }

  /** Get all snippets for a language. */
  getSnippets(languageId: string): SnippetDef[] {
    return this.snippets.get(languageId) || [];
  }

  /** Find snippets matching a prefix. */
  match(languageId: string, prefix: string): SnippetDef[] {
    const all = this.getSnippets(languageId);
    return all.filter(s => s.prefix.startsWith(prefix));
  }

  /** Expand a snippet by prefix for a language. */
  expand(
    languageId: string,
    prefix: string,
    variables?: SnippetVariables,
    indentation?: string,
  ): ExpandedSnippet | null {
    const all = this.getSnippets(languageId);
    const snippet = all.find(s => s.prefix === prefix);
    if (!snippet) return null;
    return expandSnippet(snippet.body, variables, indentation);
  }

  /** Load built-in snippets for common languages. */
  private loadBuiltins(): void {
    // TypeScript / JavaScript
    const tsSnippets: SnippetDef[] = [
      { prefix: 'for', name: 'For Loop', body: 'for (let ${1:i} = 0; ${1:i} < ${2:array}.length; ${1:i}++) {\n\t$0\n}', description: 'For loop' },
      { prefix: 'forof', name: 'For...of Loop', body: 'for (const ${1:item} of ${2:iterable}) {\n\t$0\n}', description: 'For...of loop' },
      { prefix: 'forin', name: 'For...in Loop', body: 'for (const ${1:key} in ${2:object}) {\n\t$0\n}', description: 'For...in loop' },
      { prefix: 'if', name: 'If Statement', body: 'if (${1:condition}) {\n\t$0\n}', description: 'If statement' },
      { prefix: 'ife', name: 'If/Else', body: 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}', description: 'If/else statement' },
      { prefix: 'fn', name: 'Function', body: 'function ${1:name}(${2:params}): ${3:void} {\n\t$0\n}', description: 'Function declaration' },
      { prefix: 'afn', name: 'Arrow Function', body: 'const ${1:name} = (${2:params}) => {\n\t$0\n};', description: 'Arrow function' },
      { prefix: 'cl', name: 'Console Log', body: 'console.log(${1:value});$0', description: 'Console log' },
      { prefix: 'try', name: 'Try/Catch', body: 'try {\n\t$1\n} catch (${2:error}) {\n\t$0\n}', description: 'Try/catch block' },
      { prefix: 'class', name: 'Class', body: 'class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t$0\n\t}\n}', description: 'Class declaration' },
      { prefix: 'int', name: 'Interface', body: 'interface ${1:Name} {\n\t$0\n}', description: 'Interface declaration' },
      { prefix: 'imp', name: 'Import', body: "import { $2 } from '${1:module}';$0", description: 'Import statement' },
      { prefix: 'exp', name: 'Export', body: 'export $0', description: 'Export statement' },
      { prefix: 'switch', name: 'Switch', body: 'switch (${1:key}) {\n\tcase ${2:value}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}', description: 'Switch statement' },
      { prefix: 'map', name: 'Array Map', body: '${1:array}.map((${2:item}) => {\n\t$0\n});', description: 'Array map' },
      { prefix: 'filter', name: 'Array Filter', body: '${1:array}.filter((${2:item}) => {\n\t$0\n});', description: 'Array filter' },
      { prefix: 'desc', name: 'Describe Block', body: "describe('${1:suite}', () => {\n\t$0\n});", description: 'Test describe block' },
      { prefix: 'test', name: 'Test Block', body: "test('${1:name}', () => {\n\t$0\n});", description: 'Test block' },
    ];
    for (const s of tsSnippets) {
      this.register('typescript', s);
      this.register('javascript', s);
      this.register('typescriptreact', s);
      this.register('javascriptreact', s);
    }

    // Python
    const pySnippets: SnippetDef[] = [
      { prefix: 'def', name: 'Function', body: 'def ${1:name}(${2:params}):\n\t${0:pass}', description: 'Function definition' },
      { prefix: 'class', name: 'Class', body: 'class ${1:Name}:\n\tdef __init__(self${2:, params}):\n\t\t${0:pass}', description: 'Class definition' },
      { prefix: 'for', name: 'For Loop', body: 'for ${1:item} in ${2:iterable}:\n\t$0', description: 'For loop' },
      { prefix: 'if', name: 'If Statement', body: 'if ${1:condition}:\n\t$0', description: 'If statement' },
      { prefix: 'ife', name: 'If/Else', body: 'if ${1:condition}:\n\t$2\nelse:\n\t$0', description: 'If/else' },
      { prefix: 'try', name: 'Try/Except', body: 'try:\n\t$1\nexcept ${2:Exception} as ${3:e}:\n\t$0', description: 'Try/except' },
      { prefix: 'with', name: 'With Statement', body: 'with ${1:expression} as ${2:var}:\n\t$0', description: 'With statement' },
      { prefix: 'pr', name: 'Print', body: 'print(${1:value})$0', description: 'Print' },
      { prefix: 'main', name: 'Main Guard', body: "if __name__ == '__main__':\n\t$0", description: 'Main guard' },
    ];
    for (const s of pySnippets) this.register('python', s);

    // Rust
    const rsSnippets: SnippetDef[] = [
      { prefix: 'fn', name: 'Function', body: 'fn ${1:name}(${2:params}) -> ${3:()} {\n\t$0\n}', description: 'Function' },
      { prefix: 'pfn', name: 'Pub Function', body: 'pub fn ${1:name}(${2:params}) -> ${3:()} {\n\t$0\n}', description: 'Public function' },
      { prefix: 'struct', name: 'Struct', body: 'struct ${1:Name} {\n\t$0\n}', description: 'Struct' },
      { prefix: 'impl', name: 'Impl', body: 'impl ${1:Type} {\n\t$0\n}', description: 'Impl block' },
      { prefix: 'enum', name: 'Enum', body: 'enum ${1:Name} {\n\t$0\n}', description: 'Enum' },
      { prefix: 'match', name: 'Match', body: 'match ${1:value} {\n\t${2:pattern} => $0,\n}', description: 'Match expression' },
      { prefix: 'for', name: 'For Loop', body: 'for ${1:item} in ${2:iter} {\n\t$0\n}', description: 'For loop' },
      { prefix: 'if', name: 'If Let', body: 'if let ${1:Some(val)} = ${2:option} {\n\t$0\n}', description: 'If let' },
      { prefix: 'test', name: 'Test', body: '#[test]\nfn ${1:test_name}() {\n\t$0\n}', description: 'Test function' },
      { prefix: 'pr', name: 'Println', body: 'println!("${1:{}}", ${2:value});$0', description: 'Println macro' },
    ];
    for (const s of rsSnippets) this.register('rust', s);

    // Go
    const goSnippets: SnippetDef[] = [
      { prefix: 'fn', name: 'Function', body: 'func ${1:name}(${2:params}) ${3:error} {\n\t$0\n}', description: 'Function' },
      { prefix: 'for', name: 'For Loop', body: 'for ${1:i} := 0; ${1:i} < ${2:count}; ${1:i}++ {\n\t$0\n}', description: 'For loop' },
      { prefix: 'forr', name: 'For Range', body: 'for ${1:i}, ${2:v} := range ${3:slice} {\n\t$0\n}', description: 'For range' },
      { prefix: 'if', name: 'If Statement', body: 'if ${1:condition} {\n\t$0\n}', description: 'If statement' },
      { prefix: 'ife', name: 'If/Else', body: 'if ${1:condition} {\n\t$2\n} else {\n\t$0\n}', description: 'If/else' },
      { prefix: 'iferr', name: 'If Error', body: 'if err != nil {\n\t$0\n}', description: 'If error check' },
      { prefix: 'struct', name: 'Struct', body: 'type ${1:Name} struct {\n\t$0\n}', description: 'Struct' },
      { prefix: 'int', name: 'Interface', body: 'type ${1:Name} interface {\n\t$0\n}', description: 'Interface' },
      { prefix: 'pr', name: 'Println', body: 'fmt.Println(${1:value})$0', description: 'Println' },
    ];
    for (const s of goSnippets) this.register('go', s);
  }
}
