# tampermonkey-scripts

JavaScript monorepo for ffxiv and userscripts.

**Userscripts**

- **[fflogs-scripts](scripts/fflogs-scripts/README.md)**: FFLogs scripts for personal use
- **[tenhou-pairi-kokei-display](scripts/tenhou-pairi-kokei-display/README.md)**: Display Kokei percentage of ii-shan-ten in Tenhou-Pairi
- **[universalis-zh-data](scripts/universalis-zh-data/README.md)**: Universalis Chinese data redirection script
- **[xivanalysis-zh](scripts/xivanalysis-zh/README.md)**: Display actions and status of xivanalysis report in Chinese
- **[feishu-download](scripts/feishu-download/README.md)**: Download audio and image resources from Feishu pages

**Libraries**

- **[api-sdk-framework](packages/api-sdk-framework/README.md)**: Shared call/endpoint framework behind the repo's API SDKs
- **[xiv-api-provider](packages/xiv-api-provider/README.md)**: API SDK for xivapi in its international and Chinese server editions
- **[xiv-garland-provider](packages/xiv-garland-provider/README.md)**: API SDK for the Garland Tools Chinese mirror, split out of xiv-api-provider and built on api-sdk-framework
- **[xiv-datamine-provider](packages/xiv-datamine-provider/README.md)**: Online access to the SaintCoinach datamining dumps
- **[xiv-datamine-polyfill](packages/xiv-datamine-polyfill/README.md)**: Vite plugin turning a datamining sheet import into a build-time generated module
- **[vite-plugin-userscript-metadata](packages/vite-plugin-userscript-metadata/README.md)**: Vite plugin generating the userscript metadata block in front of each entry bundle
- **[tencent-doc-sdk](packages/tencent-doc-sdk/README.md)**: API SDK for Tencent Docs Open API smartsheet endpoints
- **[universal-fetch-type](packages/universal-fetch-type/README.md)**: Type-only definition of universal fetch used in this repo

**Services**

- **[occult-pot-server](packages/occult-pot-server/README.md)**: Express Server proxying the Tencent Docs smartsheet of occult pot refresh times

**Test**

- **[xiv-datamine-polyfill-e2e-test](tests/xiv-datamine-polyfill-e2e-test/README.md)**: End-to-end checks that the `xiv-datamine-polyfill` Vite plugin embeds in a real consumer build, and that the artifact is data plus a reader and nothing else
- **[xiv-provider-raw-endpoints](tests/xiv-provider-raw-endpoints/README.md)**: Black-box measurement that each provider's dist chunking keeps zod and papaparse out of a bundle naming only raw endpoints

**Example**

- **[api-sdk-design-example](tests/api-sdk-design-example/README.md)**: Executable consumer example of api-sdk-framework

## Development

To build the projects in this repo, try these shell commands:

```
npm install -g @microsoft/rush
rush install
rush build
```

For more information, see the documentation at: https://rushjs.io/
