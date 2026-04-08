# BOTS System Reference

This document describes the bot system in `packages/shared/src/bots` and serves as the baseline reference for future bot extension discussions.

## Goals

- Keep bot behavior reusable across environments (client dev bots now, server-side bots later).
- Separate decision logic from input transport.
- Keep behavior role-aware (`shredders`, `enforcers`) and stateful per bot.
- Keep tuning centralized and easy to adjust.

## High-Level Architecture

The bot system is split into five layers:

1. **Perception + Types** (`types.ts`)
2. **Static map awareness** (`mapAwareness.ts`)
3. **Navigation helpers** (`navigation.ts`)
4. **Memory + event ingestion** (`memory.ts`)
5. **Role strategy + runtime orchestration** (`strategies/*`, `runtime.ts`)

The client adapter (`packages/client/src/bots/useDevBotController.ts`) is intentionally thin:

- It builds `BotPerceptionSnapshot` from Colyseus state.
- It forwards transient events (`interactable_event`, `ticker_event`) to the runtime.
- It calls runtime `step()` on decision ticks.
- It translates `BotCommand` into virtual key input on a separate input tick.

## Runtime Flow

`createBotRuntime()` in `runtime.ts` owns one bot brain instance.

Per decision step:

1. Snapshot is received.
2. Room IDs are hydrated via `computeRoomIds(...)`.
3. Pending events are ingested into memory.
4. Memory is refreshed from current snapshot (`refreshMemoryFromSnapshot`).
5. Role strategy is resolved from team assignment.
6. Pause window is honored (if active).
7. Strategy returns a `BotDecision`.
8. Runtime converts to `BotCommand`, logs transitions/actions, and applies optional transition pause.

The runtime is framework-agnostic and does not know about React or keyboard events.

## Core Data Model

### `BotPerceptionSnapshot`

Contains the current world view available to a bot:

- Self + other players
- Doors, keycards, vaults, suitcase, traps, trap points, file cabinets
- Deterministic map graph (`BotMapAwareness`)
- Timestamp + team

### `BotMemory`

Private memory, not shared between bots:

- `visitedRoomIds`
- `interactedTargets`
- `ownedDoorTrapDoorIds`
- `seenInteractionByRoom` (time-based)
- `publicKeycardPickupColors`
- `roleFacts` (`designatedCarrier`)
- transition/pause bookkeeping

### `BotCommand`

Output from runtime to adapter:

- `moveVector` (supports diagonal)
- `interactPress`
- `interactHold`
- `trapHold`
- `logEntries`

## Map Awareness

`buildMapAwareness(seed, maxDistance, doors)` builds a deterministic graph from shared map generation:

- `roomByCell`
- `roomCenters`
- `doorways` and `doorwaysByRoom`
- `leafChamberRoomIds` (outer rooms)

Door endpoints are derived from deterministic door ids (`door_ix1_iz1_ix2_iz2`) and used for room connectivity.

## Navigation

`navigation.ts` provides:

- Room-to-room BFS route finding (`findRoomRoute`)
- Sweep target room selection (`chooseSweepTargetRoom`)
- Movement vector creation with wall-avoidance center bias (`moveVectorTowards`)

Important behavior:

- Routes exclude door ids in `memory.ownedDoorTrapDoorIds`.
- This enforces: bots do not enter through doorways they trapped.

## Memory + Event Ingestion

`memory.ts` tracks persistent context and public events:

- `ingestEvent(...)` consumes ticker/interactable events.
- `refreshMemoryFromSnapshot(...)` updates visited rooms, active own door traps, designated carrier, and recent observed interactions in same room.
- `stateTransitionPause(...)` schedules random idle windows.

## Role Strategies

### Shredder (`strategies/shredder.ts`)

Current behavior:

1. Sweep rooms for keycards.
2. Pickup keycards and carry to vault.
3. Insert keycard at vault when in range.
4. If vault is unlocked but closed, hold interaction to open.
5. If carrying suitcase, mark designated-carrier behavior state.

### Enforcer (`strategies/enforcer.ts`)

Current behavior:

1. Sweep rooms.
2. Keycard behavior:
   - If alone with a ground keycard: trap it.
   - If not alone: pickup/carry toward vault, then drop+trap once alone.
3. Outer room behavior:
   - In a leaf chamber and alone: move to doorway and trap it.
4. Vault behavior:
   - If alone in vault room and vault not opened: trap vault.

## Runtime Configuration

All tunables are centralized in `config.ts` as `DEFAULT_BOT_RUNTIME_CONFIG`.

Key knobs:

- Tick rates: `decisionTickMs`, `inputTickMs`
- Pause behavior: `pauseMinMs`, `pauseMaxMs`, `pauseChanceOnTransition`
- Observation memory: `interactionSeenTtlMs`
- Movement shaping: `interactionApproachRadius`, `wallAvoidanceBias`, `movementDeadzone`, `waypointArrivalDistance`
- Action gating: `actionRangeSlack`, `aloneRoomFallbackDistance`

Use these first before changing strategy logic.

## Logging

The runtime emits structured log entries (`debug`/`info`/`warn`) on:

- State transitions
- Pause activation
- Movement vectors
- Action commands

The client adapter prefixes logs per bot slot/team, making multi-bot debugging easier.

## Extension Guide

Use this sequence for safe extension work.

### 1. Add/adjust perception first

- If a new behavior needs data, extend `BotPerceptionSnapshot` types first.
- Keep snapshot data role-agnostic when possible.
- Keep transport-specific shape conversion in the adapter (`useDevBotController.ts`), not in runtime.

### 2. Extend memory only for persistent state

- Add fields to `BotMemory` only when state must persist across ticks.
- Prefer deriving transient values from current snapshot instead of storing them.
- If public events matter, extend `ingestEvent(...)`.

### 3. Extend map/nav helpers before strategy branching

- Put reusable pathing rules in `navigation.ts`/`mapAwareness.ts`.
- Keep role strategies focused on intent decisions, not graph plumbing.

### 4. Add role behavior in strategy modules

- Keep one strategy file per role.
- Return explicit `stateKey` names for traceability.
- Use `pauseAfterTransition` on major actions to keep behavior human-readable.

### 5. Keep runtime generic

- `runtime.ts` should orchestrate, not encode role-specific game rules.
- New roles can be added by creating a strategy and wiring `resolveStrategy(...)`.

### 6. Validate via build + manual scenarios

- `npm run build -w packages/shared`
- `npm run build -w packages/client`
- Then run manual scenario checks for the new behavior path.

## Common Extension Examples

- **Add cabinet-search logic**:
  - Add cabinet target selection helper.
  - Add shredder/enforcer cabinet sub-states.
  - Keep interaction execution via existing `interactHold` command.

- **Add server-side bots later**:
  - Reuse `createBotRuntime()` and strategies as-is.
  - Replace the client adapter with server-side snapshot/event/input wiring.
  - Keep shared config and memory unchanged wherever possible.

- **Add a new team role**:
  - Implement a new `BotRoleStrategy`.
  - Extend `GameTeam` and runtime strategy resolution.
  - Reuse existing nav/memory primitives to avoid duplication.

## File Map

- `config.ts`: default tunables
- `types.ts`: contracts for perception, memory, decisions, commands
- `mapAwareness.ts`: deterministic map graph + room assignment
- `navigation.ts`: route/sweep/vector helpers
- `memory.ts`: event ingestion + memory refresh + pause bookkeeping
- `runtime.ts`: runtime step orchestration
- `strategies/common.ts`: shared strategy utilities
- `strategies/shredder.ts`: shredder behavior
- `strategies/enforcer.ts`: enforcer behavior

