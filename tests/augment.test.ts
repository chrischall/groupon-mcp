import { describe, it, expect } from 'vitest';
import { augmentSetlists } from '../src/augment.js';

describe('augmentSetlists', () => {
  it('adds songCount/setCount/hasSongs to a populated setlist', () => {
    const out = augmentSetlists({
      id: 'x',
      sets: { set: [{ song: [{ name: 'a' }, { name: 'b' }] }, { encore: 1, song: [{ name: 'c' }] }] },
    });
    expect(out.songCount).toBe(3);
    expect(out.setCount).toBe(2);
    expect(out.hasSongs).toBe(true);
  });

  it('flags an empty stub setlist (sets.set: [])', () => {
    const out = augmentSetlists({ id: 'stub', sets: { set: [] } });
    expect(out.songCount).toBe(0);
    expect(out.setCount).toBe(0);
    expect(out.hasSongs).toBe(false);
  });

  it('annotates every setlist in a search response and leaves non-setlists alone', () => {
    const res = augmentSetlists({
      type: 'setlists',
      total: 2,
      setlist: [
        { id: 'a', sets: { set: [{ song: [{ name: 's' }] }] }, venue: { name: 'V' } },
        { id: 'b', sets: { set: [] } },
      ],
    });
    expect(res.setlist[0].hasSongs).toBe(true);
    expect(res.setlist[0].songCount).toBe(1);
    expect(res.setlist[1].hasSongs).toBe(false);
    // The venue object has no `sets`, so it is not annotated.
    expect(res.setlist[0].venue.songCount).toBeUndefined();
  });

  it('handles undefined and missing sets gracefully', () => {
    expect(augmentSetlists(undefined)).toBeUndefined();
    const out = augmentSetlists({ id: 'no-sets' }) as Record<string, unknown>;
    expect(out.songCount).toBeUndefined();
  });
});
