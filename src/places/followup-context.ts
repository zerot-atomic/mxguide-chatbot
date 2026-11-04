import { PlaceSummary } from './places.service';

/** History can only narrow a fresh catalogue selection, never create records. */
export function previousRecommendationIds(history: {role: string;content: string}[], candidates: PlaceSummary[]): Set<string> | null {
  const recent = history.slice(-12);
  const lastUser = recent.map(t => t.role).lastIndexOf('user');
  const previousReply = recent.slice(lastUser + 1).filter(t => t.role === 'assistant').at(-1)?.content;
  if (lastUser < 0 || !previousReply) return null;
  const lines = previousReply.slice(0, 4000).split('\n').filter(line => /^(?:- |[1-5]\. )/.test(line)).slice(0, 6);
  if (!lines.length || lines.length > 5) return null;
  const ids = new Set<string>();
  for (const rawLine of lines) {
    const line = rawLine.replace(/^[1-5]\. /, '- ');
    const matches = candidates.filter(p => {
      const prefix = '- ' + p.name.replace(/[\r\n\t]/g, ' ').replace(/[<>*_`\[\]\\]/g, c => '\\' + c);
      return line === prefix || [': ', ' (', ' · a '].some(separator => line.startsWith(prefix + separator));
    });
    // Stale/unmatched items are omitted; ambiguous names require clarification.
    if (matches.length > 1) return null;
    if (matches.length === 1) ids.add(matches[0].id);
  }
  return ids;
}
