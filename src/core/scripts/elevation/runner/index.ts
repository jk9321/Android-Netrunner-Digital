import { elevationRunnerEventsScripts } from './events';
import { elevationRunnerHardwareScripts } from './hardware';
import { elevationRunnerIdentitiesScripts } from './identities';
import { elevationRunnerProgramsScripts } from './programs';
import { elevationRunnerResourcesScripts } from './resources';

/** Runner cards from Elevation, one file per card type, for SCRIPT_GROUPS in src/core/scripts/index.ts. */
export const elevationRunnerScriptGroups = {
  elevationRunnerEventsScripts,
  elevationRunnerHardwareScripts,
  elevationRunnerIdentitiesScripts,
  elevationRunnerProgramsScripts,
  elevationRunnerResourcesScripts,
};
