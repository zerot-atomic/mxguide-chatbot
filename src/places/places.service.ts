import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';

/** Un lugar resumido, listo para mandarlo al modelo y a la app. */
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

const FEATURED_TTL_MS = 10 * 60 * 1000;

/**
 * Trae lugares del backend principal de MXGuide para que el bot recomiende
 * lugares que SÍ existen en la app (y la app pueda mostrarlos como tarjetas).
 * Si el backend está dormido o falla, el chat sigue funcionando sin este contexto.
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private featuredCache?: { at: number; places: PlaceSummary[] };

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async getContext(location?: Coordinates): Promise<PlaceSummary[]> {
    if (!this.config.mxguideApiUrl) return [];
    try {
      if (location) {
        const query = new URLSearchParams({
          lat: String(location.lat),
          lng: String(location.lng),
          radius: '50',
          limit: '10',
        });
        return await this.fetchPlaces(`/places/nearby?${query}`);
      }
      return await this.getFeatured();
    } catch (error) {
      this.logger.warn(`No se pudieron cargar lugares: ${(error as Error).message}`);
      return [];
    }
  }

  private async getFeatured(): Promise<PlaceSummary[]> {
    const cached = this.featuredCache;
    if (cached && Date.now() - cached.at < FEATURED_TTL_MS) return cached.places;
    const places = await this.fetchPlaces('/places/featured?limit=20');
    this.featuredCache = { at: Date.now(), places };
    return places;
  }

  private async fetchPlaces(path: string): Promise<PlaceSummary[]> {
    const response = await fetch(`${this.config.mxguideApiUrl}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.config.placesTimeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} en ${path}`);
    const data: unknown = await response.json();
    return Array.isArray(data) ? data.map(PlacesService.toSummary).filter((p): p is PlaceSummary => p !== null) : [];
  }

  /** Convierte un lugar de la API de MXGuide al formato corto. */
  static toSummary(raw: unknown): PlaceSummary | null {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.name !== 'string') return null;

    const state = p.state && typeof p.state === 'object' ? (p.state as Record<string, unknown>).name : undefined;
    const firstCategory = Array.isArray(p.categories) ? (p.categories[0] as Record<string, unknown> | undefined) : undefined;
    const category =
      firstCategory && typeof firstCategory.category === 'object' && firstCategory.category
        ? (firstCategory.category as Record<string, unknown>).name
        : undefined;
    const distance = Number(p.distanceKm);

    return {
      id: p.id,
      name: p.name.slice(0, 120),
      state: typeof state === 'string' ? state : '',
      category: typeof category === 'string' ? category : '',
      description: typeof p.shortDescription === 'string' ? p.shortDescription.slice(0, 240) : '',
      distanceKm: Number.isFinite(distance) ? Math.round(distance * 10) / 10 : undefined,
    };
  }
}
