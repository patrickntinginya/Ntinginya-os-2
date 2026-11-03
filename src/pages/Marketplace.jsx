import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BadgeCheck, BriefcaseBusiness, CalendarClock, MapPin, Search, ShieldCheck, UserRound } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import Spinner from '../components/ui/Spinner'
import Tabs from '../components/ui/Tabs'
import { useAuth } from '../contexts/AuthContext'
import { getLang, localeOf, tr } from '../i18n'
import { formatMoney, friendlyError, toDateTimeLocal } from '../utils/format'
import { isAdminUser } from '../utils/community'
import {
  APPOINTMENT_STATUSES, PROFESSIONAL_CATEGORIES, fetchAdminMarketplaceData, fetchAppointments,
  fetchMarketplaceDirectory, fetchOwnProfessional, fetchOwnServices, fetchProfessional, fetchService,
  requestAppointment, saveService, submitProfessionalProfile, updateAppointmentStatus,
  updateProfessionalStatus, updateServiceStatus,
} from '../services/marketplace'

const CATEGORY_LABELS = {
  health: 'Health',
  education: 'Education',
  home_services: 'Home services',
  technology: 'Technology',
  business: 'Business',
  beauty: 'Beauty',
  wellness: 'Wellness',
  legal: 'Legal',
  other: 'Other',
}
const PROFESSIONAL_STATUS = {
  pending: ['Pending review', 'warn'],
  approved: ['Verified', 'brand'],
  rejected: ['Needs changes', 'danger'],
  suspended: ['Suspended', 'danger'],
}
const SERVICE_STATUS = { pending: ['Pending review', 'warn'], active: ['Listed', 'brand'], suspended: ['Suspended', 'danger'] }
const APPOINTMENT_STATUS = {
  pending: ['Awaiting response', 'warn'],
  accepted: ['Accepted', 'brand'],
  rejected: ['Declined', 'danger'],
  cancelled: ['Cancelled', 'neutral'],
  completed: ['Completed', 'info'],
}
const tCategory = (category) => tr(CATEGORY_LABELS[category] || category)
const localDateTime = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(localeOf(getLang()), { dateStyle: 'medium', timeStyle: 'short' })
}
const statusBadge = (value, labels) => {
  const [label, tone] = labels[value] || [value, 'neutral']
  return <Badge tone={tone}>{tr(label)}</Badge>
}

function ProfessionalCard({ professional }) {
  return (
    <Card className="flex h-full flex-col p-4">
      <div className="flex items-start gap-3">
        <img src={professional.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="font-semibold">{professional.display_name}</h2>
            <Badge tone="brand"><BadgeCheck size={14} className="mr-1" aria-hidden="true" />{tr('Verified')}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">{tCategory(professional.category)}</p>
          <p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><MapPin size={14} aria-hidden="true" />{professional.location}</p>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">{professional.description}</p>
      {professional.services.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">{tr('{count} services', { count: professional.services.length })}</p>
      )}
      <Link to={`/marketplace/professionals/${professional.user_id}`} className="btn btn-secondary mt-4 w-full">
        {tr('View professional')}
      </Link>
    </Card>
  )
}

function Directory() {
  const [category, setCategory] = useState('')
  const [locationInput, setLocationInput] = useState('')
  const [location, setLocation] = useState('')
  const [search, setSearch] = useState('')
  const [professionals, setProfessionals] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      setProfessionals(await fetchMarketplaceDirectory({ category, location }))
    } catch (e) {
      setError(friendlyError(e))
      setProfessionals([])
    }
  }, [category, location])
  useEffect(() => { load() }, [load])

  const matches = useMemo(() => (professionals || []).filter((professional) => {
    if (!search.trim()) return true
    const text = [
      professional.display_name, professional.description, professional.location,
      ...(professional.skills || []), ...professional.services.map((service) => `${service.title} ${service.description}`),
    ].join(' ').toLocaleLowerCase()
    return text.includes(search.trim().toLocaleLowerCase())
  }), [professionals, search])

  return (
    <section>
      <form className="mb-4 grid gap-2 rounded-2xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4 dark:bg-surface-dark dark:ring-white/10" onSubmit={(event) => { event.preventDefault(); setLocation(locationInput.trim()) }}>
        <label className="sr-only" htmlFor="marketplace-search">{tr('Search professionals and services')}</label>
        <input id="marketplace-search" className="input" type="search" placeholder={tr('Search professionals and services')} value={search} onChange={(event) => setSearch(event.target.value)} />
        <label className="sr-only" htmlFor="marketplace-category">{tr('Service category')}</label>
        <select id="marketplace-category" className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">{tr('All categories')}</option>
          {PROFESSIONAL_CATEGORIES.map((item) => <option key={item} value={item}>{tCategory(item)}</option>)}
        </select>
        <label className="sr-only" htmlFor="marketplace-location">{tr('Location')}</label>
        <input id="marketplace-location" className="input" placeholder={tr('Location')} value={locationInput} onChange={(event) => setLocationInput(event.target.value)} />
        <Button type="submit"><Search size={17} aria-hidden="true" />{tr('Apply filters')}</Button>
      </form>
      {error && <ErrorState message={error} onRetry={load} />}
      {!error && professionals === null ? <Spinner /> : !error && matches.length === 0 ? (
        <EmptyState icon={BriefcaseBusiness} title={tr('No professionals found')} text={tr('Try another service category or location.')} />
      ) : !error && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {matches.map((professional) => <ProfessionalCard key={professional.user_id} professional={professional} />)}
        </div>
      )}
    </section>
  )
}

