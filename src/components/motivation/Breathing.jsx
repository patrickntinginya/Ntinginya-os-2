import { useEffect, useRef, useState } from 'react'
import Button from '../ui/Button'
import { t } from '../../i18n'
import { BREATHING } from '../../lib/motivationContent'

const PHASES = [['inhale', BREATHING.inhale], ['hold', BREATHING.hold], ['exhale', BREATHING.exhale]]

/** Guided breathing. Text-first (no flashing); the circle only scales slowly. The user can stop at any time. */
export default function Breathing({ onFinished }) {
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState(0)
  const [left, setLeft] = useState(PHASES[0][1])
  const [cycle, setCycle] = useState(1)
  const timer = useRef(null)

  useEffect(() => {
    if (!running) return undefined
    timer.current = setInterval(() => {
      setLeft((l) => {
        if (l > 1) return l - 1
        setPhase((p) => {
          const next = (p + 1) % PHASES.length
          if (next === 0) {
            setCycle((c) => {
              if (c >= BREATHING.cycles) { setRunning(false); onFinished?.(); return 1 }
              return c + 1
            })
          }
          setLeft(PHASES[next][1])
          return next
        })
        return l
      })
    }, 1000)
    return () => clearInterval(timer.current)
  }, [running, onFinished])

  const name = PHASES[phase][0]
  const big = running && name !== 'exhale'
  return (
    <div className="text-center">
      <div className="mx-auto flex h-44 w-44 items-center justify-center" aria-hidden="true">
        <div className={`flex h-32 w-32 items-center justify-center rounded-full bg-brand-100 text-brand-800 transition-transform duration-[3000ms] dark:bg-brand-500/20 dark:text-brand-100 ${big ? 'scale-125' : 'scale-90'}`}>
          <span className="text-3xl font-bold tabular-nums">{running ? left : ''}</span>
        </div>
      </div>
      <p role="status" aria-live="polite" className="min-h-[3rem] text-xl font-medium">
        {running ? `${t(`calm.${name}`)} (${cycle}/${BREATHING.cycles})` : t('calm.breathIntro', { n: BREATHING.cycles })}
      </p>
      <Button className="mt-3 w-full sm:w-auto" variant={running ? 'secondary' : 'primary'} onClick={() => { setPhase(0); setLeft(PHASES[0][1]); setCycle(1); setRunning((r) => !r) }}>
        {running ? t('calm.stop') : t('calm.start')}
      </Button>
    </div>
  )
}
