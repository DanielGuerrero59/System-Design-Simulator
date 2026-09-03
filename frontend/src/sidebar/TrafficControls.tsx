/**
 * The load offered at the entry point, and the button that runs it.
 *
 * Presentational: the traffic string lives in App, next to the design and
 * result stores it has to be combined with. Holding it here would mean lifting
 * it back out the moment anything else needed the number.
 */

import { useId } from 'react'

import { MAX_TRAFFIC_RPS } from '../design/limits'
import { formatRate } from '../format'

/** Round numbers a learner recognises: comfortable, painful, hopeless. */
const PRESETS_RPS = [1_000, 10_000, 100_000]

interface TrafficControlsProps {
  value: string
  onChange: (value: string) => void
  onSimulate: () => void
  isRunning: boolean
  /** False when the traffic value or the design itself cannot be submitted. */
  canSimulate: boolean
  /** Why the design cannot be simulated, or null if it can. */
  designProblem: string | null
}

export function TrafficControls({
  value,
  onChange,
  onSimulate,
  isRunning,
  canSimulate,
  designProblem,
}: TrafficControlsProps) {
  const inputId = useId()
  const warningId = `${inputId}-warning`

  const trafficRps = Number(value)
  const isTrafficValid =
    value.trim() !== '' &&
    Number.isFinite(trafficRps) &&
    trafficRps > 0 &&
    trafficRps <= MAX_TRAFFIC_RPS
  const showWarning = !isTrafficValid && value.trim() !== ''

  return (
    <section aria-labelledby="traffic-heading" className="space-y-2">
      <h2
        id="traffic-heading"
        className="text-xs font-semibold tracking-wide text-slate-500 uppercase"
      >
        Traffic
      </h2>

      {/* The heading above says "Traffic"; the unit is what a screen reader
          needs and a sighted user reads off the presets, so the real label is
          visually hidden rather than absent. */}
      <label htmlFor={inputId} className="sr-only">
        Requests per second
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_TRAFFIC_RPS}
        step={100}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // Enter is what a user presses after typing a number; without this it
        // does nothing, since the input is not inside a form.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canSimulate) {
            onSimulate()
          }
        }}
        aria-invalid={!isTrafficValid}
        aria-describedby={showWarning ? warningId : undefined}
        className="w-full rounded-md border border-slate-300 bg-white px-2.5
                   py-1.5 text-sm text-slate-800 focus:border-slate-500
                   focus:outline-none focus:ring-1 focus:ring-slate-500"
      />

      <div className="flex gap-1.5">
        {PRESETS_RPS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(String(preset))}
            aria-pressed={trafficRps === preset}
            className={`flex-1 rounded-md border px-2 py-1 text-[11px]
                        font-medium transition-colors focus:outline-none
                        focus-visible:ring-2 focus-visible:ring-slate-900/40
                        ${
                          trafficRps === preset
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                        }`}
          >
            {formatRate(preset)}
          </button>
        ))}
      </div>

      {showWarning && (
        <p id={warningId} className="text-[11px] text-amber-700">
          {`Traffic must be a positive rate no higher than ${MAX_TRAFFIC_RPS.toLocaleString()} rps.`}
        </p>
      )}

      <button
        type="button"
        onClick={onSimulate}
        disabled={!canSimulate || isRunning}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold
                   text-white transition-colors hover:bg-slate-700
                   focus:outline-none focus-visible:ring-2
                   focus-visible:ring-slate-900/40
                   disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {isRunning ? 'Simulating…' : 'Simulate'}
      </button>

      {designProblem !== null && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2
                      text-[11px] leading-relaxed text-amber-800">
          {designProblem}
        </p>
      )}
    </section>
  )
}