function ProfileForm({ current, user, onSaved }) {
  const [values, setValues] = useState({
    display_name: current?.display_name || user.user_metadata?.full_name || '',
    category: current?.category || 'other',
    skills: (current?.skills || []).join(', '),
    experience_years: current?.experience_years ?? 0,
    location: current?.location || '',
    description: current?.description || '',
    photo_path: current?.photo_path || '',
  })
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      const skills = values.skills.split(',').map((skill) => skill.trim()).filter(Boolean).slice(0, 20)
      const result = await submitProfessionalProfile(user.id, { ...values, skills, experience_years: Number(values.experience_years) }, photo)
      onSaved(result)
      if (result.cleanupWarning) setError(tr(result.cleanupWarning))
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  const field = (key, label, props = {}) => (
    <label className="block text-sm font-medium">{tr(label)}
      <input className="input mt-1 w-full" value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} {...props} />
    </label>
  )

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-lg font-semibold">{tr(current ? 'Edit professional profile' : 'Register as a professional')}</h2>
      <p className="mt-1 text-sm text-slate-500">{tr('Your profile is reviewed by an administrator before it appears in search.')}</p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        {field('display_name', 'Professional name', { required: true, minLength: 2, maxLength: 100 })}
        <label className="block text-sm font-medium">{tr('Professional category')}
          <select className="input mt-1 w-full" value={values.category} onChange={(event) => setValues({ ...values, category: event.target.value })}>
            {PROFESSIONAL_CATEGORIES.map((category) => <option key={category} value={category}>{tCategory(category)}</option>)}
          </select>
        </label>
        {field('skills', 'Skills (comma separated)', { maxLength: 1000 })}
        {field('experience_years', 'Years of experience', { type: 'number', min: 0, max: 60, required: true })}
        {field('location', 'Location', { required: true, minLength: 2, maxLength: 120, autoComplete: 'address-level2' })}
        <label className="block text-sm font-medium sm:col-span-2">{tr('Description')}
          <textarea className="input mt-1 w-full" rows={4} minLength={20} maxLength={2000} required value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
        </label>
        <label className="block text-sm font-medium sm:col-span-2">{tr('Professional photo')} · {tr('JPEG, PNG or WebP up to 5 MB')}
          <input className="input mt-1 w-full" type="file" accept="image/jpeg,image/png,image/webp" required={!current?.photo_path} onChange={(event) => setPhoto(event.target.files?.[0] || null)} />
        </label>
        {current?.photo_url && <img src={current.photo_url} alt={tr('Current professional photo')} className="h-20 w-20 rounded-xl object-cover" />}
        {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2"><Button type="submit" loading={busy}>{tr(current ? 'Save profile' : 'Submit for review')}</Button></div>
      </form>
    </Card>
  )
}

