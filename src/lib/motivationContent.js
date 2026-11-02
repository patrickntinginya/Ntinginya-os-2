// Built-in Motivation & Recovery content. All text is bilingual { en, sw }. Add entries here to extend it.
// NOTE FOR THE OWNER: the Kiswahili was written for this app and should be read once by a native speaker.
//
// MEDIA: the app does NOT ship third-party videos, audio or photos, and no media URL is invented here.
//   CURATED_VIDEOS / CURATED_AUDIO / CURATED_IMAGES are empty on purpose. To add real items, append objects like
//     { id: 'v1', title: { en: '...', sw: '...' }, url: 'https://www.youtube.com/watch?v=VIDEO_ID', credit: 'Channel name' }
//   (only links you are allowed to share: official or creator-authorised). Users can also add their own links in the app.
export const CURATED_VIDEOS = []
export const CURATED_AUDIO = []
export const CURATED_IMAGES = []

export const pick = (item, lang) => (item && typeof item === 'object' ? item[lang] || item.en : item)

export const DAILY = [
  { id: 'd1', en: 'You do not have to do everything today. Do one honest thing and let that count.', sw: 'Huhitaji kufanya kila kitu leo. Fanya jambo moja kwa uaminifu, na hilo linatosha.', action: { en: 'Choose the one task that matters most and work on it for 10 minutes.', sw: 'Chagua kazi moja muhimu zaidi na ufanye kazi hiyo kwa dakika 10.' } },
  { id: 'd2', en: 'Small steps repeated beat big plans that never start.', sw: 'Hatua ndogo zinazorudiwa hushinda mipango mikubwa isiyoanza.', action: { en: 'Do the smallest possible version of a habit you care about.', sw: 'Fanya toleo dogo kabisa la tabia unayoijali.' } },
  { id: 'd3', en: 'A hard day does not cancel your progress. It is just one day.', sw: 'Siku ngumu haifuti maendeleo yako. Ni siku moja tu.', action: { en: 'Write one thing you handled well recently.', sw: 'Andika jambo moja ulilolishughulikia vizuri hivi karibuni.' } },
  { id: 'd4', en: 'Start before you feel ready. Readiness often arrives after the first few minutes.', sw: 'Anza kabla hujajisikia tayari. Utayari mara nyingi huja baada ya dakika chache za kwanza.', action: { en: 'Set a 5-minute timer and begin the task you have been avoiding.', sw: 'Weka kipima muda cha dakika 5 kisha anza kazi uliyokuwa unaiepuka.' } },
  { id: 'd5', en: 'Rest is part of the work. Taking care of yourself keeps you going.', sw: 'Mapumziko ni sehemu ya kazi. Kujitunza kunakuwezesha kuendelea.', action: { en: 'Drink water and stretch for two minutes.', sw: 'Kunywa maji na unyoosha mwili kwa dakika mbili.' } },
  { id: 'd6', en: 'Progress is allowed to be slow. Slow is still forward.', sw: 'Maendeleo yanaruhusiwa kuwa polepole. Polepole bado ni kwenda mbele.', action: { en: 'Look at one goal and write the very next step.', sw: 'Tazama lengo moja na uandike hatua inayofuata kabisa.' } },
  { id: 'd7', en: 'Be as patient with yourself as you would be with a friend.', sw: 'Kuwa mvumilivu kwako mwenyewe kama ungekuwa kwa rafiki.', action: { en: 'Say one kind sentence to yourself, out loud or in writing.', sw: 'Jiambie sentensi moja ya upole, kwa sauti au kwa maandishi.' } },
  { id: 'd8', en: 'Your money habits are built one decision at a time.', sw: 'Tabia zako za pesa hujengwa uamuzi mmoja baada ya mwingine.', action: { en: 'Record today\'s spending, even if it is only one item.', sw: 'Weka rekodi ya matumizi ya leo, hata kama ni kitu kimoja tu.' } },
  { id: 'd9', en: 'You can begin again at any moment. Today is a good moment.', sw: 'Unaweza kuanza upya wakati wowote. Leo ni wakati mzuri.', action: { en: 'Pick one habit and do its smaller version now.', sw: 'Chagua tabia moja na ufanye toleo lake dogo sasa.' } },
  { id: 'd10', en: 'Focus on what you can control today: your next action.', sw: 'Zingatia unachoweza kudhibiti leo: kitendo chako kinachofuata.', action: { en: 'List three things you can control today and do the easiest one.', sw: 'Orodhesha mambo matatu unayoweza kudhibiti leo na ufanye rahisi zaidi.' } },
  { id: 'd11', en: 'Every finished task, however small, is proof that you can follow through.', sw: 'Kila kazi iliyokamilika, ndogo kadiri iwavyo, ni ushahidi kwamba unaweza kumaliza.', action: { en: 'Finish one tiny task and tick it off.', sw: 'Maliza kazi moja ndogo na uiweke alama ya kukamilika.' } },
  { id: 'd12', en: 'Ask for help when it is heavy. Needing support is normal.', sw: 'Omba msaada pale mzigo unapokuwa mzito. Kuhitaji msaada ni jambo la kawaida.', action: { en: 'Send a message to someone you trust.', sw: 'Mtumie ujumbe mtu unayemwamini.' } },
  { id: 'd13', en: 'Plan lightly, act simply. A short list you follow beats a long list you ignore.', sw: 'Panga kwa urahisi, tenda kwa urahisi. Orodha fupi unayoifuata ni bora kuliko ndefu unayoipuuza.', action: { en: 'Write a list of three things for today.', sw: 'Andika orodha ya mambo matatu ya leo.' } },
  { id: 'd14', en: 'Notice what went right today, however small.', sw: 'Tambua kilichokwenda vizuri leo, hata kiwe kidogo.', action: { en: 'Write one thing that went well.', sw: 'Andika jambo moja lililokwenda vizuri.' } },
]

