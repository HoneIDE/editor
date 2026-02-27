/**
 * DiffResult, DiffHunk types with accept/reject state for AI edits.
 */

export interface DiffResult {
  hunks: DiffHunk[];
  totalAdded: number;
  totalDeleted: number;
}

export interface DiffHunk {
  type: 'add' | 'delete' | 'modify';
  originalRange: { startLine: number; endLine: number };
  modifiedRange: { startLine: number; endLine: number };
  state: 'pending' | 'accepted' | 'rejected';
}

export interface InlineDiffSegment {
  text: string;
  type: 'unchanged' | 'added' | 'deleted';
}
