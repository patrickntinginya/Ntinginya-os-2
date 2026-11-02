import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import ErrorState from '../ui/ErrorState'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'
import PostCard from './PostCard'
import ReportDialog from './ReportDialog'
import { Users } from 'lucide-react'
import { blockUser, deletePost, fetchPosts, signedUrls } from '../../services/community'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

/**
 * A paginated list of posts. `scope`: feed | trending | group | mine | post (needs `postId`). `refreshKey` changes when the parent posted something new.
 * Media is signed in one batch per page (private bucket), not one request per image.
 */
export default function Feed({ scope, groupId, postId, search, me, refreshKey, emptyText }) {
  const [rows, setRows] = useState([])
  const [paging, setPaging] = useState({ cursor: null, offset: 0, more: false })
  const [urls, setUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [report, setReport] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [toBlock, setToBlock] = useState(null)
  const req = useRef(0)

  const attachUrls = useCallback(async (list) => {
    const paths = list.flatMap((p) => [p.media_path, p.author_avatar]).filter(Boolean)
    if (!paths.length) return
    try { const m = await signedUrls(paths); setUrls((u) => ({ ...u, ...m })) } catch { /* posts still show; media shows a placeholder */ }
  }, [])

  // Signed URLs live 15 minutes (see services/community.js). Re-sign every 10 minutes while the list is open, and when the tab becomes visible again.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  useEffect(() => {
    const resign = () => { if (rowsRef.current.length) attachUrls(rowsRef.current) }
    const id = setInterval(resign, 10 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') resign() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [attachUrls])

  const load = useCallback(async () => {
    const mine = ++req.current
    setLoading(true)
    try {
      const page = await fetchPosts({ scope, groupId, postId, search, userId: me })
      if (mine !== req.current) return
      setRows(page.rows); setPaging({ cursor: page.nextCursor, offset: page.nextOffset, more: scope === 'trending' ? page.rows.length > 0 && page.more : Boolean(page.nextCursor) }); setError(null)
      attachUrls(page.rows)
    } catch (e) { if (mine === req.current) setError(tr(friendlyError(e))) } finally { if (mine === req.current) setLoading(false) }
  }, [scope, groupId, postId, search, me, attachUrls])
  useEffect(() => { load() }, [load, refreshKey])

  const more = async () => {
    setLoadingMore(true)
    try {
      const page = await fetchPosts({ scope, groupId, postId, search, userId: me, cursor: paging.cursor, offset: paging.offset })
      setRows((prev) => { const seen = new Set(prev.map((r) => r.id)); return [...prev, ...page.rows.filter((r) => !seen.has(r.id))] })
      setPaging({ cursor: page.nextCursor, offset: page.nextOffset, more: scope === 'trending' ? page.more : Boolean(page.nextCursor) })
      attachUrls(page.rows)
    } catch (e) { setError(tr(friendlyError(e))) } finally { setLoadingMore(false) }
  }

  if (loading && rows.length === 0) return <Spinner />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (rows.length === 0) return <EmptyState icon={Users} title="Nothing here yet" text={tr(emptyText || 'Be the first to share something.')} />
  return (
    <>
      <ul className="space-y-3">
        {rows.map((p) => (
          <li key={p.id}>
            <PostCard post={p} me={me} urls={urls}
              onChange={(next) => setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)))}
              onDelete={setToDelete} onReport={(t) => setReport(t)} onBlock={setToBlock} />
          </li>
        ))}
      </ul>
      {paging.more && <div className="mt-4 flex justify-center"><Button variant="secondary" loading={loadingMore} onClick={more}>{tr('Load more')}</Button></div>}
      {report && <ReportDialog target={report} onClose={() => setReport(null)} />}
      {toDelete && <ConfirmDialog title="Delete this post?" message={tr('This cannot be undone.')} confirmLabel="Delete" onClose={() => setToDelete(null)}
        onConfirm={async () => { await deletePost(toDelete); setRows((r) => r.filter((x) => x.id !== toDelete.id)) }} />}
      {toBlock && <ConfirmDialog title="Block this member?" message={tr('You will no longer see each other\'s posts or comments. You can unblock them later in your profile.')} confirmLabel="Block" onClose={() => setToBlock(null)}
        onConfirm={async () => { await blockUser(toBlock.user_id, toBlock.author_name); setRows((r) => r.filter((x) => x.user_id !== toBlock.user_id)) }} />}
    </>
  )
}
