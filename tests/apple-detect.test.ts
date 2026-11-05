import { describe, expect, it } from 'vitest';

import { APPLE_DETECT_SCRIPT } from '@/lib/client/apple-detect';

/**
 * Runs the real inline script against a fake browser. The script is a string
 * that ships in the page head, so the only honest test is to execute that exact
 * string, not a re-implementation of its logic.
 */
function run(opts: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standaloneFlag?: boolean;
  displayModeStandalone?: boolean;
  throwOnNavigator?: boolean;
}) {
  const dataset: Record<string, string> = {};
  const document = { documentElement: { dataset } };
  const navigator = opts.throwOnNavigator
    ? new Proxy(
        {},
        {
          get() {
            throw new Error('navigator unavailable');
          },
        },
      )
    : {
        userAgent: opts.userAgent,
        platform: opts.platform ?? '',
        maxTouchPoints: opts.maxTouchPoints ?? 0,
        standalone: opts.standaloneFlag,
      };
  const window = {
    matchMedia: () => ({ matches: Boolean(opts.displayModeStandalone) }),
  };

  new Function('document', 'navigator', 'window', APPLE_DETECT_SCRIPT)(
    document,
    navigator,
    window,
  );
  return dataset;
}

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAC_SAFARI = IPAD_DESKTOP_MODE;
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAC_EDGE = `${MAC_CHROME} Edg/130.0.0.0`;
const MAC_FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

describe('apple detection script', () => {
  it('marks an iPhone', () => {
    expect(run({ userAgent: IPHONE }).apple).toBe('1');
  });

  it('marks an iPad that reports as a Mac (iPadOS desktop mode) because it has touch', () => {
    expect(
      run({ userAgent: IPAD_DESKTOP_MODE, platform: 'MacIntel', maxTouchPoints: 5 }).apple,
    ).toBe('1');
  });

  it('marks desktop Safari on a Mac', () => {
    expect(run({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }).apple).toBe('1');
  });

  it('does not mark Chrome, Edge or Firefox running on a Mac', () => {
    for (const userAgent of [MAC_CHROME, MAC_EDGE, MAC_FIREFOX]) {
      expect(run({ userAgent, platform: 'MacIntel', maxTouchPoints: 0 }).apple).toBeUndefined();
    }
  });

  it('does not mark Android', () => {
    expect(run({ userAgent: ANDROID, platform: 'Linux armv81', maxTouchPoints: 5 }).apple).toBeUndefined();
  });

  it('does not mark Windows, even a touch laptop', () => {
    expect(run({ userAgent: WINDOWS, platform: 'Win32', maxTouchPoints: 10 }).apple).toBeUndefined();
  });

  it('flags a Home Screen launch via navigator.standalone', () => {
    const result = run({ userAgent: IPHONE, standaloneFlag: true });
    expect(result.apple).toBe('1');
    expect(result.standalone).toBe('1');
  });

  it('flags a Home Screen launch via display-mode: standalone', () => {
    expect(run({ userAgent: IPHONE, displayModeStandalone: true }).standalone).toBe('1');
  });

  it('does not flag standalone for a Safari tab', () => {
    expect(run({ userAgent: IPHONE }).standalone).toBeUndefined();
  });

  it('never throws, even if navigator is unavailable', () => {
    expect(() => run({ userAgent: '', throwOnNavigator: true })).not.toThrow();
  });
});
