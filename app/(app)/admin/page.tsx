import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
export default async function AdminIndex() {
  const c = await requireCtx()
  redirect(c.user.role === 'owner' ? '/admin/users' : c.user.role === 'finance' ? '/admin/conditions' : '/admin/agents')
}
