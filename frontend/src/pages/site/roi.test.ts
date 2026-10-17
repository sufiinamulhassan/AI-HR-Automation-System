import { describe, expect, it } from 'vitest'
import { ROI_LIMIT, calcRoi, formatHours, formatValue, parseAmount } from './roi'

const base = { roles: 5, applicants: 100, minutesNow: 5, minutesAfter: 2, hourlyCost: 0 }

describe('parseAmount', () => {
  it('reads plain numbers, decimals and thousands separators', () => {
    expect(parseAmount('12')).toBe(12)
    expect(parseAmount(' 7.5 ')).toBe(7.5)
    expect(parseAmount('1,250')).toBe(1250)
  })

  it('treats empty, text and negative input as zero', () => {
    expect(parseAmount('')).toBe(0)
    expect(parseAmount('abc')).toBe(0)
    expect(parseAmount('-4')).toBe(0)
    expect(parseAmount('NaN')).toBe(0)
    expect(parseAmount('Infinity')).toBe(0)
  })

  it('caps very large input', () => {
    expect(parseAmount('99999999999')).toBe(ROI_LIMIT)
  })
})

describe('calcRoi', () => {
  it('works out hours today, hours with ranking and the difference', () => {
    const result = calcRoi(base)
    expect(result.resumesPerMonth).toBe(500)
    expect(result.hoursNow).toBeCloseTo(41.667, 2)
    expect(result.hoursAfter).toBeCloseTo(16.667, 2)
    expect(result.hoursSavedMonth).toBeCloseTo(25, 5)
    expect(result.hoursSavedYear).toBeCloseTo(300, 5)
    expect(result.shareSaved).toBeCloseTo(0.6, 5)
  })

  it('turns hours into value only when an hourly cost is given', () => {
    expect(calcRoi(base).valueSavedMonth).toBe(0)
    const priced = calcRoi({ ...base, hourlyCost: 40 })
    expect(priced.valueSavedMonth).toBeCloseTo(1000, 5)
    expect(priced.valueSavedYear).toBeCloseTo(12000, 5)
  })

  it('never reports negative savings', () => {
    const result = calcRoi({ ...base, minutesNow: 2, minutesAfter: 5 })
    expect(result.hoursSavedMonth).toBe(0)
    expect(result.hoursSavedYear).toBe(0)
    expect(result.shareSaved).toBe(0)
  })

  it('handles zero input without dividing by zero', () => {
    const result = calcRoi({ roles: 0, applicants: 0, minutesNow: 0, minutesAfter: 0, hourlyCost: 0 })
    expect(result.hoursNow).toBe(0)
    expect(result.shareSaved).toBe(0)
    expect(Number.isNaN(result.hoursSavedMonth)).toBe(false)
  })
})

describe('formatting', () => {
  it('shows one decimal for small hour counts and none for large ones', () => {
    expect(formatHours(2.46)).toBe('2.5')
    expect(formatHours(41.667)).toBe('42')
    expect(formatHours(1250)).toBe('1,250')
  })

  it('shows values as whole numbers with separators', () => {
    expect(formatValue(12000)).toBe('12,000')
    expect(formatValue(999.6)).toBe('1,000')
  })
})
