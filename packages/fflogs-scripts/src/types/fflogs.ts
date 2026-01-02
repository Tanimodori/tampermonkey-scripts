export namespace FFlogs {
  export interface Ability {
    icon: null | string;
    id: number;
    isExcludedFromDamageAndHealing: boolean;
    isMelee: boolean;
    isOffGcd: boolean;
    isSimulatedCompositeTick: boolean;
    name: string;
    type: number;
  }

  export interface Actor {
    gameId: number;
    id: number;
    idInReport: number;
    name: string;
    subType: string;
    type: ActorType;
  }

  export interface ActorInstance extends Actor {
    instanceId: number;
  }

  export type ActorType = 'Player' | 'Pet' | 'NPC';
  export type ActorDisposition = 'friendly' | 'enemy' | 'neutral';

  export interface ResourceData {
    absorb: number;
    facing: null | number;
    hitPoints: number;
    magicPoints: number;
    maxHitPoints: number;
    maxMagicPoints: number;
    maxTacticalPoints: number;
    tacticalPoints: number;
    x: number;
    y: number;
  }

  export interface EventBase {
    ability: null | Ability;
    source: null | ActorInstance;
    sourceDisposition: ActorDisposition;
    sourceInstanceId: number;
    sourceRaidMarker: number;
    sourceResources: null | ResourceData;
    target: null | ActorInstance;
    targetDisposition: ActorDisposition;
    targetInstanceId: number;
    targetRaidMarker: number;
    targetResources: null | ResourceData;
    timestamp: number;
  }

  export type StatusEffectInfo = {
    ability: Ability;
    amount: number;
    source: Actor;
    target: Actor;
  };

  export type DamageHitType =
    | 'hit'
    | 'criticalHit'
    | 'blockedHit'
    | 'blockedCriticalHit'
    | 'dodge'
    | 'invulnerable'
    | 'resist'
    | 'parriedHit'
    | 'parriedCriticalHit'
    | 'unknown';

  export interface DamageEventBase extends EventBase {
    absorbed: number;
    absorbedDamage: number;
    absorbedHealing: number;
    amount: number;
    blocked: number;
    bonusPercent: number;
    criticalHitStatusEffects: StatusEffectInfo[];
    criticalHitTotalFromStatusEffects: number;
    directHitStatusEffects: StatusEffectInfo[];
    directHitTotalFromStatusEffects: number;
    effectiveDamage: number;
    effectiveHealing: number;
    hitType: DamageHitType;
    isCriticalHit: number;
    isDirectHit: boolean;
    isMiss: boolean;
    isTick: boolean;
    mitigated: number;
    multiplierStatusEffects: StatusEffectInfo[];
    multiplierTotalFromStatusEffects: number;
    overkill: null | number;
    packetId: number;
    subtractsFromSupportedActor: boolean;
    supportedActor: null | Actor;
    unmitigatedAmount: number;
  }
  export interface DamageEvent extends DamageEventBase {
    type: 'damage';
  }

  export interface CalculatedDamageEvent extends DamageEventBase {
    type: 'calculateddamage';
  }

  export interface ApplyOrRefreshEvent extends EventBase {
    absorb: number;
    appliedByAbility: null | Ability;
    duration: number;
    extraInfo: number;
  }
  export type ApplyBuffOrDebuffEvent = ApplyOrRefreshEvent;

  export interface ApplyBuffEvent extends ApplyOrRefreshEvent {
    type: 'applybuff';
  }
  export interface ApplyDebuffEvent extends ApplyOrRefreshEvent {
    type: 'applydebuff';
  }

  export interface CastEvent extends EventBase {
    isFake: boolean;
    isMelee: boolean;
    type: 'cast';
  }

  export type Event = DamageEvent | CalculatedDamageEvent | ApplyBuffEvent | ApplyDebuffEvent | CastEvent;

  export interface Fight {
    allEvents: Event[];
  }
}
