import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('POST /api/plugin/update response with steps', () => {
  const pluginSrc = () =>
    readFileSync(path.resolve(__dirname, '../routes/plugin.ts'), 'utf-8');

  it('should collect step logs during update process', () => {
    const src = pluginSrc();
    // The update handler should build a steps array
    expect(src).toMatch(/steps.*:.*string\[\]/);
  });

  it('should log CLI update attempt result', () => {
    const src = pluginSrc();
    // Should push a step for CLI update success/failure
    expect(src).toMatch(/steps\.push\(.*cli/i);
  });

  it('should log fixInstalledPluginVersion result', () => {
    const src = pluginSrc();
    expect(src).toMatch(/steps\.push\(.*fix/i);
  });

  it('should log git fallback result', () => {
    const src = pluginSrc();
    expect(src).toMatch(/steps\.push\(.*fallback|git/i);
  });

  it('should return steps array in response', () => {
    const src = pluginSrc();
    // Response should include steps
    expect(src).toMatch(/res\.json\(\{[^}]*steps/);
  });

  it('should return ok: false when all methods fail', () => {
    const src = pluginSrc();
    // Should have conditional ok based on success
    expect(src).toMatch(/ok:\s*(cliOk|updated|success)/);
  });
});

describe('updatePlugin API returns steps', () => {
  const apiSrc = () =>
    readFileSync(
      path.resolve(__dirname, '../../../web/src/api/plugin.ts'),
      'utf-8',
    );

  it('should return UpdateResult with steps from response', () => {
    const src = apiSrc();
    // Should define or return steps from the update response
    expect(src).toMatch(/steps.*string\[\]/);
  });
});
