import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Flag, MessageCircle, Trash2 } from 'lucide-react'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Avatar from './Avatar'
import Comments from './Comments'
import VoicePlayer from '../voice/VoicePlayer'
import { REACTIONS, applyReaction, communityError, timeAgo } from '../../utils/community'
import { setReaction } from '../../services/community'
import { friendlyError } from '../../utils/format'
import { tr } from '../../i18n'

export default function PostCard({ post, me, urls, onChange, onDelete, onReport, onBlock }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const own = post.user_id === me
  const media = post.media_path ? urls[post.media_path] : null
  const avatar = post.author_avatar ? urls[post.author_avatar] : null

  const react = async (kind) => {
    const next = post.my_reaction === kind ? null : kind
    const before = post
    onChange(applyReaction(post, next)) // optimistic
    try { await setReaction(post.id, next); setError(null) } catch (e) { onChange(before); setError(tr(communityError(e) || friendlyError(e))) }
  }

  return (
    <Card className="p-4" id={`post-${post.id}`}>
      <div className="flex items-start gap-3">
        <Avatar name={post.author_name} url={avatar} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{post.author_name || tr('Member')}</p>
          <p className="text-xs text-slate-400">{timeAgo(post.created_at)}{post.group_name && <> · <Link className="underline" to={`/community?group=${post.group_id}`}>{post.group_name}</Link></>}</p>
        </div>
        {post.status !== 'visible' && <Badge tone="warn">{tr('Hidden')}</Badge>}
      </div>
      {post.body && <p className="mt-3 whitespace-pre-wrap break-words">{post.body}</p>}
      {post.media_kind === 'image' && media && <img src={media} alt="" loading="lazy" className="mt-3 max-h-[28rem] w-full rounded-xl object-cover" />}
      {post.media_kind === 'video' && media && <video src={media} controls playsInline preload="metadata" className="mt-3 max-h-[28rem] w-full rounded-xl bg-black" />}
      {post.media_kind === 'voice' && media && <div className="mt-3"><VoicePlayer src={media} durationMs={post.duration_ms} label={tr('Voice post')} /></div>}
      {post.media_path && !media && <p className="mt-3 text-sm text-slate-500">{tr('Loading media...')}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label={tr('Reactions')}>
        {REACTIONS.map((r) => (
          <button key={r.kind} type="button" aria-pressed={post.my_reaction === r.kind} aria-label={tr(r.label)} onClick={() => react(r.kind)}
            className={`flex h-11 min-w-[44px] items-center justify-center rounded-full px-2 text-lg ${post.my_reaction === r.kind ? 'bg-brand-100 ring-1 ring-brand-400 dark:bg-brand-500/20' : 'hover:bg-slate-100 dark:hover:bg-white/10'}`}>{r.emoji}</button>
        ))}
        <span className="ml-1 text-sm text-slate-500">{Number(post.reaction_count || 0)}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="ml-auto flex min-h-[44px] items-center gap-1 px-2 text-sm font-medium text-slate-600 dark:text-slate-300">
          <MessageCircle size={18} aria-hidden="true" />{Number(post.comment_count || 0)}
        </button>
        {own ? (
          <button type="button" className="icon-btn text-red-600 dark:text-red-400" aria-label={tr('Delete post')} onClick={() => onDelete(post)}><Trash2 size={18} /></button>
        ) : (
          <>
            <button type="button" className="icon-btn" aria-label={tr('Report post')} onClick={() => onReport({ postId: post.id })}><Flag size={18} /></button>
            <button type="button" className="icon-btn" aria-label={tr('Block this member')} onClick={() => onBlock(post)}><Ban size={18} /></button>
          </>
        )}
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {open && <Comments post={post} me={me} onReport={onReport} onCountChange={(d) => onChange({ ...post, comment_count: Math.max(0, Number(post.comment_count || 0) + d) })} />}
    </Card>
  )
}
