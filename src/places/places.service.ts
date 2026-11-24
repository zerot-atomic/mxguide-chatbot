import { directItinerary, foodItinerary, isItineraryContinuation, itineraryContext, moreRequest, withoutLeadIns } from './itinerary';
import { previousRecommendationIds } from './followup-context';
import { readBoundedJson, hasExternalReference } from '../common/external-data';
import { Intent, classifyIntent, categoryNames, matchesIntent } from './tourism-intent';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig, logEnabled } from '../config/env';
import { CatalogState, normalize, resolveState, resolveHistoryState } from './state-resolver';
import { isShortContinuation, mentionsKnownState } from './state-hints';
import { RequestedPlaceType, detectRequestedType, hasTypeEvidence } from './place-types';
import { ITINERARY_CANDIDATE_LIMIT } from './itinerary-plan';
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
export type CatalogStatus = 'found' | 'empty' | 'ambiguous' | 'unrecognized' | 'missing-location' | 'http' | 'timeout' | 'connection' | 'malformed' | 'unconfigured' | 'categories-unavailable' | 'intent-ambiguous' | 'followup-ambiguous' | 'itinerary-missing-state' | 'itinerary-food-unverified' | 'conversation' | 'type-unverified' | 'exhausted' | 'itinerary-days-out-of-range';
export interface CatalogContext {
    status: CatalogStatus;
    mode: 'state' | 'nearby' | 'featured';
    places: PlaceSummary[];
    state?: CatalogState;
    intent?: Intent;
    itinerary?: boolean;
    /** Días pedidos para el itinerario (1–7), si el usuario los indicó. */
    itineraryDays?: number;
    /** Se pidió una duración fuera de rango (no se reemplaza por otra). */
    itineraryDaysOutOfRange?: boolean;
    /** Tipo de lugar pedido que no es categoría del catálogo (playas, cenotes…). */
    requestedType?: RequestedPlaceType;
}
const TTL = 600000;
/** Palabras que piden destinos concretos; sin ellas (ni estado, intención o cercanía) el mensaje es conversación general. */
const TOURISM_REQUEST = /\b(lugares?|sitios?|destinos?|atractivos?|atracciones|visitar|conocer|recomienda\w*|recomendacion\w*|sugiere\w*|sugerencias?|que (?:hacer|ver|visitar)|a donde ir|donde ir|pueblos? magicos?|playas?|tours?|paseos?|turistic\w*)\b/;
/** Seguimiento sobre la lista anterior; los «¿y…?» se resuelven con el historial (resolveHistoryState). */
const FOLLOWUP_REQUEST = /\b(de esos|de esas|de los anteriores|de las anteriores)\b/;
/** Señal léxica de consulta turística; el estado mencionado se evalúa aparte con el catálogo de estados. */
export function hasTourismSignal(message: string, intent: Intent, itinerary: boolean): boolean {
    const text = normalize(message);
    return intent !== 'general' || itinerary || TOURISM_REQUEST.test(text) || FOLLOWUP_REQUEST.test(text) || /\b(cerca de mi|cercanos|cercanas)\b/.test(text);
}
const obj = (r: unknown): Record<string, unknown> | undefined => r !== null && typeof r === 'object' && !Array.isArray(r) ? r as Record<string, unknown> : undefined;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
class CatalogError extends Error {
    constructor(readonly status: CatalogStatus) { super(status); }
}
@Injectable()
export class PlacesService {
    private readonly logger = new Logger(PlacesService.name);
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
        // Las muletillas iniciales («No, mejor…») no deben leerse como exclusiones de estado o de categoría.
        const content = withoutLeadIns(message);
        let intent = classifyIntent(content);
        const itinerary = itineraryContext(message, history);
        const detectedType = detectRequestedType(message);
        const requestedType = detectedType === 'multiple' ? undefined : detectedType;
        const signal = hasTourismSignal(message, intent, itinerary.itinerary) || detectedType !== undefined;
        const more = moreRequest(message);
        const continuation = isShortContinuation(message) || more;
        // Sin señal, sin posible estado y sin continuación: es conversación y no se consulta /states.
        if (!signal && !continuation && !mentionsKnownState(message)) return { status: 'conversation', mode, places: [] };
        try {
            if (!this.config.mxguideApiUrl)
                throw new CatalogError('unconfigured');
            let states: CatalogState[];
            try { states = await this.getStates(); }
            catch (error) {
                // Sin catálogo, una charla general sigue siendo posible; una consulta turística recibe el aviso.
                if (!signal) return { status: 'conversation', mode, places: [] };
                throw error;
            }
            let resolution = resolveState(content, states);
            const explicitState = resolution.kind === 'state';
            const nearby = /\b(cerca de mi|cercanos|cercanas|mas lugares cerca)\b/.test(normalize(message));
            if (resolution.kind === 'general' && !nearby) resolution = resolveHistoryState(message, history, states, itinerary.itinerary || continuation, isItineraryContinuation, withoutLeadIns);
            // El estado heredado del historial solo aplica a continuaciones cortas o a mensajes con señal turística.
            if (!signal && !(resolution.kind === 'state' && (explicitState || continuation))) return { status: 'conversation', mode, places: [] };
            if (resolution.kind === 'ambiguous' || resolution.kind === 'unrecognized')
                return { status: resolution.kind, mode, places: [] };
            if (itinerary.itinerary && intent === 'general') intent = (!explicitState || !directItinerary(message) ? itinerary.inheritedIntent : undefined) ?? 'attractions';
            if (itinerary.itinerary && resolution.kind !== 'state') return {status:'itinerary-missing-state', mode, intent, places:[]};
            if (itinerary.itinerary && (['gastronomy','restaurants','dishes'].includes(intent) || foodItinerary(message))) return {status:'itinerary-food-unverified', mode, intent, places:[]};
            // Más de 7 días: se pide una duración válida (sin lista ni duración inventada). Se conserva el estado
            // resuelto para el aviso; el siguiente mensaje («perdón, mejor 5 días») lo hereda del historial.
            if (itinerary.itinerary && itinerary.duration.outOfRange) return { status: 'itinerary-days-out-of-range', mode: 'state', state: resolution.kind === 'state' ? resolution.state : undefined, intent, itinerary: true, itineraryDaysOutOfRange: true, places: [] };
            if (resolution.kind === 'state') {
                mode = 'state';
                state = resolution.state;
            }
            else if (nearby || location)
                mode = 'nearby';
            if (mode === 'nearby' && (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180))
                return { status: 'missing-location', mode, places: [] };
            if (intent === 'ambiguous' || detectedType === 'multiple') return { status: 'intent-ambiguous', mode, state, intent, places: [] };
            let raw: unknown[];
            if (mode === 'featured' && this.featuredCache && Date.now() - this.featuredCache.at < TTL)
                raw = this.featuredCache.value;
            else {
                // Retrieval sample and final AI candidate limit are deliberately separate.
                const stateFetchLimit = intent === 'general' && !requestedType ? 15 : 100;
                const path = state ? `/places?${new URLSearchParams({ stateId: state.id, limit: String(stateFetchLimit) })}` : mode === 'nearby'
                    ? `/places/nearby?${new URLSearchParams({ lat: String(location!.lat), lng: String(location!.lng), radius: '50', limit: '10' })}` : '/places/featured?limit=20';
                raw = await this.fetchArray(path);
                if (state && (intent !== 'general' || requestedType)) raw = raw.slice(0, stateFetchLimit);

            }
            {
                let candidates = raw.filter(p => !state || obj(p)?.stateId === state.id).map(p => PlacesService.toSummary(p, states)).filter((p): p is PlaceSummary => p !== null);
                if (raw.length && !candidates.length)
                    throw new CatalogError('malformed');
                if (mode === 'featured' && (!this.featuredCache || Date.now() - this.featuredCache.at >= TTL)) this.featuredCache = { at: Date.now(), value: raw };
                if (!requestedType && intent !== 'general' && raw.length && !raw.some(p => categoryNames(p).length)) return { status: 'categories-unavailable', mode, state, intent, places: [] };
                if (/\b(de esos|de esas|de los anteriores|de las anteriores)\b/.test(normalize(message))) {
                    const previousIds = previousRecommendationIds(history, candidates);
                    if (!previousIds) return { status: 'followup-ambiguous', mode, state, intent, places: [] };
                    candidates = candidates.filter(p => previousIds.has(p.id));
                    const allowedIds = new Set(candidates.map(p => p.id));
                    raw = raw.filter(p => allowedIds.has(obj(p)?.id as string));
                }
                if (more) {
                    // «¿Qué más?»: excluir lo ya mostrado en la respuesta anterior (identificado por nombre exacto).
                    const shown = previousRecommendationIds(history, candidates);
                    if (shown && shown.size) {
                        raw = raw.filter(p => !shown.has(obj(p)?.id as string));
                        // Ya se mostró todo lo que coincide: se dice así, sin repetir ni recurrir a otros estados.
                        const remaining = raw.filter(p => (!state || obj(p)?.stateId === state.id) && (requestedType ? PlacesService.matchesRequestedType(p, requestedType, intent) : matchesIntent(p, intent)));
                        if (!remaining.length) return { status: 'exhausted', mode, state, intent, itinerary: itinerary.itinerary, itineraryDays: itinerary.duration.days, places: [] };
                    }
                }
                candidates = raw.filter(p => (!state || obj(p)?.stateId === state.id) && (requestedType ? PlacesService.matchesRequestedType(p, requestedType, intent) : matchesIntent(p, intent)) && (!itinerary.itinerary || intent === 'lodging' || !categoryNames(p).some(name => ['hospedaje','gastronomia'].includes(normalize(name))))).map(p => PlacesService.toSummary(p, states)).filter((p): p is PlaceSummary => p !== null);
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
                // Itinerario por días: más candidatos (30) para cubrir hasta 21 paradas; siempre del estado ya filtrado.
                const plannedItinerary = itinerary.itinerary && itinerary.duration.days !== undefined && mode === 'state';
                const places = [...unique.values()].slice(0, mode === 'nearby' ? 10 : mode === 'state' ? (plannedItinerary ? ITINERARY_CANDIDATE_LIMIT : 15) : 20);
                if (requestedType && !places.length) return { status: 'type-unverified', mode, state, intent, requestedType, itinerary: itinerary.itinerary, itineraryDays: itinerary.duration.days, places: [] };
                return { status: places.length ? 'found' : 'empty', mode, state, intent, requestedType, itinerary: itinerary.itinerary, itineraryDays: itinerary.duration.days, itineraryDaysOutOfRange: itinerary.duration.outOfRange, places };
            }

        }
        catch (error) {
            if (error instanceof CatalogError && error.status === 'unconfigured' && !signal) return { status: 'conversation', mode, places: [] };
            return { status: error instanceof CatalogError ? error.status : 'malformed', mode, state, places: [] };
        }
    }
    /**
     * Tipo sin categoría: solo registros cuyo texto lo menciona. Si además se pidió hospedaje o gastronomía
     * («hoteles de playa»), debe cumplir esa categoría; si no, se excluyen registros que solo son hospedaje
     * o gastronomía (un «Hotel Playa Azul» no es una playa).
     */
    static matchesRequestedType(raw: unknown, type: RequestedPlaceType, intent: Intent): boolean {
        if (!hasTypeEvidence(raw, type)) return false;
        if (intent !== 'general' && intent !== 'attractions') return matchesIntent(raw, intent);
        const names = categoryNames(raw).map(normalize);
        return !(names.length > 0 && names.every(name => ['hospedaje', 'gastronomia'].includes(name)));
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
        try {
            return await this.fetchArrayUnlogged(path);
        }
        catch (error) {
            // Solo el endpoint (sin query: puede llevar coordenadas) y el estado técnico.
            if (error instanceof CatalogError && logEnabled(this.config, 'warn')) this.logger.warn(`Catálogo ${path.split('?')[0]}: ${error.status}`);
            throw error;
        }
    }
    private async fetchArrayUnlogged(path: string): Promise<unknown[]> {
        let response: Response;
        try {
            response = await fetch(`${this.config.mxguideApiUrl}${path}`, { redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(this.config.placesTimeoutMs) });
        }
        catch (error) {
            throw new CatalogError(obj(error)?.name === 'TimeoutError' ? 'timeout' : 'connection');
        }
        if (!response.ok) { await response.body?.cancel(); if (logEnabled(this.config, 'warn')) this.logger.warn(`Catálogo ${path.split('?')[0]}: HTTP ${response.status}`); throw new CatalogError('http'); }
        let data: unknown;
        try {
            data = await readBoundedJson(response, 2 * 1024 * 1024);
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
        if (!p || !validId(p.id) || typeof p.name !== 'string' || !p.name.trim() || hasExternalReference(p.name))
            return null;
        const nested = obj(p.state)?.name;
        const state = states.find(s => s.id === p.stateId)?.name ?? (typeof nested === 'string' ? nested : '');
        const category = categoryNames(p).join(' · ');
        const distance = p.distanceKm;
        return { id: p.id, name: p.name.slice(0, 120), state: hasExternalReference(state) ? '' : state, category: typeof category === 'string' && !hasExternalReference(category) ? category : '', description: typeof p.shortDescription === 'string' && !hasExternalReference(p.shortDescription) ? p.shortDescription.slice(0, 240) : '', distanceKm: typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 ? distance : undefined };
    }
}
