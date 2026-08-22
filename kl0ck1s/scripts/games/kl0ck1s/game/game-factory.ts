// @ts-nocheck
import {GameEventBus} from "./game-events.js";
import {GameProgressionService} from "./game-progression-service.js";
import {GameScoringService} from "./game-scoring-service.js";

export interface GameDomainHost {
    progressionService: GameProgressionService;
    scoringService: GameScoringService;
    events: GameEventBus;
}

type ConstructorHost = Parameters<typeof GameProgressionService>[0] & Parameters<typeof GameScoringService>[0];

export function initializeGameDomainServices<T extends object>(host: T): T & GameDomainHost {
    const target = host as T & Partial<GameDomainHost>;

    target.events = new GameEventBus();
    target.progressionService = new GameProgressionService(target as ConstructorHost);
    target.scoringService = new GameScoringService(
        target as ConstructorHost,
        target.progressionService,
    );

    return target as T & GameDomainHost;
}
