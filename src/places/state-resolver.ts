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
