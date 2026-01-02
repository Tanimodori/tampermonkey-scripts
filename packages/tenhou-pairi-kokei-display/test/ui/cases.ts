import { TestCase, buildTestCases } from './builder';

export const testCases: TestCase[] = buildTestCases([
  {
    input: '19m19s19p123456z5m2p',
    calculated: {
      shanten: { standard: 1, normal: 7 },
      result: [
        ['5m', '19m19s19p123456z', 40],
        ['2p', '19m19s19p123456z', 40],
      ],
    },
    expected: {
      result: [
        ['5m', '19m19s19p123456z', 40, '', 0],
        ['2p', '19m19s19p123456z', 40, '', 0],
      ],
    },
  },
]);
