/// <reference types="node" />

import fs from 'fs';
import { resolve } from 'path';
import { PluginOption } from 'vite';
import pkg from '../package.json';

const metadata = `// ==UserScript==
// @name         feishu-download
// @name:zh      飞书资源下载
// @namespace    http://tanimodori.com/
// @version      ${pkg.version}
// @description  Download audio and image resources from Feishu pages
// @description:zh 在飞书页面中下载音频和图片资源
// @author       ${pkg.author}
// @match        https://*.feishu.cn/*
// @match        https://*.larksuite.com/*
// @include      https://*.feishu.cn/*
// @include      https://*.larksuite.com/*
// @grant        none
// @run-at       document-idle
// @license      ${pkg.license}
// ==/UserScript==
`;

const plugin: PluginOption = {
  name: 'vite-plugin-greasyfork-metadata',
  writeBundle(options, bundle) {
    // get entry file name
    let entryFileNames = options.entryFileNames;
    if (typeof entryFileNames === 'function') {
      console.log(`[greasyfork-metadata] cannot resolve entryFileNames, using 'index.js'`);
      entryFileNames = 'index.js';
    }

    // get entry file code
    if (!(entryFileNames in bundle)) {
      console.log(`[greasyfork-metadata] cannot resolve entryFileNames code`);
      return;
    }
    const chunk = bundle[entryFileNames];
    if (!('code' in chunk)) {
      console.log(`[greasyfork-metadata] cannot resolve entryFileNames code`);
      return;
    }

    // get output file name
    const outputFileName = options.dir ? resolve(options.dir, entryFileNames) : entryFileNames;

    // overwrite bundle
    fs.writeFileSync(outputFileName, metadata + chunk.code);
  },
};

export default plugin;
