export type ErrorCode =
  | 'NOT_FOUND'
  | 'MULTIPLE_MATCHES'
  | 'NOT_VISIBLE'
  | 'INTERCEPTED'
  | 'DETACHED'
  | 'TIMEOUT'
  | 'FRAME_NOT_FOUND'
  | 'UNKNOWN';

/** Error carrying a stable code + structured details for the MCP response. */
export class ActionError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    this.details = details;
  }
}

interface Classified {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
}

/** Map any thrown error to a stable code + details. */
export function classifyError(err: unknown): Classified {
  if (err instanceof ActionError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';

  if (name === 'TimeoutError' || /Timeout.*exceeded|exceeded.*timeout/i.test(message)) {
    const m = message.match(/(\d+)\s*ms/);
    return {
      code: 'TIMEOUT',
      message,
      details: m ? { timeout_ms: parseInt(m[1], 10) } : {},
    };
  }
  if (/intercepts pointer events|intercept the pointer/i.test(message)) {
    return { code: 'INTERCEPTED', message, details: {} };
  }
  if (/detached|not attached|Node is detached|element is not attached/i.test(message)) {
    return { code: 'DETACHED', message, details: {} };
  }
  if (/frame (was )?(not found|detached)|no frame|frame got detached/i.test(message)) {
    return { code: 'FRAME_NOT_FOUND', message, details: {} };
  }
  return { code: 'UNKNOWN', message, details: {} };
}