export const MORNING = [
  { id: 'm1', en: 'I begin today calmly and with intention.', sw: 'Naanza siku ya leo kwa utulivu na nia njema.' },
  { id: 'm2', en: 'I can do the next right thing, one step at a time.', sw: 'Naweza kufanya jambo sahihi linalofuata, hatua moja baada ya nyingine.' },
  { id: 'm3', en: 'I am allowed to go at my own pace.', sw: 'Nimeruhusiwa kwenda kwa kasi yangu mwenyewe.' },
  { id: 'm4', en: 'I choose to focus on what matters most today.', sw: 'Nachagua kuzingatia yaliyo muhimu zaidi leo.' },
  { id: 'm5', en: 'Mistakes are part of learning, and I can start again.', sw: 'Makosa ni sehemu ya kujifunza, na naweza kuanza upya.' },
  { id: 'm6', en: 'I am grateful for this new day and the chance to try.', sw: 'Nashukuru kwa siku hii mpya na nafasi ya kujaribu.' },
]
export const MORNING_ROUTINE = [
  { id: 'mr1', en: 'Take three slow breaths.', sw: 'Vuta pumzi taratibu mara tatu.' },
  { id: 'mr2', en: 'Read the affirmations above, slowly.', sw: 'Soma kauli chanya hapo juu polepole.' },
  { id: 'mr3', en: 'Choose your one main priority for today.', sw: 'Chagua kipaumbele chako kikuu cha leo.' },
  { id: 'mr4', en: 'Drink a glass of water.', sw: 'Kunywa glasi ya maji.' },
]

