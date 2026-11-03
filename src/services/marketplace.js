import { supabase } from '../lib/supabase'
import { uuidv4 } from '../lib/uuid'

export const PROFESSIONAL_CATEGORIES = [
  'health', 'education', 'home_services', 'technology', 'business', 'beauty', 'wellness', 'legal', 'other',
]
export const PROFESSIONAL_STATUSES = ['pending', 'approved', 'rejected', 'suspended']
export const SERVICE_STATUSES = ['pending', 'active', 'suspended']
export const APPOINTMENT_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled', 'completed']

const BUCKET = 'professional-media'
const unwrap = ({ data, error }) => {
  if (error) throw error
  return data
}

async function photoUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 900)
  if (error) throw error
  return data.signedUrl
}

function validatePhoto(file) {
  if (!file) throw new Error('Choose a professional profile photo.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
    throw new Error('Choose a JPEG, PNG or WebP photo up to 5 MB.')
  }
}

async function uploadPhoto(userId, file) {
  validatePhoto(file)
  const path = `${userId}/${uuidv4()}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

export async function fetchMarketplaceDirectory({ category = '', location = '' } = {}) {
  let query = supabase.from('marketplace_professionals')
    .select('user_id,display_name,category,skills,experience_years,location,description,photo_path,status,verified_at')
    .eq('status', 'approved')
    .order('display_name')
    .limit(100)
  if (location.trim()) query = query.ilike('location', `%${location.trim()}%`)
  const professionals = unwrap(await query) || []
  if (!professionals.length) return []

  let servicesQuery = supabase.from('marketplace_services')
    .select('id,professional_id,title,category,description,price_tzs,duration_minutes,status')
    .in('professional_id', professionals.map((p) => p.user_id))
    .eq('status', 'active')
    .order('title')
    .limit(300)
  if (category) servicesQuery = servicesQuery.eq('category', category)
  const services = unwrap(await servicesQuery) || []
  const grouped = new Map()
  for (const service of services) grouped.set(service.professional_id, [...(grouped.get(service.professional_id) || []), service])
  const matches = professionals
    .map((professional) => ({ ...professional, services: grouped.get(professional.user_id) || [] }))
    .filter((professional) => professional.services.length)
  const photos = await Promise.all(matches.map((professional) => photoUrl(professional.photo_path)))
  return matches.map((professional, index) => ({ ...professional, photo_url: photos[index] }))
}

export async function fetchProfessional(userId) {
  const professional = unwrap(await supabase.from('marketplace_professionals')
    .select('user_id,display_name,category,skills,experience_years,location,description,photo_path,status,verified_at')
    .eq('user_id', userId)
    .maybeSingle())
  if (!professional) return null
  const services = unwrap(await supabase.from('marketplace_services')
    .select('id,professional_id,title,category,description,price_tzs,duration_minutes,status')
    .eq('professional_id', userId)
    .eq('status', 'active')
    .order('title')) || []
  return { ...professional, photo_url: await photoUrl(professional.photo_path), services }
}

export async function fetchService(serviceId) {
  const service = unwrap(await supabase.from('marketplace_services')
    .select('id,professional_id,title,category,description,price_tzs,duration_minutes,status')
    .eq('id', serviceId)
    .maybeSingle())
  if (!service) return null
  const professional = await fetchProfessional(service.professional_id)
  return { ...service, professional }
}

export async function fetchOwnProfessional(userId) {
  const professional = unwrap(await supabase.from('marketplace_professionals')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle())
  return professional ? { ...professional, photo_url: await photoUrl(professional.photo_path) } : null
}

export async function submitProfessionalProfile(userId, values, photo) {
  const { data: existing, error: existingError } = await supabase.from('marketplace_professionals')
    .select('user_id,photo_path,status')
    .eq('user_id', userId)
    .maybeSingle()
  if (existingError) throw existingError
  const photoPath = photo ? await uploadPhoto(userId, photo) : values.photo_path
  if (!photoPath) throw new Error('Choose a professional profile photo.')
  const valuesToSave = {
    ...values,
    user_id: userId,
    photo_path: photoPath,
    ...(existing?.status === 'rejected' ? { status: 'pending' } : {}),
  }
  const query = existing
    ? supabase.from('marketplace_professionals').update(valuesToSave).eq('user_id', userId)
    : supabase.from('marketplace_professionals').insert(valuesToSave)
  let profile
  try {
    profile = unwrap(await query.select().single())
  } catch (error) {
    if (photo) {
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([photoPath])
      if (cleanupError) console.error('Could not remove an uploaded photo after profile save failed.', cleanupError)
    }
    throw error
  }
  let cleanupWarning = null
  if (photo && existing?.photo_path && existing.photo_path !== photoPath) {
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([existing.photo_path])
    if (cleanupError) {
      console.error('Could not remove the previous professional profile photo.', cleanupError)
      cleanupWarning = 'Profile saved, but the previous photo could not be removed. Please contact support.'
    }
  }
  return { ...profile, photo_url: await photoUrl(profile.photo_path), cleanupWarning }
}

export async function fetchOwnServices(userId) {
  return unwrap(await supabase.from('marketplace_services').select('*').eq('professional_id', userId).order('created_at', { ascending: false })) || []
}

export async function saveService(userId, service) {
  const values = {
    professional_id: userId,
    user_id: userId,
    title: service.title.trim(),
    category: service.category,
    description: service.description.trim(),
    price_tzs: service.price_tzs === '' || service.price_tzs == null ? null : Number(service.price_tzs),
    duration_minutes: Number(service.duration_minutes),
  }
  const query = service.id
    ? supabase.from('marketplace_services').update(values).eq('id', service.id)
    : supabase.from('marketplace_services').insert(values)
  return unwrap(await query.select().single())
}

export async function fetchAppointments(userId, { admin = false } = {}) {
  let query = supabase.from('marketplace_appointments')
    .select('id,user_id,professional_id,service_id,professional_name_snapshot,service_title_snapshot,starts_at,ends_at,message,status,created_at,updated_at')
    .order('starts_at', { ascending: true })
    .limit(500)
  if (!admin) query = query.or(`user_id.eq.${userId},professional_id.eq.${userId}`)
  const appointments = unwrap(await query) || []
  const serviceIds = [...new Set(appointments.map((appointment) => appointment.service_id).filter(Boolean))]
  const professionalIds = [...new Set(appointments.map((appointment) => appointment.professional_id).filter(Boolean))]
  const [services, professionals] = await Promise.all([
    serviceIds.length
      ? supabase.from('marketplace_services').select('id,title,category,price_tzs,duration_minutes').in('id', serviceIds).then(unwrap)
      : [],
    professionalIds.length
      ? supabase.from('marketplace_professionals').select('user_id,display_name,status').in('user_id', professionalIds).then(unwrap)
      : [],
  ])
  const serviceById = new Map((services || []).map((service) => [service.id, service]))
  const professionalById = new Map((professionals || []).map((professional) => [professional.user_id, professional]))
  return appointments.map((appointment) => ({
    ...appointment,
    service: serviceById.get(appointment.service_id) || (appointment.service_title_snapshot ? { title: appointment.service_title_snapshot } : null),
    professional: professionalById.get(appointment.professional_id) || (appointment.professional_name_snapshot ? { display_name: appointment.professional_name_snapshot } : null),
  }))
}

export async function requestAppointment(userId, service, startsAt, message) {
  const start = new Date(startsAt)
  if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now() + 15 * 60 * 1000) {
    throw new Error('Choose an appointment at least 15 minutes from now.')
  }
  const end = new Date(start.getTime() + Number(service.duration_minutes) * 60_000)
  return unwrap(await supabase.from('marketplace_appointments').insert({
    user_id: userId,
    professional_id: service.professional_id,
    service_id: service.id,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    message: message.trim() || null,
  }).select().single())
}

export async function updateProfessionalStatus(userId, status, reviewNote = null) {
  if (!PROFESSIONAL_STATUSES.includes(status)) throw new Error('Unknown professional status.')
  return unwrap(await supabase.from('marketplace_professionals')
    .update({ status, review_note: reviewNote })
    .eq('user_id', userId)
    .select()
    .single())
}

export async function updateServiceStatus(serviceId, status) {
  if (!SERVICE_STATUSES.includes(status)) throw new Error('Unknown service status.')
  return unwrap(await supabase.from('marketplace_services')
    .update({ status })
    .eq('id', serviceId)
    .select()
    .single())
}

export async function updateAppointmentStatus(appointmentId, status) {
  if (!APPOINTMENT_STATUSES.includes(status)) throw new Error('Unknown appointment status.')
  return unwrap(await supabase.from('marketplace_appointments')
    .update({ status })
    .eq('id', appointmentId)
    .select()
    .single())
}

export async function fetchAdminMarketplaceData() {
  const [professionals, services, appointments] = await Promise.all([
    supabase.from('marketplace_professionals').select('*').order('created_at', { ascending: false }).limit(500).then(unwrap),
    supabase.from('marketplace_services').select('*').order('created_at', { ascending: false }).limit(500).then(unwrap),
    fetchAppointments(null, { admin: true }),
  ])
  const photos = await Promise.all((professionals || []).map((professional) => photoUrl(professional.photo_path)))
  return {
    professionals: (professionals || []).map((professional, index) => ({ ...professional, photo_url: photos[index] })),
    services: services || [],
    appointments,
  }
}
