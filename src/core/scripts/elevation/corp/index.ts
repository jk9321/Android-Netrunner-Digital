import { elevationCorpAgendasScripts } from './agendas';
import { elevationCorpAssetsScripts } from './assets';
import { elevationCorpIceScripts } from './ice';
import { elevationCorpIdentitiesScripts } from './identities';
import { elevationCorpOperationsScripts } from './operations';
import { elevationCorpUpgradesScripts } from './upgrades';

/** Corp cards from Elevation, one file per card type, for SCRIPT_GROUPS in src/core/scripts/index.ts. */
export const elevationCorpScriptGroups = {
  elevationCorpAgendasScripts,
  elevationCorpAssetsScripts,
  elevationCorpIceScripts,
  elevationCorpIdentitiesScripts,
  elevationCorpOperationsScripts,
  elevationCorpUpgradesScripts,
};