function ServiceForm({ current, onSaved, onCancel }) {
  const [values, setValues] = useState(current || { title: '', category: 'other', description: '', price_tzs: '', duration_minutes: 60 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const { user } = useAuth()
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(null)
    try { await saveService(user.id, values); onSaved() } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <Card className="p-4">
      <h3 className="font-semibold">{tr(current ? 'Edit service' : 'Add a service')}</h3>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">{tr('Service name')}<input className="input mt-1 w-full" required minLength={3} maxLength={120} value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} /></label>
        <label className="block text-sm font-medium">{tr('Service category')}<select className="input mt-1 w-full" value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })}>{PROFESSIONAL_CATEGORIES.map((c) => <option key={c} value={c}>{tCategory(c)}</option>)}</select></label>
        <label className="block text-sm font-medium">{tr('Indicative price (TZS, optional)')}<input className="input mt-1 w-full" type="number" min="0" step="0.01" value={values.price_tzs ?? ''} onChange={(e) => setValues({ ...values, price_tzs: e.target.value })} /></label>
        <label className="block text-sm font-medium">{tr('Appointment duration (minutes)')}<input className="input mt-1 w-full" type="number" min="15" max="480" step="15" required value={values.duration_minutes} onChange={(e) => setValues({ ...values, duration_minutes: e.target.value })} /></label>
        <label className="block text-sm font-medium sm:col-span-2">{tr('Description')}<textarea className="input mt-1 w-full" rows={3} minLength={20} maxLength={2000} required value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} /></label>
        {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" loading={busy}>{tr('Save service')}</Button>{onCancel && <Button type="button" variant="secondary" onClick={onCancel}>{tr('Cancel')}</Button>}</div>
      </form>
    </Card>
  )
}

function ServiceCard({ service, editable = false, onEdit }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{service.title}</h3>{statusBadge(service.status, SERVICE_STATUS)}</div>
      <p className="mt-1 text-sm text-slate-500">{tCategory(service.category)} · {tr('{count} minutes', { count: service.duration_minutes })}</p>
      <p className="mt-2 line-clamp-3 flex-1 text-sm">{service.description}</p>
      <p className="mt-3 font-semibold">{service.price_tzs == null ? tr('Price agreed outside the platform') : formatMoney(service.price_tzs, 'TZS')}</p>
      <p className="mt-1 text-xs text-slate-500">{tr('Free booking request. Payments are arranged directly with the professional.')}</p>
      {editable
        ? <Button className="mt-3" variant="secondary" onClick={() => onEdit(service)}>{tr('Edit service')}</Button>
        : <Link className="btn btn-secondary mt-3" to={`/marketplace/services/${service.id}`}>{tr('View service')}</Link>}
    </Card>
  )
}

function AppointmentForm({ service, userId, onDone }) {
  const [startsAt, setStartsAt] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(null)
    try { await requestAppointment(userId, service, startsAt, message); onDone() } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  return (
    <Card className="p-4">
      <h2 className="text-lg font-semibold">{tr('Request a free appointment')}</h2>
      <p className="mt-1 text-sm text-slate-500">{tr('This is a booking request, not a payment. The professional must accept it.')}</p>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <label className="block text-sm font-medium">{tr('Preferred date and time')}
          <input type="datetime-local" className="input mt-1 w-full" required min={toDateTimeLocal(new Date(Date.now() + 15 * 60_000))} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">{tr('Message (optional)')}
          <textarea className="input mt-1 w-full" maxLength={1000} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" loading={busy}>{tr('Send booking request')}</Button>
      </form>
    </Card>
  )
}

