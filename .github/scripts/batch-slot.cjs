// The slot gate of the AI batch and AI script workflows (Jeff 2026-11-16: use the whole 20-job limit for batches
// when nothing is building, leave room when something is). A run's first job waits here until its 16 shards fit:
//   - nothing is building: other heavy runs may hold at most 4 jobs (the tail of the run before), so all 20 are used;
//   - a CI or Deploy run is queued or running: other heavy runs may hold at most 1, so 3 jobs stay free for the build.
// Waiting runs go in order: short ones first (a 1-game identical check, a measurement script), then oldest first.
// A waiting run holds one job, never sixteen, so a push's CI never queues behind a batch that has not started.
// Any API trouble lets the run through (three errors in a row), as does a wait near the 6-hour job limit.
const CAP = 20;
const NEED = 16;
const RESERVE = 3;
const POLL_MS = 120_000;
const MAX_WAIT_MS = 5.5 * 3600_000;
const JUST_PASSED_MS = 180_000;
// Matched by workflow file, never by run.name: the API's run.name is the run-name title ("AI batch g1 · ...").
// Matching on name made every started batch invisible to this gate, and only a run still queued with no jobs
// (its name not yet expanded, so plain "AI batch") was seen, and counted as 16 held jobs (2026-11-16 lockups).
const HEAVY = ['.github/workflows/ai-batch.yml', '.github/workflows/ai-script.yml'];
const BUILD = ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'];

const isShort = run => run.name === 'AI script' || /^AI batch g1\b/.test(run.display_title ?? '');
const sleep = ms => new Promise(done => setTimeout(done, ms));

module.exports = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const me = context.runId;
  const mineShort = process.env.SHORT === '1';
  const started = Date.now();
  let errors = 0;
  for (;;) {
    try {
      const runs = new Map();
      for (const status of ['queued', 'in_progress']) {
        const page = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, { owner, repo, status, per_page: 100 });
        for (const run of page) if (run.id !== me) runs.set(run.id, run);
      }
      const building = [...runs.values()].some(run => BUILD.includes(run.path));
      let held = 0;
      let ahead = '';
      for (const run of runs.values()) {
        if (!HEAVY.includes(run.path)) continue;
        const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, { owner, repo, run_id: run.id, filter: 'latest', per_page: 100 });
        // A run GitHub has not given any jobs yet holds no runner and has no place in the line: skip it, or every
        // waiting slot would wait on it while it waits for a runner those slots hold
        if (jobs.length === 0) continue;
        const slot = jobs.find(job => job.name === 'slot');
        const active = jobs.filter(job => job.name !== 'slot' && job.status !== 'completed').length;
        if (!slot) {
          // a run from a branch whose workflow has no gate: it takes its jobs as GitHub hands them out
          held += active;
        } else if (slot.status !== 'completed') {
          const first = isShort(run) !== mineShort ? isShort(run) : run.id < me;
          if (first) ahead = `${run.id} (${run.display_title})`;
        } else {
          const justPassed = Date.now() - new Date(slot.completed_at).getTime() < JUST_PASSED_MS;
          held += justPassed ? Math.max(active, NEED) : active;
        }
      }
      const room = CAP - NEED - (building ? RESERVE : 0);
      const waited = Math.round((Date.now() - started) / 60_000);
      if (!ahead && held <= room) {
        core.info(`Go after ${waited} min: other batch jobs ${held}, room for ${room}${building ? ' (a build is running: 3 jobs kept free)' : ''}.`);
        return;
      }
      core.info(`Waiting (${waited} min): other batch jobs ${held}, room for ${room}${building ? ' (a build is running)' : ''}${ahead ? `; run ${ahead} goes first` : ''}.`);
      errors = 0;
    } catch (error) {
      errors++;
      core.warning(`Slot check failed (${errors}): ${error.message}`);
      if (errors >= 3) {
        core.warning('Three failures in a row: starting without the check.');
        return;
      }
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      core.warning('Waited 5.5 hours: starting anyway.');
      return;
    }
    await sleep(POLL_MS);
  }
};
