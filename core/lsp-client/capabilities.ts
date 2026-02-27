/**
 * LSP capability negotiation and feature detection.
 *
 * After initialize, inspect the server's capabilities to determine
 * which features are available.
 */

import type { ServerCapabilities, ClientCapabilities } from './protocol';

/**
 * Default client capabilities sent during initialization.
 */
export function getDefaultClientCapabilities(): ClientCapabilities {
  return {
    textDocument: {
      completion: {
        completionItem: {
          snippetSupport: false, // We don't support snippets yet
        },
      },
      hover: {
        contentFormat: ['plaintext', 'markdown'],
      },
      signatureHelp: {
        signatureInformation: {
          parameterInformation: {
            labelOffsetSupport: true,
          },
        },
      },
      codeAction: {
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: [
              'quickfix',
              'refactor',
              'refactor.extract',
              'refactor.inline',
              'refactor.rewrite',
              'source',
              'source.organizeImports',
            ],
          },
        },
      },
    },
  };
}

/**
 * Parsed server capabilities for easy feature detection.
 */
export class ServerCapabilityChecker {
  private caps: ServerCapabilities;

  constructor(capabilities: ServerCapabilities) {
    this.caps = capabilities;
  }

  get hasCompletion(): boolean {
    return !!this.caps.completionProvider;
  }

  get completionTriggerCharacters(): string[] {
    return this.caps.completionProvider?.triggerCharacters ?? [];
  }

  get hasCompletionResolve(): boolean {
    return !!this.caps.completionProvider?.resolveProvider;
  }

  get hasHover(): boolean {
    return !!this.caps.hoverProvider;
  }

  get hasSignatureHelp(): boolean {
    return !!this.caps.signatureHelpProvider;
  }

  get signatureHelpTriggerCharacters(): string[] {
    return this.caps.signatureHelpProvider?.triggerCharacters ?? [];
  }

  get signatureHelpRetriggerCharacters(): string[] {
    return this.caps.signatureHelpProvider?.retriggerCharacters ?? [];
  }

  get hasDefinition(): boolean {
    return !!this.caps.definitionProvider;
  }

  get hasReferences(): boolean {
    return !!this.caps.referencesProvider;
  }

  get hasFormatting(): boolean {
    return !!this.caps.documentFormattingProvider;
  }

  get hasRangeFormatting(): boolean {
    return !!this.caps.documentRangeFormattingProvider;
  }

  get hasCodeAction(): boolean {
    return !!this.caps.codeActionProvider;
  }

  get codeActionKinds(): string[] {
    if (typeof this.caps.codeActionProvider === 'object') {
      return this.caps.codeActionProvider.codeActionKinds ?? [];
    }
    return [];
  }

  /**
   * Determine the text document sync mode.
   * 0 = None, 1 = Full, 2 = Incremental
   */
  get textDocumentSyncKind(): number {
    if (typeof this.caps.textDocumentSync === 'number') {
      return this.caps.textDocumentSync;
    }
    if (typeof this.caps.textDocumentSync === 'object') {
      return this.caps.textDocumentSync.change ?? 0;
    }
    return 0;
  }

  get supportsOpenClose(): boolean {
    if (typeof this.caps.textDocumentSync === 'object') {
      return this.caps.textDocumentSync.openClose ?? false;
    }
    return typeof this.caps.textDocumentSync === 'number' && this.caps.textDocumentSync > 0;
  }
}
