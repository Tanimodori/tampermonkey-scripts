import { FFlogs } from './fflogs';

declare global {
  var initializePinForFight: (fight: FFlogs.Fight) => any;
  var pinMatchesFightEvent: (event: FFlogs.Event, fight: FFlogs.Fight) => any;
}
export {};
