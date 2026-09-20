/**
 * The right rail: the brief, the scorecard, and the one sentence worth reading.
 *
 * All of the judgement happens in `game/objectives.ts`; this file only draws
 * the answer. That split is deliberate -- the rules of a level should be
 * legible without reading any JSX, and a rendering change should not be able to
 * alter what counts as clearing one.
 */

import {
  ArrowCounterClockwise,
  CheckCircle,
  CircleDashed,
  Hourglass,
  Trophy,
  WarningDiamond,
} from '@phosphor-icons/react'

import type { TimelineStep } from '../api/types'
import type { Assessment } from '../game/objectives'
import type { Level } from '../game/levels'
import { formatRate, latencyParts } from '../format'
import { TimelineStrip } from './TimelineStrip'

export interface ObjectivePanelProps {
  level: Level
  assessment: Assessment
  /** Null while stopped, or when the design is not simulatable. */
  totalLatencyMs: number | null
  /** Every second of the last run. Null while stopped; one sample for a steady rate. */
  timeline: readonly TimelineStep[] | null
  /** Index into `timeline` of the second the headline figure describes. */
  worstStepIndex: number
  /** The second under the pointer on the strip, if any; the headline follows it. */
  focusedStepIndex: number | null
  onScrub: (index: number | null) => void
  isLive: boolean
  bottleneckLabel: string | null
  error: string | null
  onReset: () => void
}

export function ObjectivePanel({
  level,
  assessment,
  totalLatencyMs,
  timeline,
  worstStepIndex,
  focusedStepIndex,
  onScrub,
  isLive,
  bottleneckLabel,
  error,
  onReset,
}: ObjectivePanelProps) {
  const { objectives, isCleared, verdictText, verdictTone, tip, bottleneck } =
    assessment

  const focusedStep =
    focusedStepIndex !== null && timeline !== null
      ? (timeline[focusedStepIndex] ?? null)
      : null

  // Figure and unit are set in different sizes, so they are taken apart here
  // and both follow the size of the number: a tail reads "8.0 s", not "8001 ms".
  const latency = totalLatencyMs === null ? null : latencyParts(totalLatencyMs)

  const latencyTint = !isLive
    ? 'var(--color-neutral-600)'
    : totalLatencyMs !== null && totalLatencyMs <= level.latencyCapMs
      ? 'var(--color-status-healthy)'
      : 'var(--color-status-critical)'

  return (
    <aside
      className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-divider
                 px-3.5 pt-3.5 pb-4"
    >
      <div>
        <div className="mb-[3px] text-[10px] tracking-[0.14em] text-accent-400 uppercase">
          {level.kicker}
        </div>
        <h4 className="mb-1">{level.name}</h4>
        <p className="m-0 text-xs leading-relaxed text-neutral-400">
          {level.blurb}
        </p>
      </div>

      <div className="flex flex-col gap-px">
        {objectives.map((objective) => (
          <div
            key={objective.label}
            className="grid grid-cols-[16px_1fr_auto] items-center gap-2 border-t
                       border-divider py-[7px]"
          >
            {objective.isMet ? (
              <CheckCircle size={13} className="text-status-healthy" />
            ) : (
              <CircleDashed size={13} className="text-neutral-600" />
            )}
            <span className="text-xs text-neutral-300">{objective.label}</span>
            <span
              className={`font-heading text-xs font-medium tabular-nums ${
                objective.isMet ? 'text-status-healthy' : 'text-neutral-600'
              }`}
            >
              {objective.value}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-md bg-surface p-3 shadow-sm">
        <div className="text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
          Slowest path
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span
            className="font-heading text-[34px] leading-[1.05] tabular-nums"
            style={{ color: latencyTint }}
          >
            {!isLive
              ? '—'
              : latency === null
                ? '∞' // infinity sign
                : latency.figure}
          </span>
          <span className="text-xs text-neutral-500">{latency?.unit ?? 'ms'}</span>
        </div>
        <div className="mt-1.5 text-[11.5px] text-neutral-400">
          {!isLive
            ? 'Press run to push traffic through.'
            : focusedStep
              ? `t = ${focusedStep.t_seconds} s · ${formatRate(focusedStep.offered_rps)}`
              : bottleneck && bottleneckLabel
              ? `Busiest: ${bottleneckLabel} at ρ ${
                  bottleneck.utilization >= 1
                    ? '≥ 1'
                    : bottleneck.utilization.toFixed(2)
                }`
              : // Reached when the result names a component the player has just
                // deleted, so the label cannot be resolved. The old copy here
                // said "Nothing on the canvas yet." over a canvas full of
                // components; this says what is actually true for one frame.
                'Waiting on the next run.'}
        </div>
        {/* A steady rate is one sample, and a strip of one bar would only
            restate the number above it. Shaped levels get the picture. */}
        {isLive && timeline !== null && timeline.length > 1 ? (
          <TimelineStrip
            timeline={timeline}
            worstIndex={worstStepIndex}
            capMs={level.latencyCapMs}
            focusedIndex={focusedStepIndex}
            onScrub={onScrub}
          />
        ) : null}
      </div>

      <div
        className="flex items-center gap-2 rounded-md px-[11px] py-2.5"
        style={{
          border: `1px solid ${
            verdictTone === 'cleared'
              ? 'var(--color-status-healthy)'
              : verdictTone === 'failing'
                ? 'var(--color-status-critical)'
                : 'var(--color-neutral-800)'
          }`,
          background: isCleared
            ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)'
            : 'transparent',
          color:
            verdictTone === 'cleared'
              ? 'var(--color-accent-200)'
              : verdictTone === 'failing'
                ? 'var(--color-status-critical)'
                : 'var(--color-neutral-600)',
        }}
      >
        {verdictTone === 'cleared' ? (
          <Trophy size={15} />
        ) : verdictTone === 'failing' ? (
          <WarningDiamond size={15} />
        ) : (
          <Hourglass size={15} />
        )}
        <span className="font-heading text-[12.5px] font-medium">
          {verdictText}
        </span>
      </div>

      {error !== null ? (
        <p
          className="m-0 rounded-md border border-status-saturated/60 px-[11px] py-2.5
                     text-[11.5px] leading-relaxed text-status-critical"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <p className="m-0 text-[11.5px] leading-[1.55] text-pretty text-neutral-400">
        {tip}
      </p>

      <button
        type="button"
        onClick={onReset}
        className="mt-auto flex items-center justify-center gap-1.5 rounded-md border
                   border-divider px-3 py-1.5 font-heading text-xs font-medium
                   transition-colors hover:bg-neutral-800"
      >
        <ArrowCounterClockwise size={13} />
        Reset level
      </button>
    </aside>
  )
}
