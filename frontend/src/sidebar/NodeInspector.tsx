/**
 * The config panel for whichever component is selected.
 *
 * Every numeric field is held as the raw string being typed, not as a number.
 * `Number('')` is 0, so numeric state would snap a cleared box back to "0" and
 * make it impossible to blank and retype -- and would send a value the backend
 * rejects. The parsed value is written to the design store only once it is
 * actually valid; until then the box keeps the user's text and says why it is
 * not committed.
 *
 * Bounds mirror the backend's. They are a courtesy, not the enforcement: the
 * API validates every one of these again and is the authority on all of them.
 */

import { useId, useState } from 'react'

import { COMPONENT_CATALOG } from '../design/catalog'
import {
  MAX_LABEL_LENGTH,
  MAX_REPLICAS,
  MAX_SERVICE_RATE_RPS,
  MIN_REPLICAS,
} from '../design/limits'
import type { DesignNode } from '../design/types'
import type { DesignStore } from '../design/useDesign'

/** The backend's own default, shown so the user can see what they override. */
const DEFAULT_CACHE_HIT_PERCENT = 80

const INPUT_CLASS_NAME =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm ' +
  'text-slate-800 focus:border-slate-500 focus:outline-none ' +
  'focus:ring-1 focus:ring-slate-500'

const LABEL_CLASS_NAME = 'mb-1 block text-xs font-medium text-slate-700'

interface FieldNoteProps {
  id: string
  /** True while the typed value is not good enough to commit. */
  isWarning: boolean
  children: React.ReactNode
}

/**
 * The line under a field.
 *
 * Rendered as a sibling of the input and wired up with `aria-describedby`
 * rather than nested inside the `<label>`. Inside the label it would become
 * part of the field's accessible *name*, so a screen reader would announce
 * "Replicas, traffic splits evenly, so each instance sees a 1/6 share" as the
 * name of the box rather than as guidance about it.
 */
function FieldNote({ id, isWarning, children }: FieldNoteProps) {
  return (
    <p
      id={id}
      className={`mt-1 text-[11px] ${
        isWarning ? 'text-amber-700' : 'text-slate-500'
      }`}
    >
      {children}
    </p>
  )
}

interface NumberFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  min: number
  max: number
  step: number
  placeholder?: string
  /** False while the typed value is not being written to the design. */
  isCommitted: boolean
  note: React.ReactNode
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  isCommitted,
  note,
}: NumberFieldProps) {
  const inputId = useId()
  const noteId = `${inputId}-note`

  return (
    <div>
      <label htmlFor={inputId} className={LABEL_CLASS_NAME}>
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={value}
        placeholder={placeholder}
        aria-describedby={noteId}
        aria-invalid={!isCommitted}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS_NAME}
      />
      <FieldNote id={noteId} isWarning={!isCommitted}>
        {note}
      </FieldNote>
    </div>
  )
}

interface NodeInspectorProps {
  node: DesignNode
  design: DesignStore
}

/**
 * The inspector is remounted per selection (see the `key` where it is used), so
 * each field can seed its own local state from the node once and then own it.
 */
