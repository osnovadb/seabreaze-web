export function bestOffer<O extends { building_id: string | null; unit_ids: string[] | null; kind: 'pct' | 'fixed'; value: number; currency: string | null }>(
  u: { id: string; building_id: string; usd: number | null; price: number | null; currency: string }, offers: O[]): { offer: O; usd: number } | null
