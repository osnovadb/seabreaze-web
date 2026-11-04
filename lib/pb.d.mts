type Q = (sql: string, params?: unknown[]) => Promise<any[]>
type Tx = (fn: (db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> }) => Promise<unknown>) => Promise<unknown>
export function pbClient(src: { id: string; config: any }, q: Q): { get: (p: string, params?: Record<string, unknown>) => Promise<any>; post: (p: string, body: unknown) => Promise<any> }
export function pbSync(q: Q, tx: Tx, src: { id: string; config: any }, opts?: { full?: boolean; notify?: (...a: any[]) => Promise<unknown> }): Promise<{ ok: boolean; error?: string; checked: number; changed: number; created: number; gone: number; floors: number; statuses: number; errors: string[]; unmatched: string[] }>
export function pbFlush(q: Q, sources: { id: string; config: any }[], opts?: { task?: (...a: any[]) => Promise<unknown> }): Promise<number>
