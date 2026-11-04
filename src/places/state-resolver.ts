export interface CatalogState {
    id: string;
    name: string;
}
export const normalize = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export type Resolution = {
    kind: 'state';
    state: CatalogState;
} | {
    kind: 'ambiguous' | 'unrecognized' | 'general';
};
export function resolveState(message: string, states: CatalogState[]): Resolution {
    const text = ` ${normalize(message)} `;
    const matches = states.filter(s => text.includes(` ${normalize(s.name)} `));
    const longest = matches.filter(s => !matches.some(o => o !== s && normalize(o.name).includes(normalize(s.name))));
    if (longest.length > 1 || (longest.length && /\b(no|sin|excepto|menos|evitar)\b/.test(text)))
        return { kind: 'ambiguous' };
    if (longest.length === 1)
        return { kind: 'state', state: longest[0] };
    return { kind: /\b(mexico|estado)\b/.test(text) ? 'unrecognized' : 'general' };
}

/** Follow only a contiguous chain of recognized continuations, bounded to 12 turns. */
export function resolveHistoryState(message: string, history: {role:string;content:string}[], states: CatalogState[]): Resolution {
    const continues = (text: string) => /^(y |y$|cuales|que otros|mas lugares|arma mi itinerario|como llegar)/.test(normalize(text))
        || /\b(alli|ahi|en ese estado|en el mismo estado|de esos|de esas|de los anteriores|de las anteriores)\b/.test(normalize(text));
    if (!continues(message)) return {kind:'general'};
    const users = history.slice(-12).filter(t => t.role === 'user').reverse();
    for (const turn of users) {
        const resolution = resolveState(turn.content, states);
        if (resolution.kind !== 'general') return resolution;
        if (!continues(turn.content)) break;
    }
    return {kind:'general'};
}
