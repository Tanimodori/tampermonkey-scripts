globalThis.pinMatchesFightEvent = (event) => {
  return ['Maelstrom', '巨漩涡', 'Tidal Light', '光之巨浪'].includes(event.ability?.name as string);
};
