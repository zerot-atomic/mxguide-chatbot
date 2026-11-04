import { Intent, classifyIntent, categoryNames, matchesIntent } from './tourism-intent';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { CatalogState, normalize, resolveState } from './state-resolver';
export interface PlaceSummary {
    id: string;
    name: string;
    state: string;
    category: string;
    description: string;
    distanceKm?: number;
}
export interface Coordinates {
    lat: number;
    lng: number;
}
export type CatalogStatus = 'found' | 'empty' | 'ambiguous' | 'unrecognized' | 'missing-location' | 'http' | 'timeout' | 'connection' | 'malformed' | 'unconfigured' | 'categories-unavailable' | 'intent-ambiguous';
export interface CatalogContext {
    status: CatalogStatus;
    mode: 'state' | 'nearby' | 'featured';
    places: PlaceSummary[];
    state?: CatalogState;
    intent?: Intent;
}
const TTL = 600000;
const obj = (r: unknown): Record<string, unknown> | undefined => r !== null && typeof r === 'object' && !Array.isArray(r) ? r as Record<string, unknown> : undefined;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
class CatalogError extends Error {
    constructor(readonly status: CatalogStatus) { super(status); }
}
@Injectable()
export class PlacesService {
    private statesCache?: {
        at: number;
        value: CatalogState[];
    };
    private statesPending?: Promise<CatalogState[]>;
    private featuredCache?: {
        at: number;
        value: unknown[];
    };
    constructor(
    @Inject(APP_CONFIG)
    private readonly config: AppConfig) { }
    async getContext(location?: Coordinates, message = '', history: {
        role: string;
        content: string;
    }[] = []): Promise<CatalogContext> {
        let mode: CatalogContext['mode'] = 'featured';
        let state: CatalogState | undefined;
        const intent = classifyIntent(message);
        try {
            if (!this.config.mxguideApiUrl)
                throw new CatalogError('unconfigured');
            const states = await this.getStates();
            let resolution = resolveState(message, states);
            const nearby = /\b(cerca de mi|cercanos|cercanas|mas lugares cerca)\b/.test(normalize(message));
            if (resolution.kind === 'general' && !nearby && /^(y |y$|cuales|que otros|mas lugares|arma mi itinerario|como llegar)/.test(normalize(message))) {
                const previous = history.slice(-12).filter(t => t.role === 'user').at(-1);
                if (previous)
                    resolution = resolveState(previous.content, states);
            }
            if (resolution.kind === 'ambiguous' || resolution.kind === 'unrecognized')
                return { status: resolution.kind, mode, places: [] };
            if (resolution.kind === 'state') {
                mode = 'state';
                state = resolution.state;
            }
            else if (nearby || location)
                mode = 'nearby';
            if (mode === 'nearby' && (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180))
                return { status: 'missing-location', mode, places: [] };
            if (intent === 'ambiguous') return { status: 'intent-ambiguous', mode, state, intent, places: [] };
            let raw: unknown[];
            if (mode === 'featured' && this.featuredCache && Date.now() - this.featuredCache.at < TTL)
                raw = this.featuredCache.value;
            else {
                // Retrieval sample and final AI candidate limit are deliberately separate.
                const stateFetchLimit = intent === 'general' ? 15 : 100;
                const path = state ? `/places?${new URLSearchParams({ stateId: state.id, limit: String(stateFetchLimit) })}` : mode === 'nearby'
                    ? `/places/nearby?${new URLSearchParams({ lat: String(location!.lat), lng: String(location!.lng), radius: '50', limit: '10' })}` : '/places/featured?limit=20';
                raw = await this.fetchArray(path);
                if (state && intent !== 'general') raw = raw.slice(0, stateFetchLimit);

            }
            {
                let candidates = raw.filter(p => !state || obj(p)?.stateId === state.id).map(p => PlacesService.toSummary(p, states)).filter((p): p is PlaceSummary => p !== null);
                if (raw.length && !candidates.length)
                    throw new CatalogError('malformed');
                if (mode === 'featured' && (!this.featuredCache || Date.now() - this.featuredCache.at >= TTL)) this.featuredCache = { at: Date.now(), value: raw };
                if (intent !== 'general' && raw.length && !raw.some(p => categoryNames(p).length)) return { status: 'categories-unavailable', mode, state, intent, places: [] };
                candidates = raw.filter(p => (!state || obj(p)?.stateId === state.id) && matchesIntent(p, intent)).map(p => PlacesService.toSummary(p, states)).filter((p): p is PlaceSummary => p !== null);
                if (mode === 'nearby') {
                    const hadMatches = candidates.length > 0;
                    candidates = candidates.filter(p => p.distanceKm !== undefined).sort((a, b) => a.distanceKm! - b.distanceKm! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
                    if (hadMatches && !candidates.length)
                        throw new CatalogError('malformed');
                }
                // Sorting before deduplication retains the smallest valid distance for each ID.
                const unique = new Map<string, PlaceSummary>();
                for (const p of candidates)
                    if (!unique.has(p.id))
                        unique.set(p.id, p);
                const places = [...unique.values()].slice(0, mode === 'nearby' ? 10 : mode === 'state' ? 15 : 20);
                return { status: places.length ? 'found' : 'empty', mode, state, intent, places };
            }

        }
        catch (error) {
            return { status: error instanceof CatalogError ? error.status : 'malformed', mode, state, places: [] };
        }
    }
    private async getStates(): Promise<CatalogState[]> {
        if (this.statesCache && Date.now() - this.statesCache.at < TTL)
            return this.statesCache.value;
        if (this.statesPending)
            return this.statesPending;
        this.statesPending = (async () => {
            const raw = await this.fetchArray('/states');
            if (!raw.length || raw.some(s => !validId(obj(s)?.id) || typeof obj(s)?.name !== 'string' || !(obj(s)!.name as string).trim()))
                throw new CatalogError('malformed');
            const value = raw.map(s => ({ id: obj(s)!.id as string, name: obj(s)!.name as string }));
            this.statesCache = { at: Date.now(), value };
            return value;
        })();
        try {
            return await this.statesPending;
        }
        finally {
            this.statesPending = undefined;
        }
    }
    private async fetchArray(path: string): Promise<unknown[]> {
        let response: Response;
        try {
            response = await fetch(`${this.config.mxguideApiUrl}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.config.placesTimeoutMs) });
        }
        catch (error) {
            throw new CatalogError(obj(error)?.name === 'TimeoutError' ? 'timeout' : 'connection');
        }
        if (!response.ok)
            throw new CatalogError('http');
        let data: unknown;
        try {
            data = await response.json();
        }
        catch (error) {
            throw new CatalogError(obj(error)?.name === 'TimeoutError' ? 'timeout' : 'malformed');
        }
        if (!Array.isArray(data))
            throw new CatalogError('malformed');
        return data;
    }
    static toSummary(raw: unknown, states: CatalogState[] = []): PlaceSummary | null {
        const p = obj(raw);
        if (!p || !validId(p.id) || typeof p.name !== 'string' || !p.name.trim())
            return null;
        const nested = obj(p.state)?.name;
        const state = states.find(s => s.id === p.stateId)?.name ?? (typeof nested === 'string' ? nested : '');
        const category = categoryNames(p).join(' · ');
        const distance = p.distanceKm;
        return { id: p.id, name: p.name.slice(0, 120), state, category: typeof category === 'string' ? category : '', description: typeof p.shortDescription === 'string' ? p.shortDescription.slice(0, 240) : '', distanceKm: typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 ? distance : undefined };
    }
}