export function NodeInspector({ node, design }: NodeInspectorProps) {
  const definition = COMPONENT_CATALOG[node.data.componentType]
  const nameInputId = useId()

  const [replicasText, setReplicasText] = useState(String(node.data.replicas))
  const [serviceRateText, setServiceRateText] = useState(
    node.data.serviceRateRps === null ? '' : String(node.data.serviceRateRps),
  )
  const [hitPercentText, setHitPercentText] = useState(
    node.data.hitRatio === null ? '' : String(node.data.hitRatio * 100),
  )

  const replicas = Number(replicasText)
  const replicasCommitted =
    replicasText.trim() !== '' &&
    Number.isInteger(replicas) &&
    replicas >= MIN_REPLICAS &&
    replicas <= MAX_REPLICAS

  const serviceRate = Number(serviceRateText)
  const serviceRateBlank = serviceRateText.trim() === ''
  const serviceRateCommitted =
    serviceRateBlank ||
    (Number.isFinite(serviceRate) &&
      serviceRate > 0 &&
      serviceRate <= MAX_SERVICE_RATE_RPS)

  const hitPercent = Number(hitPercentText)
  const hitPercentBlank = hitPercentText.trim() === ''
  const hitPercentCommitted =
    hitPercentBlank ||
    (Number.isFinite(hitPercent) && hitPercent >= 0 && hitPercent <= 100)

  const handleReplicasChange = (value: string) => {
    setReplicasText(value)
    const parsed = Number(value)
    if (
      value.trim() !== '' &&
      Number.isInteger(parsed) &&
      parsed >= MIN_REPLICAS &&
      parsed <= MAX_REPLICAS
    ) {
      design.updateNodeConfig(node.id, { replicas: parsed })
    }
  }

  const handleServiceRateChange = (value: string) => {
    setServiceRateText(value)
    if (value.trim() === '') {
      // Blank is a real choice, not an absent one: it means "use the default
      // for this component type", which the request builder sends as omission.
      design.updateNodeConfig(node.id, { serviceRateRps: null })
      return
    }
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_SERVICE_RATE_RPS) {
      design.updateNodeConfig(node.id, { serviceRateRps: parsed })
    }
  }

  const handleHitPercentChange = (value: string) => {
    setHitPercentText(value)
    if (value.trim() === '') {
      design.updateNodeConfig(node.id, { hitRatio: null })
      return
    }
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      design.updateNodeConfig(node.id, { hitRatio: parsed / 100 })
    }
  }

  return (
    <section aria-labelledby="inspector-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="inspector-heading"
          className="text-xs font-semibold tracking-wide text-slate-500 uppercase"
        >
          {definition.label}
        </h2>
        <code className="truncate text-[11px] text-slate-400" title={node.id}>
          {node.id}
        </code>
      </div>

      <div>
        <label htmlFor={nameInputId} className={LABEL_CLASS_NAME}>
          Name
        </label>
        <input
          id={nameInputId}
          type="text"
          value={node.data.label}
          maxLength={MAX_LABEL_LENGTH}
          aria-describedby={`${nameInputId}-note`}
          onChange={(event) => design.renameNode(node.id, event.target.value)}
          className={INPUT_CLASS_NAME}
        />
        <FieldNote id={`${nameInputId}-note`} isWarning={false}>
          Yours alone — the simulation identifies components by id.
        </FieldNote>
      </div>

      <NumberField
        label="Replicas"
        value={replicasText}
        onChange={handleReplicasChange}
        min={MIN_REPLICAS}
        max={MAX_REPLICAS}
        step={1}
        isCommitted={replicasCommitted}
        note={
          replicasCommitted
            ? `Traffic splits evenly, so each instance sees a ${
                replicas === 1 ? 'full share' : `1/${replicas} share`
              }.`
            : `Enter a whole number from ${MIN_REPLICAS} to ${MAX_REPLICAS}. Keeping the last valid value for now.`
        }
      />

      <NumberField
        label="Capacity per instance (rps)"
        value={serviceRateText}
        onChange={handleServiceRateChange}
        min={1}
        max={MAX_SERVICE_RATE_RPS}
        step={100}
        placeholder={String(definition.defaultServiceRateRps)}
        isCommitted={serviceRateCommitted}
        note={
          serviceRateCommitted
            ? serviceRateBlank
              ? 'Empty uses the default for this component type.'
              : 'Overriding the default — this is how you buy a bigger box.'
            : `Enter a rate above 0 and no more than ${MAX_SERVICE_RATE_RPS.toLocaleString()}, or clear the box to use the default.`
        }
      />

      {node.data.componentType === 'cache' && (
        <NumberField
          label="Hit ratio (%)"
          value={hitPercentText}
          onChange={handleHitPercentChange}
          min={0}
          max={100}
          step={5}
          placeholder={String(DEFAULT_CACHE_HIT_PERCENT)}
          isCommitted={hitPercentCommitted}
          note={
            hitPercentCommitted
              ? 'The cache still sees every request; only the misses continue downstream.'
              : 'Enter a percentage from 0 to 100, or clear the box to use the default.'
          }
        />
      )}

      <button
        type="button"
        onClick={() => design.removeNode(node.id)}
        className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-1.5
                   text-sm font-medium text-red-700 transition-colors
                   hover:border-red-300 hover:bg-red-100 focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-red-400"
      >
        Delete component
      </button>
    </section>
  )
}
