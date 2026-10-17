import { useId, useState, type KeyboardEvent } from 'react'
import { useDebouncedField } from '../../../lib/useDebouncedField'
import { MultiSelectDropdown, SelectDropdown } from './FilterDropdown'
import { ChevronIcon, CloseIcon, FilterIcon, FolderIcon, ListIcon, SearchIcon, SparkleIcon } from './FilterIcons'
import SavedSearches from './SavedSearches'
import {
  SEMANTIC_MIN_CHARS,
  STATUS_OPTIONS,
  activeChips,
  extraFilterCount,
  rangeState,
  type ResumeFilterOptions,
  type ResumeFilterValues,
  type ResumeNotice,
  type ViewMode,
} from './resumeFilterModel'
import './ResumeFilters.css'

interface Props {
  filters: ResumeFilterValues
  options: ResumeFilterOptions
  optionsLoading: boolean
  semantic: boolean
  view: ViewMode
  onChange: (patch: Partial<ResumeFilterValues>) => void
  onClearAll: () => void
  onSemanticChange: (on: boolean) => void
  onViewChange: (view: ViewMode) => void
  onApplySaved: (filters: ResumeFilterValues) => void
  onNotice: (notice: ResumeNotice) => void
}

const STATUS_CHOICES = STATUS_OPTIONS.filter(o => o.value)

interface RangeProps {
  groupLabel: string
  minHolder: string
  maxHolder: string
  step: number
  min: string
  max: string
  onMin: (next: string) => void
  onMax: (next: string) => void
}

function RangeFields({ groupLabel, minHolder, maxHolder, step, min, max, onMin, onMax }: RangeProps) {
  const lower = useDebouncedField(min, onMin)
  const upper = useDebouncedField(max, onMax)
  const state = rangeState(lower.draft, upper.draft)
  const hintId = useId()

  function enter(field: typeof lower) {
    return (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') field.flush()
    }
  }

  return (
    <div className="rf-range-wrap">
      <div className={`rf-range${state.invalid ? ' rf-range-invalid' : ''}`} role="group" aria-label={groupLabel}>
        <input
          type="number"
          min={0}
          step={step}
          inputMode="numeric"
          className="rf-range-input"
          placeholder={minHolder}
          aria-label={minHolder}
          aria-invalid={state.invalid}
          aria-describedby={state.invalid ? hintId : undefined}
          value={lower.draft}
          onChange={e => lower.setDraft(e.target.value)}
          onKeyDown={enter(lower)}
        />
        <span className="rf-range-sep" aria-hidden="true">-</span>
        <input
          type="number"
          min={0}
          step={step}
          inputMode="numeric"
          className="rf-range-input"
          placeholder={maxHolder}
          aria-label={maxHolder}
          aria-invalid={state.invalid}
          aria-describedby={state.invalid ? hintId : undefined}
          value={upper.draft}
          onChange={e => upper.setDraft(e.target.value)}
          onKeyDown={enter(upper)}
        />
      </div>
      {state.invalid && (
        <p id={hintId} className="rf-range-hint" role="alert">
          {state.inverted ? 'The maximum must not be below the minimum.' : 'Enter a number of 0 or more.'}
        </p>
      )}
    </div>
  )
}

