import { vantageCorpAgendasScripts } from './agendas';
import { vantageCorpAssetsScripts } from './assets';
import { vantageCorpIceScripts } from './ice';
import { vantageCorpIdentitiesScripts } from './identities';
import { vantageCorpOperationsScripts } from './operations';
import { vantageCorpUpgradesScripts } from './upgrades';

/** Corp cards from Vantage Point, one file per card type, for SCRIPT_GROUPS in src/core/scripts/index.ts. */
export const vantageCorpScriptGroups = {
  vantageCorpAgendasScripts,
  vantageCorpAssetsScripts,
  vantageCorpIceScripts,
  vantageCorpIdentitiesScripts,
  vantageCorpOperationsScripts,
  vantageCorpUpgradesScripts,
};
