type LogLevel = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "DEBUG";

const COLORS: Record<LogLevel, string> = {
  INFO: "color:#5fb8ff;font-weight:600",
  SUCCESS: "color:#3ecf6e;font-weight:600",
  WARNING: "color:#ffbd2e;font-weight:600",
  ERROR: "color:#ff6464;font-weight:600",
  DEBUG: "color:#9ca3af;font-weight:600",
};

function write(level: LogLevel, module: string, message: string, data?: unknown) {
  const time = new Date().toISOString();
  const prefix = `%c[${level}]%c ${time} [${module}] ${message}`;
  const args: unknown[] = [prefix, COLORS[level], "color:inherit"];
  if (data !== undefined) args.push(data);
  const target = level === "ERROR" ? console.error : level === "WARNING" ? console.warn : console.log;
  target(...args);
}

export const logger = {
  info: (module: string, message: string, data?: unknown) => write("INFO", module, message, data),
  success: (module: string, message: string, data?: unknown) => write("SUCCESS", module, message, data),
  warning: (module: string, message: string, data?: unknown) => write("WARNING", module, message, data),
  error: (module: string, message: string, data?: unknown) => write("ERROR", module, message, data),
  debug: (module: string, message: string, data?: unknown) => write("DEBUG", module, message, data),
};