export default function ResumeFilters({
  filters, options, optionsLoading, semantic, view,
  onChange, onClearAll, onSemanticChange, onViewChange, onApplySaved, onNotice,
}: Props) {
  const [more, setMore] = useState(false)
  const morePanelId = useId()
  const search = useDebouncedField(filters.search, next => onChange({ search: next }))
  const workedAt = useDebouncedField(filters.workedAt, next => onChange({ workedAt: next }))
  const chips = activeChips(filters, options)
  const extra = extraFilterCount(filters)
  const loading = optionsLoading

  return (
    <section className="rf" data-density="compact" aria-label="Search and filter résumés">
      <div className="rf-bar" role="group" aria-label="Search">
        <div className="rf-search">
          <span className="rf-search-icon"><SearchIcon size={14} /></span>
          <input
            type="search"
            className="rf-search-input"
            placeholder="Search skills or names, e.g. Java, Spring Boot"
            aria-label="Search résumés"
            value={search.draft}
            onChange={e => search.setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') search.flush() }}
          />
          {search.draft && (
            <button type="button" className="rf-search-clear" aria-label="Clear search" onClick={() => search.flush('')}>
              <CloseIcon size={12} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`rf-pill rf-semantic${semantic ? ' rf-pill-on' : ''}`}
          aria-pressed={semantic}
          title={semantic
            ? 'Matching by meaning. Click to switch back to keyword search.'
            : 'Match résumés by meaning instead of exact keywords'}
          onClick={() => onSemanticChange(!semantic)}
        >
          <SparkleIcon size={14} />
          <span>Semantic Search</span>{' '}
          <span className="rf-state">{semantic ? 'ON' : 'OFF'}</span>
        </button>

        <div className="rf-seg" role="group" aria-label="View">
          <button
            type="button"
            className={`rf-seg-btn${view === 'folders' ? ' rf-seg-on' : ''}`}
            aria-pressed={view === 'folders'}
            onClick={() => onViewChange('folders')}
          >
            <FolderIcon size={14} />
            <span>Domain Folders</span>
          </button>
          <button
            type="button"
            className={`rf-seg-btn${view === 'all' ? ' rf-seg-on' : ''}`}
            aria-pressed={view === 'all'}
            onClick={() => onViewChange('all')}
          >
            <ListIcon size={14} />
            <span>All Candidates</span>
          </button>
        </div>

        <SavedSearches filters={filters} onApply={onApplySaved} onNotice={onNotice} />
      </div>

      {semantic && filters.search.trim().length < SEMANTIC_MIN_CHARS && (
        <p className="rf-note" role="status">
          Type at least {SEMANTIC_MIN_CHARS} characters to search by meaning. The regular list is shown until then.
        </p>
      )}

      <div className="rf-panel">
        <div className="rf-panel-head">
          <FilterIcon size={14} />
          <span className="rf-panel-label">FILTERS</span>
        </div>

        <div className="rf-panel-body">
          <div className="rf-row" role="group" aria-label="Main filters">
            <SelectDropdown
              label="DOMAIN"
              allLabel="All domains"
              value={filters.businessDomain}
              options={options.businessDomains}
              loading={loading}
              onChange={v => onChange({ businessDomain: v })}
            />
            <MultiSelectDropdown
              label="SKILL"
              values={filters.skills}
              options={options.skills}
              loading={loading}
              hint="Résumés must match every selected skill."
              onChange={v => onChange({ skills: v })}
            />
            <SelectDropdown
              label="SENIORITY"
              allLabel="All levels"
              value={filters.seniority}
              options={options.seniorities}
              loading={loading}
              onChange={v => onChange({ seniority: v })}
            />
            <SelectDropdown
              label="STATUS"
              allLabel="All statuses"
              value={filters.status}
              options={STATUS_CHOICES}
              onChange={v => onChange({ status: v })}
            />
            <RangeFields
              groupLabel="Years of experience"
              minHolder="Min yrs"
              maxHolder="Max yrs"
              step={1}
              min={filters.experienceMin}
              max={filters.experienceMax}
              onMin={next => onChange({ experienceMin: next })}
              onMax={next => onChange({ experienceMax: next })}
            />
            <button
              type="button"
              className={`rf-more${more ? ' rf-more-on' : ''}`}
              aria-expanded={more}
              aria-controls={morePanelId}
              onClick={() => setMore(m => !m)}
            >
              <span>More filters</span>
              {extra > 0 && (
                <>
                  <span className="rf-badge" aria-hidden="true">{extra}</span>
                  <span className="rf-sr-only">{` ${extra} active`}</span>
                </>
              )}
              <span className={`rf-more-chevron${more ? ' rf-more-chevron-open' : ''}`}><ChevronIcon size={12} /></span>
            </button>
          </div>

          <div id={morePanelId} className="rf-more-panel" role="group" aria-label="More filters" hidden={!more}>
            <div className="rf-row">
              <SelectDropdown
                label="ROLE"
                allLabel="All roles"
                value={filters.role}
                options={options.roles}
                loading={loading}
                onChange={v => onChange({ role: v })}
              />
              <SelectDropdown
                label="EDUCATION"
                allLabel="All education levels"
                value={filters.educationLevel}
                options={options.educationLevels}
                loading={loading}
                onChange={v => onChange({ educationLevel: v })}
              />
              <SelectDropdown
                label="INDUSTRY"
                allLabel="All industries"
                value={filters.industry}
                options={options.industries}
                loading={loading}
                onChange={v => onChange({ industry: v })}
              />
              <RangeFields
                groupLabel="Salary expectation"
                minHolder="Min salary"
                maxHolder="Max salary"
                step={1000}
                min={filters.salaryMin}
                max={filters.salaryMax}
                onMin={next => onChange({ salaryMin: next })}
                onMax={next => onChange({ salaryMax: next })}
              />
            </div>
            <div className="rf-row rf-row-full">
              <input
                type="text"
                className="rf-worked"
                placeholder="Worked At, searches career history"
                aria-label="Worked At, searches career history"
                value={workedAt.draft}
                onChange={e => workedAt.setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') workedAt.flush() }}
              />
            </div>
          </div>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="rf-chips">
          <ul className="rf-chip-list" aria-label="Active filters">
            {chips.map(chip => (
              <li key={chip.id} className="rf-chip">
                <span className="rf-chip-text">{chip.label}</span>
                <button
                  type="button"
                  className="rf-chip-x"
                  aria-label={`Remove ${chip.label}`}
                  onClick={() => onChange(chip.clear)}
                >
                  <CloseIcon size={10} />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="rf-clear-all" onClick={onClearAll}>Clear all</button>
        </div>
      )}
    </section>
  )
}