export const NIGHT = [
  { id: 'n1', en: 'I did what I could today, and that is enough.', sw: 'Nilifanya niwezavyo leo, na hilo linatosha.' },
  { id: 'n2', en: 'I let go of what I cannot change tonight.', sw: 'Naachilia nisiyoweza kubadilisha usiku huu.' },
  { id: 'n3', en: 'I am thankful for something good from today.', sw: 'Nashukuru kwa jambo zuri la leo.' },
  { id: 'n4', en: 'My body and mind deserve rest.', sw: 'Mwili na akili yangu vinastahili kupumzika.' },
  { id: 'n5', en: 'Tomorrow is a fresh start, and I will take it one step at a time.', sw: 'Kesho ni mwanzo mpya, nitaenda hatua moja baada ya nyingine.' },
  { id: 'n6', en: 'I forgive myself for what did not go to plan.', sw: 'Najisamehe kwa yale yasiyokwenda kama ilivyopangwa.' },
]
export const NIGHT_ROUTINE = [
  { id: 'nr1', en: 'Put your phone away from your bed if you can.', sw: 'Weka simu mbali na kitanda ikiwezekana.' },
  { id: 'nr2', en: 'Name one thing you are grateful for.', sw: 'Taja jambo moja unalolishukuru.' },
  { id: 'nr3', en: 'Choose one small action for tomorrow.', sw: 'Chagua kitendo kimoja kidogo cha kesho.' },
  { id: 'nr4', en: 'Breathe slowly: in for 4, out for 6, five times.', sw: 'Pumua taratibu: vuta ndani kwa 4, toa nje kwa 6, mara tano.' },
]

// Emergency / panic mode. Supportive and non-clinical. It does not contact anyone.
export const BREATHING = { inhale: 4, hold: 4, exhale: 6, cycles: 4 }
export const REASSURANCE = [
  { en: 'This feeling is strong, but it will pass. You do not have to solve everything right now.', sw: 'Hisia hii ni kali, lakini itapita. Huhitaji kutatua kila kitu sasa hivi.' },
  { en: 'You are allowed to pause. Pausing is not failing.', sw: 'Unaruhusiwa kusimama kidogo. Kusimama si kushindwa.' },
  { en: 'You only need to take the next small step.', sw: 'Unahitaji tu kuchukua hatua ndogo inayofuata.' },
]
export const GROUNDING = [
  { n: 5, en: 'Look around and name 5 things you can see.', sw: 'Tazama pande zote na taja vitu 5 unavyoviona.' },
  { n: 4, en: 'Notice 4 things you can touch or feel.', sw: 'Tambua vitu 4 unavyoweza kuvigusa au kuvihisi.' },
  { n: 3, en: 'Listen for 3 sounds.', sw: 'Sikiliza sauti 3.' },
  { n: 2, en: 'Notice 2 things you can smell, or 2 slow breaths.', sw: 'Tambua harufu 2, au vuta pumzi taratibu mara 2.' },
  { n: 1, en: 'Name 1 thing you are okay with right now.', sw: 'Taja jambo 1 ambalo ni sawa kwako kwa sasa.' },
]
export const NEXT_ACTIONS = [
  { id: 'a1', en: 'Drink a glass of water.', sw: 'Kunywa glasi ya maji.' },
  { id: 'a2', en: 'Stand up and walk for two minutes.', sw: 'Simama na utembee kwa dakika mbili.' },
  { id: 'a3', en: 'Do the smallest version of your habit (for example 2 minutes).', sw: 'Fanya toleo dogo kabisa la tabia yako (kwa mfano dakika 2).' },
  { id: 'a4', en: 'Send a message to someone you trust.', sw: 'Mtumie ujumbe mtu unayemwamini.' },
  { id: 'a5', en: 'Write down what is on your mind, without judging it.', sw: 'Andika kilicho akilini mwako bila kukihukumu.' },
]

/** Same message for the whole local day, different on the next day. */
export function dayIndex(iso, length) {
  const [y, m, d] = iso.split('-').map(Number)
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86400000)
  return ((day % length) + length) % length
}
export const dailyFor = (iso) => DAILY[dayIndex(iso, DAILY.length)]

// Built-in "image" cards are generated from text with CSS gradients: no downloads, no external requests.
export const QUOTE_GRADIENTS = [
  ['#256b5b', '#3f8f7b'], ['#1d4e89', '#3a7bbf'], ['#6b3fa0', '#8d63c4'], ['#a34a28', '#d37a4a'], ['#2f5d3a', '#5a9367'], ['#1f3a5f', '#4a6fa5'],
]
