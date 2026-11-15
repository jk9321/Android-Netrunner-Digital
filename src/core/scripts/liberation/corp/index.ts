import { liberationCorpAgendasScripts } from './agendas';
import { liberationCorpAssetsScripts } from './assets';
import { liberationCorpIceScripts } from './ice';
import { liberationCorpIdentitiesScripts } from './identities';
import { liberationCorpOperationsScripts } from './operations';
import { liberationCorpUpgradesScripts } from './upgrades';

/** Corp cards from Liberation: The Automata Initiative (34031-34065) and Rebellion Without Rehearsal (34096-34130), one file per card type, for SCRIPT_GROUPS in src/core/scripts/index.ts. */
export const liberationCorpScriptGroups = {
  liberationCorpAgendasScripts,
  liberationCorpAssetsScripts,
  liberationCorpIceScripts,
  liberationCorpIdentitiesScripts,
  liberationCorpOperationsScripts,
  liberationCorpUpgradesScripts,
};
