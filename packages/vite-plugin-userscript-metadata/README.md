# vite-plugin-userscript-metadata

Writes the Tampermonkey userscript metadata block in front of every entry bundle of a Vite build, so a userscript's header is generated from data instead of being pasted into the built file.

## Use

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import userscriptMetadata from 'vite-plugin-userscript-metadata';

export default defineConfig({
  plugins: [
    userscriptMetadata({
      meta: {
        name: { default: 'example-script', zh: '示例脚本' },
        match: ['https://example.com/*'],
        grant: 'none',
        'run-at': 'document-start',
      },
      injectPackageJson: true,
    }),
  ],
});
```

The built file then starts with:

```js
// ==UserScript==
// @name         example-script
// @name:zh      示例脚本
// @match        https://example.com/*
// @grant        none
// @run-at       document-start
// @version      1.2.3
// ==/UserScript==
```

## Options

| Option              | Type                        | Default  | Meaning                                                   |
| ------------------- | --------------------------- | -------- | --------------------------------------------------------- |
| `meta`              | object                      | —        | The metadata block to render.                             |
| `allowUnknown`      | boolean                     | `true`   | Whether keys outside the built-in set are rendered.       |
| `metaOrder`         | string[]                    | —        | Keys to place first, in the order given.                  |
| `languageOrder`     | string[]                    | `['en']` | Languages to place right after the un-suffixed line.      |
| `injectPackageJson` | boolean \| string \| object | —        | Where the values of the keys `meta` leaves out come from. |

### meta

Keys are written without their leading `@`; a key written with one names the same key. A value is a scalar, a list, or a locale table:

- a scalar renders one line, and numbers render as their text;
- a list renders one line per item;
- a locale table renders one line per language, and its reserved `default` key holds the value that gets no language suffix;
- `true` renders the key on its own, which is what flag keys such as `@noframes` need; `false`, `null` and `undefined` render nothing.

A language tag is normalized to language lower case, script title case and region upper case: `zh-cn` renders as `@name:zh-CN`.

### metaOrder

The keys it names come first, in its order; the keys it leaves out keep the built-in order; keys the userscript managers do not define follow at the end. The built-in order is exported as `defaultMetaOrder`, and `knownMetaKeys` lists the keys it is built from.

### languageOrder

Within one key, the line without a suffix comes first, then the languages named here, then the remaining languages alphabetically.

### injectPackageJson

- `true` reads the nearest package file, searched upwards from the Vite project root;
- a string is the path of the package file;
- an object is used as it is;
- `undefined` and `false` skip the lookup entirely.

The keys `meta` leaves out are filled from the package file's `name`, `version`, `description`, `author` and `license`; an explicit value in `meta` always wins. The informational links — `homepage`, `homepageURL`, `website`, `source`, `supportURL` and the contribution keys — are never filled in: in a repository they name the package rather than the script, so they stay in `meta`.

## Metadata reference

The keys and their languages are the ones the userscript managers define:

- [Tampermonkey userscript header](https://www.tampermonkey.net/documentation.php)
- [Greasy Fork meta keys](https://greasyfork.org/en/help/meta-keys)

## Current limitations

- The block is written by the build only; a development server serves no header.
- Every entry chunk gets the header, so a build with several entries produces several userscripts that carry the same metadata.
- A missing key such as `@name` or `@match` is not reported; the userscript manager refuses the file instead.
- Only one metadata block is supported per build.

## Development

- `rushx build` compiles the package into `dist`.
- `rushx test --run` runs the unit tests and one real Vite build.
- `rushx lint`, `rushx format` and `rushx typecheck` are the repository's usual checks.
