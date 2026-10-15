export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, string | number | boolean | null>;

const rank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
};

export function createLogger(level: LogLevel): Logger {
  function write(entryLevel: LogLevel, message: string, fields?: LogFields) {
    if (rank[entryLevel] < rank[level]) {
      return;
    }

    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: entryLevel,
      message: scrub(message),
      ...scrubFields(fields),
    });

    if (entryLevel === 'error' || entryLevel === 'warn') {
      console.error(line);
      return;
    }

    console.log(line);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export function scrub(value: string): string {
  return value.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://[redacted]');
}

function scrubFields(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(fields).map(([key, fieldValue]) => [
      key,
      typeof fieldValue === 'string' ? scrub(fieldValue) : fieldValue,
    ]),
  );
}