function AppointmentList({ appointments, userId, admin, onStatus }) {
  if (!appointments.length) return <EmptyState icon={CalendarClock} title={tr('No appointments yet')} text={tr('Your booking history will appear here.')} />
  return (
    <ul className="space-y-3">
      {appointments.map((appointment) => {
        const isProfessional = appointment.professional_id === userId
        const canManage = admin || (isProfessional && ['pending', 'accepted'].includes(appointment.status))
        const canCancel = !admin && appointment.user_id === userId && ['pending', 'accepted'].includes(appointment.status)
        const actions = admin
          ? APPOINTMENT_STATUSES.filter((status) => status !== appointment.status)
          : isProfessional && appointment.status === 'pending' ? ['accepted', 'rejected', 'cancelled']
            : isProfessional && appointment.status === 'accepted' ? ['completed', 'cancelled']
              : canCancel ? ['cancelled'] : []
        return (
          <li key={appointment.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="font-semibold">{appointment.service?.title || tr('Service no longer available')}</h3><p className="mt-1 text-sm text-slate-500">{isProfessional ? tr('Requested by a client') : appointment.professional?.display_name || tr('Professional')} · {localDateTime(appointment.starts_at)}</p></div>
                {statusBadge(appointment.status, APPOINTMENT_STATUS)}
              </div>
              {appointment.message && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/5">{appointment.message}</p>}
              <p className="mt-2 text-xs text-slate-500">{tr('Free booking request; any service payment is arranged outside the platform.')}</p>
              {actions.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
                {actions.map((status) => <Button key={status} variant={['rejected', 'cancelled', 'suspended'].includes(status) ? 'secondary' : 'primary'} onClick={() => onStatus(appointment.id, status)}>{tr(APPOINTMENT_STATUS[status]?.[0] || status)}</Button>)}
              </div>}
              {canManage && actions.length === 0 && <p className="mt-3 text-xs text-slate-500">{tr('No further actions are available for this booking.')}</p>}
            </Card>
          </li>
        )
      })}
    </ul>
  )
}

function AppointmentHistory({ userId }) {
  const [appointments, setAppointments] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    try { setError(null); setAppointments(await fetchAppointments(userId)) } catch (e) { setError(friendlyError(e)); setAppointments([]) }
  }, [userId])
  useEffect(() => { load() }, [load])
  const changeStatus = async (id, status) => {
    try { await updateAppointmentStatus(id, status); await load() } catch (e) { setError(friendlyError(e)) }
  }
  return <section className="space-y-3">{error && <ErrorState message={error} onRetry={load} />}{appointments === null ? <Spinner /> : <AppointmentList appointments={appointments} userId={userId} onStatus={changeStatus} />}</section>
}

function MyProfessional({ user, professional, onProfessional }) {
  const [services, setServices] = useState(null)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState(null)
  const loadServices = useCallback(async () => {
    try { setError(null); setServices(await fetchOwnServices(user.id)) } catch (e) { setError(friendlyError(e)); setServices([]) }
  }, [user.id])
  useEffect(() => { if (professional?.status === 'approved') loadServices() }, [loadServices, professional?.status])
  if (!professional) return <ProfileForm current={null} user={user} onSaved={onProfessional} />
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <img src={professional.photo_url} alt="" className="h-16 w-16 rounded-2xl object-cover" />
        <div className="min-w-0 flex-1"><h2 className="font-semibold">{professional.display_name}</h2><p className="text-sm text-slate-500">{tr('Professional status')}: {statusBadge(professional.status, PROFESSIONAL_STATUS)}</p>
          {professional.review_note && <p className="mt-1 text-sm text-slate-500">{professional.review_note}</p>}
        </div>
      </Card>
      {professional.status !== 'suspended' && <ProfileForm key={`${professional.user_id}:${professional.updated_at}`} current={professional} user={user} onSaved={onProfessional} />}
      {professional.status === 'approved' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-semibold">{tr('My services')}</h2><Button onClick={() => setEditing({})}>{tr('Add a service')}</Button></div>
          {editing && <ServiceForm current={editing.id ? editing : null} onSaved={() => { setEditing(null); loadServices() }} onCancel={() => setEditing(null)} />}
          {error && <ErrorState message={error} onRetry={loadServices} />}
          {services === null ? <Spinner /> : services.length === 0 ? <EmptyState icon={BriefcaseBusiness} title={tr('No services yet')} text={tr('Add a service for administrator review.')} /> : (
            <div className="grid gap-3 sm:grid-cols-2">{services.map((service) => <ServiceCard key={service.id} service={service} editable onEdit={setEditing} />)}</div>
          )}
        </section>
      )}
    </div>
  )
}

