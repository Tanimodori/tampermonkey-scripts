import { describe, expect, it } from 'vitest';
import { iconFolder, iconIdFromImageUrl, iconIdFromTexturePath, paddedIconId, siteIconPath, texturePath, texturePathWithoutExtension } from '@/icon.ts';
import type { IconField } from '@/providers/xivapi/types/schema.ts';

const icon: IconField = { id: 3554, path: 'ui/icon/003000/003554.tex', path_hr1: 'ui/icon/003000/003554_hr1.tex' };

describe('icon addressing', () => {
  it('pads to the six digits the texture folders use', () => {
    expect(paddedIconId(3554)).toBe('003554');
    expect(paddedIconId(20705)).toBe('020705');
    expect(iconFolder(3554)).toBe('003000');
  });

  it('reproduces the path universalis expects in an img src', () => {
    // Straight from `universalis-zh-data/src/index.ts`'s getIconUrl, which takes the first **three**
    // digits of the zero-padded id and appends `000`. That makes the folder `060000`, not `60100` — easy
    // to misremember, and the userscript only works because it renders its own URLs back to itself.
    expect(siteIconPath(60101)).toBe('/i/060000/060101.png');
    expect(siteIconPath(20705)).toBe('/i/020000/020705.png');
    expect(siteIconPath(3554)).toBe('/i/003000/003554.png');
  });

  it('prefers the high-resolution texture and can fall back', () => {
    expect(texturePath(icon)).toBe('ui/icon/003000/003554_hr1.tex');
    expect(texturePath(icon, false)).toBe('ui/icon/003000/003554.tex');
    expect(texturePathWithoutExtension(icon.path)).toBe('ui/icon/003000/003554');
  });

  it('round-trips an id through the texture path', () => {
    expect(iconIdFromTexturePath(icon.path)).toBe(3554);
    expect(iconIdFromTexturePath(icon.path_hr1)).toBe(3554);
    expect(iconIdFromTexturePath('ui/icon/003000/notanumber.tex')).toBeNull();
  });

  it('recovers an id from the two image URL shapes the DOM shows', () => {
    // The game's own markup, which is what `xivanalysis-zh/src/translate/icon.ts` reads off `element.src`.
    expect(iconIdFromImageUrl('https://xivanalysis.com/img/ui/icon/035000/035509_1.png')).toBe(35509);
    // And the site path this module produces.
    expect(iconIdFromImageUrl('https://universalis.app/i/020000/020705.png')).toBe(20705);
    expect(iconIdFromImageUrl('https://universalis.app/i/universalis/error.png')).toBeNull();
  });
});
