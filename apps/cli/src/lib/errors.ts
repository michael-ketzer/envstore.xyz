// Typed CLI errors so commands can throw with structured exit codes/messages.
// `main` catches CliError and prints cleanly; other errors get a stack trace.

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5;

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly hint?: string;

  constructor(message: string, opts?: { exitCode?: ExitCode; hint?: string }) {
    super(message);
    this.name = 'CliError';
    this.exitCode = opts?.exitCode ?? 1;
    this.hint = opts?.hint;
  }
}

export class UsageError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, { exitCode: 2, hint });
    this.name = 'UsageError';
  }
}

export class AuthRequiredError extends CliError {
  constructor() {
    super('Not signed in.', {
      exitCode: 3,
      hint: 'Run `envstore login` first.',
    });
    this.name = 'AuthRequiredError';
  }
}

export class ApiError extends CliError {
  readonly status: number;
  constructor(message: string, status: number, hint?: string) {
    super(message, { exitCode: 4, hint });
    this.status = status;
    this.name = 'ApiError';
  }
}