function MarketplaceAdmin() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const load = useCallback(async () => {
    try { setError(null); setData(await fetchAdminMarketplaceData()) } catch (e) { setError(friendlyError(e)); setData(null) }
  }, [])
  useEffect(() => { load() }, [load])
  const act = async (key, action) => {
    setBusy(key); setError(null)
    try { await action(); await load() } catch (e) { setError(friendlyError(e)) } finally { setBusy(null) }
  }
  if (error && !data) return <ErrorState message={error} onRetry={load} />
  if (!data) return <Spinner />
  const pendingProfessionals = data.professionals.filter((p) => p.status === 'pending')
  const openAppointments = data.appointments.filter((appointment) => ['pending', 'accepted'].includes(appointment.status))
  const pendingServices = data.services.filter((service) => service.status === 'pending')
  return (
    <div className="space-y-5">
      {error && <ErrorState message={error} onRetry={load} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [tr('Pending professionals'), pendingProfessionals.length],
          [tr('Active professionals'), data.professionals.filter((p) => p.status === 'approved').length],
          [tr('Services awaiting review'), pendingServices.length],
          [tr('Open appointments'), openAppointments.length],
        ].map(([label, count]) => <Card key={label} className="p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{count}</p></Card>)}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{tr('Professional applications')}</h2>
        {data.professionals.length === 0 ? <EmptyState icon={ShieldCheck} title={tr('No professional applications')} text="" /> : data.professionals.map((professional) => (
          <Card key={professional.user_id} className="flex flex-wrap items-start gap-3 p-4">
            <img src={professional.photo_url} alt="" className="h-14 w-14 rounded-xl object-cover" />
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{professional.display_name}</h3>{statusBadge(professional.status, PROFESSIONAL_STATUS)}</div><p className="text-sm text-slate-500">{tCategory(professional.category)} · {professional.location} · {tr('{count} years experience', { count: professional.experience_years })}</p><p className="mt-1 text-sm">{professional.description}</p></div>
            <div className="flex flex-wrap gap-2">
              {professional.status !== 'approved' && <Button loading={busy === `pro:${professional.user_id}:approved`} onClick={() => act(`pro:${professional.user_id}:approved`, () => updateProfessionalStatus(professional.user_id, 'approved'))}>{tr('Approve and verify')}</Button>}
              {professional.status !== 'rejected' && <Button variant="secondary" loading={busy === `pro:${professional.user_id}:rejected`} onClick={() => act(`pro:${professional.user_id}:rejected`, () => updateProfessionalStatus(professional.user_id, 'rejected', 'Please update your application and contact support.'))}>{tr('Request changes')}</Button>}
              {professional.status !== 'suspended' && <Button variant="secondary" loading={busy === `pro:${professional.user_id}:suspended`} onClick={() => act(`pro:${professional.user_id}:suspended`, () => updateProfessionalStatus(professional.user_id, 'suspended', 'Account suspended by an administrator.'))}>{tr('Suspend')}</Button>}
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{tr('Service listings')}</h2>
        {data.services.map((service) => <Card key={service.id} className="flex flex-wrap items-center gap-2 p-3"><div className="min-w-0 flex-1"><p className="font-medium">{service.title}</p><p className="text-sm text-slate-500">{tCategory(service.category)} · {service.price_tzs == null ? tr('Price not specified') : formatMoney(service.price_tzs, 'TZS')}</p></div>{statusBadge(service.status, SERVICE_STATUS)}{service.status !== 'active' && <Button loading={busy === `service:${service.id}:active`} onClick={() => act(`service:${service.id}:active`, () => updateServiceStatus(service.id, 'active'))}>{tr('Publish service')}</Button>}{service.status !== 'suspended' && <Button variant="secondary" loading={busy === `service:${service.id}:suspended`} onClick={() => act(`service:${service.id}:suspended`, () => updateServiceStatus(service.id, 'suspended'))}>{tr('Suspend')}</Button>}</Card>)}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{tr('Appointments')}</h2>
        <AppointmentList appointments={data.appointments} admin onStatus={(id, status) => act(`appointment:${id}:${status}`, () => updateAppointmentStatus(id, status))} />
      </section>
    </div>
  )
}

function MarketplaceHome() {
  const { user } = useAuth()
  const admin = isAdminUser(user)
  const [tab, setTab] = useState('discover')
  const [professional, setProfessional] = useState(undefined)
  const [error, setError] = useState(null)
  const loadProfessional = useCallback(async () => {
    try { setError(null); setProfessional(await fetchOwnProfessional(user.id)) } catch (e) { setError(friendlyError(e)); setProfessional(null) }
  }, [user.id])
  useEffect(() => { loadProfessional() }, [loadProfessional])
  const tabs = [
    { value: 'discover', label: 'Find professionals' },
    { value: 'appointments', label: 'My appointments' },
    { value: 'profile', label: 'Professional account' },
    ...(admin ? [{ value: 'admin', label: 'Admin dashboard' }] : []),
  ]
  return (
    <div>
      <PageHeader title={tr('Professionals Marketplace')} subtitle={tr('Find trusted local professionals and send free appointment requests. No payments are processed here.')} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} label={tr('Marketplace sections')} />
      {error && tab === 'profile' && <ErrorState message={error} onRetry={loadProfessional} />}
      {tab === 'discover' && <Directory />}
      {tab === 'appointments' && <AppointmentHistory userId={user.id} />}
      {tab === 'profile' && (professional === undefined ? <Spinner /> : <MyProfessional user={user} professional={professional} onProfessional={(saved) => { setProfessional(saved); setError(null) }} />)}
      {tab === 'admin' && admin && <MarketplaceAdmin />}
    </div>
  )
}

function ProfessionalDetail({ professionalId }) {
  const [professional, setProfessional] = useState(undefined)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    try { setError(null); setProfessional(await fetchProfessional(professionalId)) } catch (e) { setError(friendlyError(e)); setProfessional(null) }
  }, [professionalId])
  useEffect(() => { load() }, [load])
  if (professional === undefined) return <Spinner />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!professional) return <EmptyState icon={UserRound} title={tr('Professional not found')} text={tr('This profile may no longer be available.')} />
  return (
    <div className="space-y-4">
      <PageHeader title={professional.display_name} subtitle={tr('Verified professional profile')} action={<Link className="btn btn-secondary" to="/marketplace">{tr('Back to professionals')}</Link>} />
      <Card className="grid gap-4 p-4 sm:grid-cols-[10rem_1fr] sm:p-6">
        <img src={professional.photo_url} alt="" className="h-40 w-40 rounded-2xl object-cover" />
        <div><div className="flex flex-wrap items-center gap-2"><Badge tone="brand"><BadgeCheck size={14} className="mr-1" />{tr('Verified')}</Badge><Badge>{tCategory(professional.category)}</Badge></div><p className="mt-2 flex items-center gap-1 text-sm text-slate-500"><MapPin size={15} />{professional.location}</p><p className="mt-1 text-sm text-slate-500">{tr('{count} years experience', { count: professional.experience_years })}</p><p className="mt-3 whitespace-pre-line">{professional.description}</p><p className="mt-3 text-sm"><strong>{tr('Skills')}:</strong> {(professional.skills || []).join(', ') || tr('Not specified')}</p></div>
      </Card>
      <section><h2 className="mb-3 text-lg font-semibold">{tr('Services')}</h2>{professional.services.length ? <div className="grid gap-3 sm:grid-cols-2">{professional.services.map((service) => <ServiceCard key={service.id} service={service} />)}</div> : <EmptyState icon={BriefcaseBusiness} title={tr('No active services')} text="" />}</section>
    </div>
  )
}

