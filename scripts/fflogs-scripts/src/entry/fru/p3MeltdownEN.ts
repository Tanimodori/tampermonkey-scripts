const blizzard = 'Spell-in-Waiting: Dark Blizzard III';
const fire = 'Spell-in-Waiting: Dark Fire III';
const unholy = 'Spell-in-Waiting: Unholy Darkness';
const meltdown = 'Sinbound Meltdown';
const th = ['Warrior', 'Paladin', 'DarkKnight', 'Gunbreaker', 'WhiteMage', 'Scholar', 'Astrologian', 'Sage'];
const offsets = [17000, 27000, 38000];

let ans: Record<string, number> = {};
initializePinForFight = (fight) => {
  for (const event of fight.allEvents) {
    if (event.type === 'applydebuff') {
      const time = event.timestamp;
      const tName = event.target?.name as string;
      if (event.ability?.name === blizzard) {
        if (th.includes(event.target?.subType as string)) {
          ans[tName] = time + offsets[1]; // TH blizzard = 2nd
        } else {
          ans[tName] = time + offsets[0]; // D blizzard = 1st
        }
      } else if (event.ability?.name === fire) {
        const duration = event.duration;
        if (duration === 11000) {
          ans[tName] = time + offsets[1]; // 2nd
        } else if (duration === 21000) {
          ans[tName] = time + offsets[2]; // 3rd
        } else {
          ans[tName] = time + offsets[0]; // 1st
        }
      }
    }
  }
};

pinMatchesFightEvent = (event, _fight) => {
  if (event.type === 'damage' && event.ability?.name === meltdown) {
    const time = event.timestamp;
    const tName = event.target?.name ?? '';
    const expectedTime = ans[tName];
    if (!expectedTime) {
      return false;
    }
    if (Math.abs(time - expectedTime) < 500) {
      return false; // match
    } else {
      return true; // unexpected
    }
  } else if (event.type === 'applydebuff' && [blizzard, fire, unholy].includes(event.ability?.name as string)) {
    return true;
  }
  return false;
};
