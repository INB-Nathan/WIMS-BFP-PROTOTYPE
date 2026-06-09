/**
 * Reproduction test for Issue #231: MFA TOTP setup page styling broken.
 *
 * The .wims-totp-grid-layout uses unbalanced fr values (0.9fr / 1.25fr)
 * that starve the left (instructions) column. The fix rebalances to
 * ~equal fr values: 1fr / 1.15fr.
 *
 * This test reads the real Keycloak theme CSS, builds the TOTP setup
 * HTML structure from login-config-totp.ftl, and asserts the computed
 * grid-template-columns matches the post-fix expected value.
 *
 * On the unmodified base commit, this test MUST FAIL because the CSS
 * still has the old unbalanced values.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/** Find a CSSStyleRule by exact selector text from the first stylesheet. */
function findCssRule(doc: Document, selector: string): CSSStyleRule | null {
  const ss = doc.styleSheets[0];
  if (!ss) return null;
  for (let i = 0; i < ss.cssRules.length; i++) {
    const rule = ss.cssRules[i] as CSSStyleRule;
    if (rule.selectorText === selector) return rule;
  }
  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CSS_PATH = resolve(
  __dirname,
  '../../../keycloak/themes/wims-bfp/login/resources/css/wims-custom.css',
);

function readThemeCss(): string {
  return readFileSync(CSS_PATH, 'utf-8');
}

function buildTotpSetupDOM(): Document {
  const css = readThemeCss();

  // Minimal HTML matching the login-config-totp.ftl structure
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div class="wims-totp-setup">
    <div class="wims-totp-grid-layout">
      <section class="wims-totp-guidance">
        <h2>Setup Instructions</h2>
        <ol class="wims-totp-steps">
          <li>
            <span class="wims-totp-step-number">1</span>
            <div><p>Step 1 description</p></div>
          </li>
          <li>
            <span class="wims-totp-step-number">2</span>
            <div><p>Step 2 description</p></div>
          </li>
          <li>
            <span class="wims-totp-step-number">3</span>
            <div><p>Step 3 description</p></div>
          </li>
        </ol>
      </section>
      <section class="wims-totp-entry"></section>
    </div>
  </div>
</body>
</html>`;

  const dom = new JSDOM(html);
  const style = dom.window.document.createElement('style');
  style.textContent = css;
  dom.window.document.head.appendChild(style);

  return dom.window.document;
}

describe('TOTP Setup Page Styling (Issue #231)', () => {
  it('grid-template-columns on .wims-totp-grid-layout should use balanced fr values', () => {
    const doc = buildTotpSetupDOM();
    const grid = doc.querySelector('.wims-totp-grid-layout') as HTMLElement;
    const styles = doc.defaultView!.getComputedStyle(grid);

    // Post-fix expected: left column gets 1fr (was 0.9fr), right gets 1.15fr (was 1.25fr).
    // This prevents the left (instructions) column from being visually starved.
    expect(styles.gridTemplateColumns).toBe(
      'minmax(260px, 1fr) minmax(310px, 1.15fr)',
    );
  });

  it('gap on .wims-totp-steps > li should be widened to 0.6rem', () => {
    const doc = buildTotpSetupDOM();
    const li = doc.querySelector('.wims-totp-steps > li') as HTMLElement;
    const styles = doc.defaultView!.getComputedStyle(li);

    // Post-fix: gap widened from 0.45rem to 0.6rem for breathing room.
    expect(styles.gap).toBe('0.6rem');
  });

  it('padding on .wims-totp-setup should use two-value clamp shorthand', () => {
    // jsdom cannot parse clamp(), so verify the raw CSS source.
    const css = readThemeCss();
    const match = css.match(/\.wims-totp-setup\s*\{[^}]+padding:\s*([^;!]+)/);
    expect(match).not.toBeNull();

    // Post-fix: padding raised with two-value shorthand (vertical, horizontal).
    expect(match![1].trim()).toBe(
      'clamp(0.85rem, 1.6vw, 1.1rem) clamp(0.7rem, 1.2vw, 0.95rem)',
    );
  });

  it('width and height on .wims-totp-step-number should be widened to 1.55rem', () => {
    const doc = buildTotpSetupDOM();
    const stepNumber = doc.querySelector('.wims-totp-step-number') as HTMLElement;
    const styles = doc.defaultView!.getComputedStyle(stepNumber);

    // Post-fix: step circles widened from 1.35rem to 1.55rem.
    // jsdom reports the raw declared value for fixed rem dimensions.
    expect(styles.width).toBe('1.55rem');
    expect(styles.height).toBe('1.55rem');
  });

  it('line-height on .wims-totp-steps p should be increased to 1.35', () => {
    const doc = buildTotpSetupDOM();
    // jsdom has a specificity quirk where the global p !important overrides
    // the more-specific .wims-totp-steps p !important. Inspect the CSS rule directly.
    const rule = findCssRule(doc, '.wims-totp-steps p, .wims-totp-entry p');
    expect(rule).not.toBeNull();

    // Post-fix: line-height increased from 1.25 to 1.35 for readability.
    expect(rule!.style.lineHeight).toBe('1.35');
  });
});
