export class CommandSyntaxError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CommandSyntaxError";
  }
}

const MAX_COMMAND_BYTES = 16 * 1024;
const MAX_ARGUMENTS = 256;
const SHELL_OPERATOR = /[&|;<>()>]/u;

export function parseCommand(command: string): readonly string[] {
  if (Buffer.byteLength(command, "utf8") > MAX_COMMAND_BYTES) {
    throw new CommandSyntaxError("command length exceeds 16 KiB");
  }
  if (command.includes("\0") || /[\r\n]/u.test(command)) {
    throw new CommandSyntaxError("command must be one line without null bytes");
  }
  if (command.includes("$(") || command.includes("`")) {
    throw new CommandSyntaxError("shell substitution syntax is not supported");
  }

  const argumentsValue: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let tokenStarted = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) break;
    if (quote) {
      if (character === quote) {
        quote = undefined;
        tokenStarted = true;
      } else if (character === "\\" && quote === '"') {
        const next = command[index + 1];
        if (next === undefined) throw new CommandSyntaxError("command ends with an escape");
        if (next === '"' || next === "\\") {
          current += next;
          index += 1;
        } else {
          current += character;
        }
        tokenStarted = true;
      } else {
        current += character;
        tokenStarted = true;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/u.test(character)) {
      if (tokenStarted) {
        argumentsValue.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }
    if (SHELL_OPERATOR.test(character)) {
      throw new CommandSyntaxError(`shell operator ${JSON.stringify(character)} is not supported`);
    }
    if (character === "\\") {
      const next = command[index + 1];
      if (next === undefined) throw new CommandSyntaxError("command ends with an escape");
      if (/\s/u.test(next) || next === "\\" || next === "'" || next === '"') {
        current += next;
        tokenStarted = true;
        index += 1;
      } else {
        current += character;
        tokenStarted = true;
      }
      continue;
    }
    current += character;
    tokenStarted = true;
  }

  if (quote) throw new CommandSyntaxError("command has an unterminated quote");
  if (tokenStarted) argumentsValue.push(current);
  if (argumentsValue.length === 0) throw new CommandSyntaxError("command is empty");
  if (argumentsValue.length > MAX_ARGUMENTS) {
    throw new CommandSyntaxError(`command argument count exceeds ${MAX_ARGUMENTS}`);
  }
  return argumentsValue;
}
