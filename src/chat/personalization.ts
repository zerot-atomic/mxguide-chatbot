/** Display-only personalization: never used in prompts, queries or IDs. */
export function personalizeReply(reply: string, userName?: string): string {
  if (typeof userName !== 'string' || userName.length > 60) return reply;
  const name = userName.trim();
  if (!name || !/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(name) || name.split(' ').length > 6) return reply;
  return `¡Hola, ${name}! ${reply}`;
}
