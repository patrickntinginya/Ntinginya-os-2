import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import en from '../src/i18n/en.js'
import sw from '../src/i18n/sw.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Marketplace and appointment routes are protected and navigation keeps Community visible', () => {
  const app = read('src/App.jsx')
  const nav = read('src/lib/navigation.js')
  assert.match(app, /path="\/marketplace" element=\{<Marketplace \/>/)
  assert.match(app, /path="\/marketplace\/professionals\/:professionalId"/)
  assert.match(app, /path="\/marketplace\/services\/:serviceId"/)
  assert.match(nav, /to: '\/marketplace', labelKey: 'nav\.marketplace'/)
  assert.match(nav, /to: '\/community', labelKey: 'nav\.community'/)
  assert.match(nav, /BOTTOM_NAV_PATHS = \['\/dashboard', '\/today', '\/ai', '\/finance', '\/community'\]/)
})

test('Professional, service and appointment states stay within the intended workflows', () => {
  const service = read('src/services/marketplace.js')
  const ui = read('src/pages/Marketplace.jsx')
  assert.match(service, /'health', 'education', 'home_services', 'technology', 'business', 'beauty', 'wellness', 'legal', 'other'/)
  assert.match(service, /'pending', 'approved', 'rejected', 'suspended'/)
  assert.match(service, /'pending', 'active', 'suspended'/)
  assert.match(service, /'pending', 'accepted', 'rejected', 'cancelled', 'completed'/)
  assert.match(service, /status: 'pending'/)
  assert.match(service, /professional_id\.eq\.\$\{userId\}/)
  assert.match(service, /createSignedUrl\(path, 900\)/)
  assert.match(ui, /Request a free appointment/)
  assert.match(ui, /Payments are arranged directly with the professional/)
  assert.match(ui, /formatMoney\(service\.price_tzs, 'TZS'\)/)
  assert.match(ui, /Approve and verify/)
  assert.match(ui, /Admin dashboard/)
  assert.doesNotMatch(ui, /payment gateway|commission|payout/i)
})

test('Marketplace data export includes the signed-in user’s professional data and both sides of bookings', () => {
  const db = read('src/services/db.js')
  assert.match(db, /supabase\.auth\.getUser\(\)/)
  assert.match(db, /marketplace_professionals.*eq\('user_id', data\.user\.id\)/s)
  assert.match(db, /marketplace_services.*eq\('user_id', data\.user\.id\)/s)
  assert.match(db, /marketplace_appointments/)
  assert.match(db, /professional_id\.eq\.\$\{userId\}/)
})

test('Marketplace navigation has English and Kiswahili labels', () => {
  assert.equal(en['nav.marketplace'], 'Professionals')
  assert.equal(sw['nav.marketplace'], 'Wataalamu')
})