function ServiceDetail({ serviceId }) {
  const { user } = useAuth()
  const [service, setService] = useState(undefined)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    try { setError(null); setService(await fetchService(serviceId)) } catch (e) { setError(friendlyError(e)); setService(null) }
  }, [serviceId])
  useEffect(() => { load() }, [load])
  if (service === undefined) return <Spinner />
  if (error) return <ErrorState message={error} onRetry={load} />
  if (!service?.professional) return <EmptyState icon={BriefcaseBusiness} title={tr('Service not found')} text={tr('This service may no longer be available.')} />
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={service.title} subtitle={tr('Service details')} action={<Link className="btn btn-secondary" to={`/marketplace/professionals/${service.professional.user_id}`}>{tr('View professional')}</Link>} />
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">{statusBadge(service.status, SERVICE_STATUS)}<Badge>{tCategory(service.category)}</Badge></div>
        <p className="mt-3 whitespace-pre-line">{service.description}</p>
        <p className="mt-3 font-semibold">{service.price_tzs == null ? tr('Price agreed outside the platform') : formatMoney(service.price_tzs, 'TZS')}</p>
        <p className="mt-1 text-sm text-slate-500">{tr('{count} minutes', { count: service.duration_minutes })} · {tr('No payment is taken in the app.')}</p>
      </Card>
      {done ? <Card className="p-4 text-sm text-brand-700 dark:text-brand-300">{tr('Request sent. The professional will respond through your appointment history and notifications.')}</Card>
        : user.id !== service.professional_id && service.status === 'active' && <AppointmentForm service={service} userId={user.id} onDone={() => setDone(true)} />}
    </div>
  )
}

export default function Marketplace() {
  const { professionalId, serviceId } = useParams()
  if (serviceId) return <ServiceDetail key={serviceId} serviceId={serviceId} />
  if (professionalId) return <ProfessionalDetail key={professionalId} professionalId={professionalId} />
  return <MarketplaceHome />
}
