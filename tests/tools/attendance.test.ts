import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { client } from '../../src/client.js';
import { webClient } from '../../src/web-client.js';
import { registerAttendanceTools, parseAttendance, looksLoggedOut } from '../../src/tools/attendance.js';
import { createTestHarness } from '../helpers.js';

const NOT_ATTENDED = `<div><a class="nestedInverse btn btn-primary text-uppercase" title="Add this setlist to your attended shows." onclick="var x=1;wicketAjaxGet('/?5:attend-link', function(){});return false;">I was there</a></div>`;
const ATTENDED = `<div><a class="nestedInverse btn btn-info text-uppercase" title="Remove this setlist from your attended shows." onclick="wicketAjaxGet('/?5:remove-link', function(){});return false;">I was there</a></div>`;
// A logged-out setlist.fm page renders a sign-in link (and no authenticated
// attendance control). This is the mid-batch failure mode the bug describes.
const LOGGED_OUT = `<html><body><nav><a href="/signin">Log In</a> <a href="/signup">Sign Up</a></nav><h1>Some Show</h1></body></html>`;
// A page with neither the control nor a sign-in link (e.g. a throttle/error
// interstitial) — the cause is ambiguous, so we keep the generic message.
const UNEXPECTED = `<html><body>503 Service Temporarily Unavailable</body></html>`;

describe('parseAttendance', () => {
  it('reads the not-attended control', () => {
    expect(parseAttendance(NOT_ATTENDED)).toEqual({ ajaxUrl: '/?5:attend-link', attended: false });
  });
  it('reads the attended control', () => {
    expect(parseAttendance(ATTENDED)).toEqual({ ajaxUrl: '/?5:remove-link', attended: true });
  });
  it('decodes HTML entities in the url', () => {
    expect(parseAttendance(NOT_ATTENDED.replace('attend-link', 'a&amp;b'))?.ajaxUrl).toBe('/?5:a&b');
  });
  it('returns null when no control is present', () => {
    expect(parseAttendance('<html>no attendance here</html>')).toBeNull();
  });
});

describe('looksLoggedOut', () => {
  it('detects a logged-out page by its sign-in link', () => {
    expect(looksLoggedOut(LOGGED_OUT)).toBe(true);
  });
  it('does not flag a logged-in page (has the attendance control, no sign-in link)', () => {
    expect(looksLoggedOut(NOT_ATTENDED)).toBe(false);
    expect(looksLoggedOut(ATTENDED)).toBe(false);
  });
  it('does not flag an ambiguous page with neither control nor sign-in link', () => {
    expect(looksLoggedOut(UNEXPECTED)).toBe(false);
  });
});

describe('attendance tools', () => {
  const meta = { url: 'https://www.setlist.fm/setlist/a/2025/v-1234.html', artist: { name: 'A' }, eventDate: '2025-01-01', venue: { name: 'V', city: { name: 'C' } } };
  const mockApi = vi.spyOn(client, 'request').mockResolvedValue(meta as never);
  const mockPage = vi.spyOn(webClient, 'fetchPage').mockResolvedValue('');
  const mockAjax = vi.spyOn(webClient, 'wicketAjaxGet').mockResolvedValue('<ajax-response/>');
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  beforeEach(() => { mockApi.mockClear().mockResolvedValue(meta as never); mockPage.mockReset(); mockAjax.mockClear().mockResolvedValue('<ajax-response/>'); });
  afterAll(async () => { if (harness) await harness.close(); });
  const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

  it('setup', async () => { harness = await createTestHarness((s) => registerAttendanceTools(s, client)); });

  it('mark (confirm) toggles when not attended and verifies via re-read', async () => {
    mockPage.mockResolvedValueOnce(NOT_ATTENDED).mockResolvedValueOnce(ATTENDED);
    const out = parse(await harness.callTool('setlist_mark_attended', { setlistId: '1234', confirm: true }));
    expect(out).toMatchObject({ setlistId: '1234', attended: true, changed: true, verified: true });
    expect(mockAjax).toHaveBeenCalledTimes(1);
    const [ajaxPath, baseUrl] = mockAjax.mock.calls[0];
    expect(ajaxPath).toBe('/?5:attend-link');
    expect(baseUrl).toBe('setlist/a/2025/v-1234.html');
  });

  it('mark is a no-op when already attended (no write)', async () => {
    mockPage.mockResolvedValue(ATTENDED);
    const out = parse(await harness.callTool('setlist_mark_attended', { setlistId: '1234', confirm: true }));
    expect(out).toMatchObject({ attended: true, changed: false });
    expect(mockAjax).not.toHaveBeenCalled();
  });

  it('mark without confirm is a dry run (no write)', async () => {
    mockPage.mockResolvedValue(NOT_ATTENDED);
    const out = parse(await harness.callTool('setlist_mark_attended', { setlistId: '1234' }));
    expect(out).toMatchObject({ dryRun: true, wouldSetAttendedTo: true, currentlyAttended: false });
    expect(mockAjax).not.toHaveBeenCalled();
  });

  it('unmark (confirm) toggles when attended', async () => {
    mockPage.mockResolvedValueOnce(ATTENDED).mockResolvedValueOnce(NOT_ATTENDED);
    const out = parse(await harness.callTool('setlist_unmark_attended', { setlistId: '1234', confirm: true }));
    expect(out).toMatchObject({ attended: false, changed: true, verified: true });
    expect(mockAjax).toHaveBeenCalledTimes(1);
  });

  it('raises a distinct session-expired error when the page renders logged-out', async () => {
    mockPage.mockResolvedValue(LOGGED_OUT);
    const res = await harness.callTool('setlist_mark_attended', { setlistId: '1234', confirm: true });
    expect(res.isError).toBeTruthy();
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/signed out|logged-out/i);
    expect(text).toMatch(/re-copy SETLIST_SESSION_COOKIE/i);
    // No write should be attempted once we know the session is dead.
    expect(mockAjax).not.toHaveBeenCalled();
  });

  it('keeps the generic message when the control is missing for an ambiguous reason', async () => {
    mockPage.mockResolvedValue(UNEXPECTED);
    const res = await harness.callTool('setlist_mark_attended', { setlistId: '1234', confirm: true });
    expect(res.isError).toBeTruthy();
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/rate-limited|layout/i);
    expect(text).toMatch(/control/i);
  });
});
