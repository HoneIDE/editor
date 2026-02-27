/**
 * DAP protocol types matching the Debug Adapter Protocol specification.
 *
 * Subset covering the features used by the editor surface:
 * breakpoints, stack frames, variables, stepping.
 */

// === Base Protocol ===

export interface DapRequest {
  seq: number;
  type: 'request';
  command: string;
  arguments?: any;
}

export interface DapResponse {
  seq: number;
  type: 'response';
  request_seq: number;
  command: string;
  success: boolean;
  message?: string;
  body?: any;
}

export interface DapEvent {
  seq: number;
  type: 'event';
  event: string;
  body?: any;
}

export type DapMessage = DapRequest | DapResponse | DapEvent;

// === Breakpoints ===

export interface SourceBreakpoint {
  line: number;
  column?: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

export interface Breakpoint {
  id?: number;
  verified: boolean;
  message?: string;
  source?: Source;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Source {
  name?: string;
  path?: string;
  sourceReference?: number;
}

export interface SetBreakpointsArguments {
  source: Source;
  breakpoints?: SourceBreakpoint[];
}

export interface SetBreakpointsResponse {
  breakpoints: Breakpoint[];
}

// === Stack Frames ===

export interface StackFrame {
  id: number;
  name: string;
  source?: Source;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  moduleId?: number | string;
}

export interface StackTraceArguments {
  threadId: number;
  startFrame?: number;
  levels?: number;
}

export interface StackTraceResponse {
  stackFrames: StackFrame[];
  totalFrames?: number;
}

// === Scopes and Variables ===

export interface Scope {
  name: string;
  variablesReference: number;
  expensive: boolean;
  namedVariables?: number;
  indexedVariables?: number;
}

export interface ScopesArguments {
  frameId: number;
}

export interface ScopesResponse {
  scopes: Scope[];
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  namedVariables?: number;
  indexedVariables?: number;
}

export interface VariablesArguments {
  variablesReference: number;
  start?: number;
  count?: number;
}

export interface VariablesResponse {
  variables: Variable[];
}

// === Threads ===

export interface Thread {
  id: number;
  name: string;
}

export interface ThreadsResponse {
  threads: Thread[];
}

// === Launch / Attach ===

export interface LaunchRequestArguments {
  noDebug?: boolean;
  [key: string]: any;
}

export interface AttachRequestArguments {
  [key: string]: any;
}

// === Events ===

export interface StoppedEventBody {
  reason: 'step' | 'breakpoint' | 'exception' | 'pause' | 'entry' | 'goto' | 'function breakpoint' | 'data breakpoint';
  description?: string;
  threadId?: number;
  text?: string;
  allThreadsStopped?: boolean;
}

export interface TerminatedEventBody {
  restart?: boolean;
}

export interface OutputEventBody {
  category?: 'console' | 'stdout' | 'stderr' | 'telemetry';
  output: string;
  source?: Source;
  line?: number;
  column?: number;
}

export interface BreakpointEventBody {
  reason: 'changed' | 'new' | 'removed';
  breakpoint: Breakpoint;
}

// === Capabilities ===

export interface Capabilities {
  supportsConfigurationDoneRequest?: boolean;
  supportsFunctionBreakpoints?: boolean;
  supportsConditionalBreakpoints?: boolean;
  supportsHitConditionalBreakpoints?: boolean;
  supportsLogPoints?: boolean;
  supportsStepBack?: boolean;
  supportsRestartFrame?: boolean;
  supportsRestartRequest?: boolean;
  supportsTerminateRequest?: boolean;
}
