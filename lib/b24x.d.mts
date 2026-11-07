type Q = (sql: string, params?: unknown[]) => Promise<any[]>
export function b24on(): boolean
export function setGap(ms: number): void
export function rest(method: string, params?: Record<string, unknown>): Promise<any>
export function stagesOf(cat: number): Promise<{ id: string; name: string }[]>
export function enqueueSync(q: Q, clientId: string, note?: string): Promise<number | null>
export function enqueueCall(q: Q, method: string, params: unknown): Promise<number | null>
export function processJob(q: Q, id: number): Promise<boolean | null>
export function runQueue(q: Q, deadline: number): Promise<{ ok: number; fail: number }>
export function pull(q: Q, out?: Record<string, unknown>): Promise<Record<string, unknown>>
export function enqueueTask(q: Q, clientId: string, title: string, description: string, who?: string): Promise<number | null>
export function enqueueApp(q: Q, appId: string, note?: string): Promise<number | null>
export function enqueuePrivacy(q: Q, params: unknown): Promise<number | null>
