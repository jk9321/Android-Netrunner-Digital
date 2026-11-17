import { liberationRunnerEventsScripts } from './events';
import { liberationRunnerHardwareScripts } from './hardware';
import { liberationRunnerIdentitiesScripts } from './identities';
import { liberationRunnerProgramsScripts } from './programs';
import { liberationRunnerResourcesScripts } from './resources';

/** Runner cards from Liberation: The Automata Initiative (34001-34030) and Rebellion Without Rehearsal (34066-34095), one file per card type, for SCRIPT_GROUPS in src/core/scripts/index.ts. */
export const liberationRunnerScriptGroups = {
  liberationRunnerEventsScripts,
  liberationRunnerHardwareScripts,
  liberationRunnerIdentitiesScripts,
  liberationRunnerProgramsScripts,
  liberationRunnerResourcesScripts,
};
