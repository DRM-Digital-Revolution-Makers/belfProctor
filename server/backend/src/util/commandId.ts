const COMMAND_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function isSafeCommandId(value: unknown): boolean {
  const id = String(value || "");
  return COMMAND_ID_PATTERN.test(id) && !id.includes("..");
}
