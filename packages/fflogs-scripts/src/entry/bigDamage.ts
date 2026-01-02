globalThis.pinMatchesFightEvent = (event, _fight) => {
  const tankFactor = 2;
  const tanks = [
    '战士',
    '骑士',
    '暗黑骑士',
    '绝枪战士',
    'Warrior',
    'Paladin',
    'DarkKnight',
    'Gunbreaker',
    '戦士',
    'ナイト',
    '暗黒騎士',
    'ガンブレイカー',
  ];
  if (event.targetDisposition === 'friendly') {
    const maxhp = event.targetResources?.maxHitPoints ?? 0;
    const factor = tanks.includes(event.target?.subType as string) ? tankFactor : 1;
    if (event.type === 'damage') {
      const unmitigated = event.unmitigatedAmount;
      if (unmitigated * 1.1 * factor >= maxhp) {
        return true;
      }
    }
    if (event.type === 'calculateddamage') {
      const absorbPercent = event.targetResources?.absorb ?? 0;
      const absorb = (absorbPercent / 100) * maxhp;
      const mitigatePercent = event.amount / event.unmitigatedAmount;
      if (mitigatePercent === 0) {
        return false;
      }
      const unmitigated = (event.amount + absorb) / mitigatePercent;
      if (unmitigated * 1.1 * factor >= maxhp) {
        return true;
      }
    }
  }
  return false;
};
