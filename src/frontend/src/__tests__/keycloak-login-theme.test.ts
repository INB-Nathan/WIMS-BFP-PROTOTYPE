import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const themeRoot = resolve(here, '../../../keycloak/themes/wims-bfp/login');
const readThemeFile = (path: string) => readFileSync(resolve(themeRoot, path), 'utf-8');

describe('Keycloak login theme parity', () => {
  it('keeps the public theme mode and return control on the SSO screen', () => {
    expect(readThemeFile('theme.properties')).toContain('script/theme.js');
    expect(readThemeFile('resources/script/theme.js')).toContain("localStorage.getItem('landing-theme')");
    expect(readThemeFile('template.ftl')).toContain('class="wims-return-link"');
    const css = readThemeFile('resources/css/wims-custom.css');
    expect(css).toContain('Shared public-surface presentation');
    expect(css).toContain('.pf-v5-c-login__main-body:not(:has(.wims-totp-setup))');
  });
});
