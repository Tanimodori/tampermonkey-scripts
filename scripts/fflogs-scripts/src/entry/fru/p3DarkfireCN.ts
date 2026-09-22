const blizzard = '延迟咏唱：黑暗冰封';
const fire = '延迟咏唱：黑暗爆炎';
const unholy = '延迟咏唱：黑暗神圣';
const fireCast = '黑暗爆炎';

let count: Record<number, number[]> = {};
initializePinForFight = (fight) => {
  for (const event of fight.allEvents) {
    if (event.type === 'damage' && event.ability?.name === fireCast) {
      const id = event.sourceInstanceId;
      if (count[id]) {
        count[id].push(event.timestamp);
      } else {
        count[id] = [event.timestamp];
      }
    }
  }
};

pinMatchesFightEvent = (event, _fight) => {
  if (event.type === 'damage' && event.ability?.name === fireCast) {
    const arr = count[event.sourceInstanceId];
    if (!arr) {
      return false;
    }
    return arr.filter((t) => Math.abs(t - event.timestamp) < 500).length > 1;
  } else if (event.type === 'applydebuff' && [blizzard, fire, unholy].includes(event.ability?.name as string)) {
    return true;
  }
  return false;
};
