import { useCallback, useEffect, useRef, useState } from 'react'
import { History, MessageSquarePlus, Pencil, Send, Sparkles, Trash2 } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import ErrorState from '../components/ui/ErrorState'
import Spinner from '../components/ui/Spinner'
import AiActionCard from '../components/ai/AiActionCard'
import {
  AiError, AiNotConfiguredError, deleteConversation, getAiStatus, listActionRequests,
  listConversations, listMessages, renameConversation, sendToAssistant,
} from '../services/aiClient'
import { friendlyError } from '../utils/format'
import { tr } from '../i18n'

// Questions that the assistant answers from the user's own data (it never sees anything else).
const SUGGESTED = [
  'What do I need to do today?',
  'How much did I spend this month?',
  'What are my biggest expenses?',
  'Which goal is falling behind?',
  'Plan my day.',
  'What should I prioritize?',
  'How can I reduce my expenses?',
  'Analyze my progress this week.',
]

function ConversationList({ items, activeId, onSelect, onNew, onRename, onDelete }) {
  return (
    <div>
      <Button onClick={onNew} className="mb-3 w-full"><MessageSquarePlus size={18} aria-hidden="true" /> {tr('New conversation')}</Button>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">{tr('No conversations yet.')}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((c) => (
            <li key={c.id} className={`flex items-center rounded-xl ${c.id === activeId ? 'bg-brand-100 dark:bg-brand-500/20' : ''}`}>
              <button type="button" onClick={() => onSelect(c)} className="min-h-[48px] min-w-0 flex-1 truncate px-3 text-left text-sm font-medium">
                {c.title}
              </button>
              <button type="button" className="icon-btn" onClick={() => onRename(c)} aria-label={`Rename ${c.title}`}><Pencil size={16} /></button>
              <button type="button" className="icon-btn hover:!text-red-600" onClick={() => onDelete(c)} aria-label={`Delete ${c.title}`}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AiAssistant() {
  const [status, setStatus] = useState(null) // { reachable, configured }
  const [conversations, setConversations] = useState([])
  const [active, setActive] = useState(null) // conversation row or null (= new)
  const [messages, setMessages] = useState([])
  const [actions, setActions] = useState([])
  const [loadingConv, setLoadingConv] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [listError, setListError] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [toDelete, setToDelete] = useState(null)
  const endRef = useRef(null)

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await listConversations())
      setListError(null)
    } catch (e) {
      setListError(friendlyError(e))
    }
  }, [])

  useEffect(() => {
    getAiStatus().then(setStatus)
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, actions, busy])

  const openConversation = async (conv) => {
    setActive(conv)
    setHistoryOpen(false)
    setError(null)
    setLoadingConv(true)
    try {
      const [m, a] = await Promise.all([listMessages(conv.id), listActionRequests(conv.id)])
      setMessages(m)
      setActions(a)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setLoadingConv(false)
    }
  }

  const startNew = () => {
    setActive(null)
    setMessages([])
    setActions([])
    setError(null)
    setHistoryOpen(false)
  }

  const send = async (text) => {
    const message = text.trim()
    if (!message || busy) return
    setInput('')
    setError(null)
    setBusy(true)
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: message }])
    try {
      const res = await sendToAssistant({ conversationId: active?.id, message, mode: 'chat' })
      setMessages((m) => [...m, { id: `reply-${Date.now()}`, role: 'assistant', content: res.reply }])
      setActions((a) => [...a, ...(res.actions || [])])
      if (!active) setActive({ id: res.conversation_id, title: message.slice(0, 60) })
      loadConversations()
    } catch (e) {
      setMessages((m) => m.slice(0, -1))
      setInput(message)
      if (e instanceof AiNotConfiguredError) setStatus({ reachable: true, configured: false })
      else setError(e instanceof AiError ? e.message : friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const doRename = async (e) => {
    e.preventDefault()
    try {
      await renameConversation(renaming.id, renameValue)
      if (active?.id === renaming.id) setActive({ ...active, title: renameValue.trim() || 'New conversation' })
      setRenaming(null)
      loadConversations()
    } catch (err) {
      setListError(friendlyError(err))
      setRenaming(null)
    }
  }

  const doDelete = async () => {
    await deleteConversation(toDelete.id)
    if (active?.id === toDelete.id) startNew()
    loadConversations()
  }

  const notConfigured = status && status.reachable && !status.configured
  const unreachable = status && !status.reachable

  const list = (
    <ConversationList
      items={conversations} activeId={active?.id} onSelect={openConversation} onNew={startNew}
      onRename={(c) => { setRenaming(c); setRenameValue(c.title) }} onDelete={setToDelete}
    />
  )

  return (
    <div className="md:flex md:gap-6">
      <aside className="hidden w-64 shrink-0 md:block" aria-label={tr('Conversations')}>{list}</aside>

      <div className="flex min-h-[calc(100dvh-11rem)] min-w-0 flex-1 flex-col md:min-h-[calc(100dvh-8rem)]">
        <PageHeader
          title={tr('AI Assistant')}
          subtitle={active ? active.title : 'Answers come from your own data.'}
          action={
            <div className="flex items-center gap-1 md:hidden">
              <button type="button" className="icon-btn" onClick={() => setHistoryOpen(true)} aria-label={tr('Conversation history')}><History size={20} /></button>
              <button type="button" className="icon-btn" onClick={startNew} aria-label={tr('New conversation')}><MessageSquarePlus size={20} /></button>
            </div>
          }
        />

        {notConfigured && (
          <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {tr('AI Assistant is not configured yet. Your conversations are saved, but answers need an AI provider set up on the server (see the README). Everything else in the app works without it.')}
          </p>
        )}
        {unreachable && (
          <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {tr('The AI service could not be reached. When running locally, start the app with')} <code>vercel dev</code>.
          </p>
        )}
        {listError && <div className="mb-4"><ErrorState message={listError} compact /></div>}

        <div className="flex-1 space-y-3" aria-live="polite">
          {loadingConv ? (
            <Spinner />
          ) : messages.length === 0 ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200">
                <Sparkles size={26} aria-hidden="true" />
              </div>
              <p className="text-xl font-semibold">{tr('How can I help you today?')}</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                {tr('I can read your tasks, schedule, goals, learning and finances. Changes are only made after you confirm them.')}
              </p>
              <div className="mx-auto mt-5 grid max-w-md gap-2">
                {SUGGESTED.map((p) => (
                  <button key={p} type="button" disabled={busy || notConfigured} onClick={() => send(p)} className="btn btn-secondary justify-start text-left !font-medium">
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <p className={`max-w-[88%] whitespace-pre-line rounded-2xl px-4 py-3 text-base leading-relaxed ${
                  m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-white ring-1 ring-slate-200 dark:bg-surface-dark dark:ring-white/10'
                }`}>
                  {m.content}
                </p>
              </div>
            ))
          )}

          {actions.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{tr('Proposed changes (nothing is saved until you confirm)')}</p>
              {actions.map((a) => <AiActionCard key={a.id} request={a} />)}
            </div>
          )}

          {busy && <p className="text-sm text-slate-500">{tr('Thinking...')}</p>}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
          <p className="pt-2 text-xs text-slate-500 dark:text-slate-400">
            {tr('AI can make mistakes. Financial comments are general guidance, not professional financial advice.')}
          </p>
          <div ref={endRef} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="sticky bottom-20 mt-4 flex gap-2 bg-canvas pt-2 md:bottom-4 dark:bg-canvas-dark">
          <label htmlFor="ai-input" className="sr-only">{tr('Message')}</label>
          <input id="ai-input" className="input" placeholder={tr('Ask about your day, money or goals')} maxLength={4000} value={input} onChange={(e) => setInput(e.target.value)} />
          <Button type="submit" disabled={!input.trim() || busy || notConfigured} aria-label={tr('Send')} className="!px-4"><Send size={20} aria-hidden="true" /></Button>
        </form>
      </div>

      {historyOpen && <Modal title={tr('Conversations')} onClose={() => setHistoryOpen(false)}>{list}</Modal>}

      {renaming && (
        <Modal title={tr('Rename conversation')} onClose={() => setRenaming(null)}>
          <form onSubmit={doRename} className="space-y-4">
            <div>
              <label htmlFor="conv-title" className="label">{tr('Title')}</label>
              <input id="conv-title" className="input" value={renameValue} maxLength={120} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setRenaming(null)}>{tr('Cancel')}</Button>
              <Button type="submit">{tr('Save')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title={tr('Delete conversation?')} message={`"${toDelete.title}" and its messages will be permanently deleted.`}
          onConfirm={doDelete} onClose={() => setToDelete(null)}
        />
      )}
    </div>
  )
}

