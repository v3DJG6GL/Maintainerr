import { describe, expect, it } from 'vitest'
import { act, renderHook } from '../../test-utils/render'
import {
  getCollectionMediaSortConfig,
  getCollectionSortConfig,
  useMediaLibrarySort,
} from './MediaLibrarySortControl'

const statusSortValues = ['manual.desc', 'excluded.desc']

const valuesOf = (options: ReadonlyArray<{ value: string }>) =>
  options.map((option) => option.value)

describe('getCollectionMediaSortConfig', () => {
  it('offers the status sorts to the collection media page', () => {
    const values = valuesOf(
      getCollectionMediaSortConfig('movie', true, false, true).options,
    )

    expect(values).toEqual(expect.arrayContaining(statusSortValues))
  })

  // The rule group form persists its selection as the order pushed to the media
  // server, and that path resolves media-server metadata without Maintainerr
  // state - so every comparison would tie and the remote collection would be
  // reordered arbitrarily. It calls this with the status sorts left off.
  it('withholds them from the persisted media server sort selector', () => {
    const values = valuesOf(getCollectionMediaSortConfig('movie', true).options)

    statusSortValues.forEach((value) => expect(values).not.toContain(value))
  })

  // The exclusions tab shares the config this builds on and lists nothing but
  // exclusions, so "Excluded First" would be meaningless there.
  it('keeps them out of the shared collection config', () => {
    const values = valuesOf(getCollectionSortConfig('movie').options)

    statusSortValues.forEach((value) => expect(values).not.toContain(value))
  })

  it('offers the studio sorts only when the media server can sort by studio', () => {
    expect(
      valuesOf(getCollectionMediaSortConfig('movie', true, true, true).options),
    ).toEqual(expect.arrayContaining(['studio.asc', 'studio.desc']))
    expect(
      valuesOf(
        getCollectionMediaSortConfig('movie', true, false, true).options,
      ),
    ).not.toContain('studio.asc')
  })
})

describe('analytics browsing sorts', () => {
  it('retains the chosen analytics source when capabilities remove it until a native sort is selected', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useMediaLibrarySort(
          getCollectionSortConfig(
            'movie',
            undefined,
            false,
            enabled ? ['tracearr'] : [],
          ),
        ),
      { initialProps: { enabled: true } },
    )
    act(() => {
      result.current.onSortChange('tracearrWatchTime.desc')
    })
    rerender({ enabled: false })
    expect(result.current.sortValue).toBe('tracearrWatchTime.desc')
    expect(result.current.sortParams).toEqual({
      sort: 'tracearrWatchTime',
      sortOrder: 'desc',
    })
    expect(result.current.sortUnavailable).toBe(true)
    expect(
      result.current.options.find(
        (option) => option.value === 'tracearrWatchTime.desc',
      )?.label,
    ).toContain('(unavailable)')
    act(() => {
      result.current.onSortChange('title.asc')
    })
    expect(result.current.sortUnavailable).toBe(false)
    expect(result.current.sortParams).toEqual({
      sort: 'title',
      sortOrder: 'asc',
    })
    expect(
      result.current.options.some(
        (option) => option.value === 'tracearrWatchTime.desc',
      ),
    ).toBe(false)
  })

  it('keeps analytics out of the persisted rule sort selector unless browsing opts in', () => {
    const native = valuesOf(getCollectionMediaSortConfig('movie', true).options)
    expect(
      native.some(
        (value) =>
          value.startsWith('tracearr') || value.startsWith('streamystats'),
      ),
    ).toBe(false)
    const browse = getCollectionMediaSortConfig('movie', true, false, true, [
      'tracearr',
    ])
    expect(valuesOf(browse.options)).toContain('tracearrWatchTime.desc')
    expect(valuesOf(browse.options)).not.toContain('streamystatsWatchTime.desc')
    expect(
      browse.options.find((option) => option.value === 'tracearrPlayCount.desc')
        ?.label,
    ).toBe('Tracearr - Most played')
    expect(
      browse.options.find((option) => option.value === 'watchCount.desc')
        ?.label,
    ).toBe('Media server - Most played')
  })

  it('offers both count and time directions for the explicitly enabled source', () => {
    const options = getCollectionSortConfig('show', undefined, false, [
      'streamystats',
    ]).options
    expect(valuesOf(options)).toEqual(
      expect.arrayContaining([
        'streamystatsPlayCount.asc',
        'streamystatsPlayCount.desc',
        'streamystatsWatchTime.asc',
        'streamystatsWatchTime.desc',
      ]),
    )
    expect(valuesOf(options)).not.toContain('tracearrPlayCount.desc')
  })
})
