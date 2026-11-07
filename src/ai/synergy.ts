import { CardInstance, GameAction, GameState, SideCode, cardDef, findCardAnywhere } from '../core';
import { THEMES, Theme, ThemeWeights, cardSynergy } from './synergyTags';

/**
 * Deck-aware nudges for the rule-based AI.
 *
 * Each side keeps a profile of what its own cards do and reward (see
 * each card's `synergy` in src/ai/cards/), counting the identity most, cards in hand or installed
 * next and cards still in the deck least; trashed cards don't count. So
 * the profile follows the game: it shifts as cards are drawn, installed or
 * lost. A move that feeds a theme the deck pays off for, or that puts a
 * payoff down while its enablers are around, gets a small bonus.
 *
 * Each side also reads the opponent's public cards (identity, installed
 * and rezzed cards, discards) and favours counters to what they rely on:
 * starving an econ-reliant opponent, purging a virus deck, clearing tags
 * against a tag-punishing Corp.
 *
 * The nudge is capped well below the main scores, so it breaks ties and
 * tips close calls but never overrides the AI's core judgement.
 */

/** Most a nudge can add to one move, in credit units. */
export const MAX_NUDGE = 1;
/** Weights, tuned with AI-vs-AI batches (scripts/ai-match.sh). */
export const tuning = {
  /*
   * Measured with new-vs-old batches on System Gateway + Elevation
   * (2026-10-25): the own-deck nudge cost both sides games (their plain
   * scoring already plays these decks well), and the Corp's opponent
   * reading and hand-keeping did too. The Runner's opponent reading and
   * hand-keeping won games. So only those are on for now; the rest is
   * ready to re-test with scripts/ai-match.sh as sets with deeper combos
   * arrive.
   */
  /** Own-deck synergy term of the move nudge, per side. */
  synergy: { corp: 0, runner: 0 } as Record<SideCode, number>,
  /** Opponent-reading term of the move nudge, per side. */
  counter: { corp: 0, runner: 1 } as Record<SideCode, number>,
  /** Synergy when choosing which cards to keep in hand, per side. */
  keep: { corp: 0, runner: 1 } as Record<SideCode, number>,
  /** Over-advance Dividends agendas. */
  dividends: true,
  /** Runner: trap caution from the traps the Corp has shown. */
  wary: true,
  /** Corp: sell traps as agendas, and the naked-agenda reverse bluff. */
  bluff: true,
  /** Corp: purge sooner against a virus deck. */
  purge: true,
  /**
   * Corp: the naked-agenda reverse bluff (Jeff, 2026-10-26): only after the Runner has seen a
   * trap and while the Corp still has unseen traps, at most once a game, and weighted low
   * unless it is early or the Runner is short of credits or cards.
   */
  reverseBluff: true,
  /** Planning terms (round 2): each can be switched off for batches. */
  plan: {
    /*
     * Round 2 batches (663 deals per piece, 2026-10-25): Runner, all on +10
     * games over round 1; leaving one out: saving up was worth +6, tag
     * threat +2, urgency +1, breakers for seen ice -4. Corp, all on -31: ice
     * placement cost about 23 games as a flat bonus (now reworked to shift
     * between choices), tag threat -4, score setups +1. Noise is about ±16,
     * so only ice placement was a real signal; the rule is to keep pieces
     * that play more like a person unless they are clearly negative.
     * (urgency only fed serverValue's old table, so it went with plan.runModel's off path, 2026-11-06.)
     */
    /** Corp: plays that let an agenda be scored this turn (Seamless Launch, KPI...), and tagging before scoring Orbital Superiority. */
    scoreSetup: true,
    /*
     * Round 3 batches (1,105 deals, Corp only, 2026-10-25): all on +46 games
     * vs the old Corp (round 2 alone was -15). Leaving one out: rez money
     * was worth +22, agenda timing +27, central ice -12 (HQ steals rose; a
     * variant that keeps HQ's ice need was -8 vs no change: noise, kept as
     * the more human rule). HQ order (first HQ ice once R&D has one): +53.
     * Ice depth: as half a layer for breakable ice -25 (dropped); by the
     * Runner's cost to get through (v2) -5 vs without it, kept (noise).
     * One scoring remote: +104 vs old (49.0%; +56 over round 3 without it).
     * Rez money also on the Corp's own turn (assets) and fewer asset
     * remotes: +121 vs old (50.6%). Self-play (new vs new) Corp 45.4%, was
     * 36.6% before round 3; Jeff's target is 50 ±5%.
     */
    /** Corp (round 3): keep credits to rez ice on two key servers (R&D, an agenda remote, HQ holding agendas). */
    rezMoney: true,
    /*
     * Identity plans (2026-10-25): self-play, Pork Chops + Peculiarity, 520
     * games: Corp 39.6% on vs 36.3% off (each deck about +3 points);
     * flatline wins 91 vs 65. All decks: new Corp +113 vs old (noise vs +121).
     */
    /* Tāo swap: used on 128 of 244 chances (was 6 of 221); self-play with the two Tāo decks, 1,360 games: Runner 55.8% vs 54.9% off (noise, kept). */
    /** On the Corp's turn, with a click and 2 credits, a tag's worth leaves out this turn's resource trash, which the trash action itself takes (Jeff: the Corp never trashed Sebastião's connections). */
    tagTrashNow: true,
    /** The cards from HQ that trashing a resource also costs (Sebastião, Manuel at threat 3) are priced as the Corp's least useful ones, not the flat worth of a card in hand. */
    hqTrashCost: true,
    /**
     * The Corp deciding prices a tagged Runner's resources without the risk of its own trash action (PAYOUT_RISK.runnerTagged):
     * that risk is the Corp's choice, already in the tag clock, so it made keeping the tag look as good as trashing.
     */
    ownTrashRisk: true,
    /** Runner: bypass (rules 6.5.8) is priced: S-Dobrado and Window of Opportunity runs skip their ice, bypass cards in the rig cut ice costs, and "bypass this ice?" prompts weigh the encounter they skip (runs runBypasses, prompts). */
    bypass: true,
    /**
     * Experiment (Gemini audit 2.1c, 2026-11-01): sideOff.corp's effectValues also stops the Corp valuing the Runner's
     * rig by what each card does. On, only the Corp's own cards lose their effect values. Off until a batch says so.
     */
    rigEffects: false,
    /**
     * The exposure check by what the Runner can pay, not by layers of ice (Jeff, 2026-10-29). Off: self-play
     * 39.0% (old rule 41.3%), new Corp vs old Runner 43.1% (45.8%); without income 38.9% / 44.1%; no
     * exposure check at all 36.6% / 42.3%. Agendas waited in HQ and were raided there. Deleted 2026-11-06
     * (outOfReach stays: lethalHq and the steal odds use it).
     */
    /* Funded depth (2026-10-26, self-play, 2,210 games): Corp 42.9% -> 44.8%; remote steals 1,714 -> 1,472, behind ice it couldn't afford to rez 883 -> 499. */
    /** Corp (Jeff): spending (plays, installs, rezzes elsewhere) keeps the money to rez an installed agenda's ice. */
    agendaMoney: true,
    /*
     * Ice pacing (2026-10-27, self-play, 2,210 games): 46.8% -> 46.2% (noise).
     * Steals behind unrezzed ice the Corp couldn't afford: remote 287 -> 196,
     * R&D 581 -> 301, HQ 517 -> 268. Kept (Jeff's rule, plays like a person).
     */
    /* Ice trashing (2026-10-27, self-play, 2,210 games each): 40.4% off -> 40.1% on (noise). Kept: plays like a person when short of money. */
    /*
     * Opening round (2026-10-27, self-play, 2,210 games each). Before the
     * Manegarm fix: mulligan only 46.7%, + placement 46.1%, + centrals first
     * 45.0%, all three 47.0% (base 46.2%). After it: base 40.7%, all three
     * 40.4%. Neutral overall: R&D points 3,483 -> 2,974, remote 3,483 ->
     * 3,797. Bare R&D on the Runner's first turn 74% -> 37%. Kept (Jeff's
     * rule: within noise, plays like a person).
     */
    /**
     * Corp (Jeff): ice is judged at the strength it has where it would go, and a layer that weakens the ice inside it
     * costs that (Scatter Field). Off: self-play at 5f827e6 42.5% on, 45.6% off; with spinDoctorWait 44.3% on, 47.9% off.
     */
    icePosition: false,
    /* Money target (2026-10-26, self-play, 2,210 games): off 42.7%, 0.3 46.8%, 0.6 46.8%. Kept the milder weight. */
    /** Corp (Jeff): aim for a surplus that rezzes the unrezzed ice on the centrals and scoring remote (credits-worth per credit short; 0 = off). */
    moneyTarget: 0.3,
    /** Corp (Jeff): push agendas through a remote the Runner can't get into yet. */
    tempo: true,
    /*
     * Run budget (2026-10-26, self-play, 2,210 games): runs the Runner paid
     * into and lost fell from 1,536 to 1,265, jack-outs before known ice from
     * 282 to 9. Runner +36 games (Corp 44.2% -> 42.8%). Rez allowance alone:
     * within noise (kept, plays more like a person).
     */
    /** Corp (round 3): no half-advanced agendas: advance only when it can be scored next turn behind ice it can rez. */
    agendaTiming: true,
    /*
     * Draw and money round (2026-10-26, self-play): all on Corp 45.4% (2,210
     * games). Off on 1,105: saveForOps 39.8%, blindDraws 42.0%, pettyCash,
     * hostedMoney and dig within noise. drawValue off for both sides 48.0%
     * (2,210), for either side alone within noise; kept (Jeff's rule: within
     * noise and plays more like a person).
     */
    /* Rez money (2026-10-26, 2,210 self-play games): both on 46.7%, neither 47.2% (noise). Halving upgrade worth in empty remotes instead cost about 2 points. */
    /** Corp: Petty Cash goes first when it is among the actions the Corp has clicks for (corpAI pettyCashFirst). */
    pettyCashFirst: true,
    /** Corp: with the Runner tagged, a resource trash among the actions it has clicks for goes first (corpAI tagFirst). */
    tagFirst: true,
    /**
     * Corp (structural review item 2, Jeff 2026-11-06): in a run, ice is rezzed by the value model (rezModel.ts): the
     * board change (rez cost on the credit slide, ice worth) plus what the run would take when the ice stops it, or the
     * toll when it doesn't. Replaces the importance table, rezToll and agendaMoney for ice (they still apply with it off).
     */
    modelRez: true,
    /**
     * Both sides' pricing (structural review items 1-2, 2026-11-06): unrezzed ice counts as rezzable from one pool of
     * the Corp's credits, not each against the same credits (iceValues rezBudget). A measuring switch, not a knob.
     */
    rezBudget: true,
    /*
     * Value model step 2 (docs/ai-value-model-plan.md, Jeff 2026-10-27): the
     * new exchange rates in valueModel.ts. Self-play, 2,210 games each: all
     * off 40.1% Corp, all on 38.6%. Leave-one-out: no credit slide 41.0%, no
     * click rate 37.7%, no points clock 38.5%, no hand filter 38.2%. Per side:
     * the Runner's credit slide is worth about +2.6 points to the Runner, the
     * Corp's about +0.7 to the Corp (noise). The flat 1.25 click rate loses
     * for both sides (Corp's -2.5 to the Corp, Runner's -2 to -3 to the
     * Runner): off, kept for re-testing once a click is priced by the best
     * play in hand as planned. Points clock and hand filter: noise, kept.
     */
    /**
     * Structural review item 1 (Jeff approved 2026-11-06; spec "Item 1 spec" of the AI code review doc): the Corp ranks
     * every main-phase action in one currency, the change in evaluate(state, 'corp') after the action and its own prompts
     * (corpAI.ts oneCurrencyScore), instead of installScore/advanceScore points, tiers and reserve penalties; evaluate
     * adds what the hand-made points were covering: central exposure (agendas lost from HQ and R&D runs) and trap
     * advancement counters. Corp only: off in sideOff.runner, so the Runner AI is unchanged. Off: beta as it was.
     * OFF BY DEFAULT (2026-11-07, the stop rule Jeff approved): paired against the old ranking on the same deals the Corp
     * won 22.2% vs 36.7% at 40e7d52 (this code), 13.0% after a tempo round (reverted). Kept switchable for the next try;
     * docs in /mnt/project-files/netrunner-ai/one-currency/handoff.md.
     */
    oneCurrency: false,
    /**
     * Structural review item 3 (Jeff approved 2026-11-06; spec "Item 3 spec" of the AI code review doc): the Corp's
     * belief about where the Runner runs next turn is the Runner AI's own run scorer budgeted over its turn, on the board
     * as the Runner sees it (threatModel.ts), instead of PACE's shares, STEAL.run and the open-remote patches; the
     * planner's leaf charges that turn (threatLoss) in place of the two-sample Runner reply (plan.runnerReply). Corp
     * only: off in sideOff.runner.
     * OFF BY DEFAULT (2026-11-07, the gate): paired on the same 2,210 deals the Corp won 26.6% vs 37.6% off (-11.0 ± 1.2),
     * stuck-in-HQ +9.2/100, broke -13.1/100 (runs 42329361323 vs 42329359103). The threat reads well on Jeff's games
     * (scripts/threat-calibration.ts) but is one turn, crisp: an agenda behind ice the Runner can't pay through this
     * turn reads safe for every turn it waits. Hand-off: /mnt/project-files/netrunner-ai/threat-model/handoff.md.
     * Round 2 (ai-threat-model-2): later waiting turns on a Runner a turn's income richer (evaluate threatStanding),
     * plus plan.measuredPass: -10.6 ± 1.2 and -10.9 ± 1.3 paired, stuck-in-HQ +9.8 / +10.3 (runs 42338471891,
     * 42338476397). Still off. Hand-off: /mnt/project-files/netrunner-ai/threat-model/handoff-round2.md.
     * ON BY DEFAULT, VALUES ONLY (round 3, Fable review 2026-11-07): the decomposition put the whole loss at the leaf.
     * The threat in the values with runnerReply kept at the leaf (threatLeaf off) is -1.0 ± 0.9 paired, no alarm worse
     * (run 42347842219); at the leaf only -8.2 ± 1.3 (42347844568). Hand-off: handoff-round3.md, same folder.
     */
    threatModel: true,
    /**
     * Item 3 round 2 (Fable review, 2026-11-07): the Corp's guess of a run getting past unrezzed ice (passOdds) is the
     * measured rate, not 0.55 a layer. Self-play (884 games, runs 42337257360 / 42337259763) and Jeff's 13 Corp games
     * (scripts/threat-calibration.ts): the first unrezzed layer passes about 0.6 against a Corp that can rez (0.52 on
     * Jeff's), but each further layer passes about 0.83, since the Corp's money rezzes about one ice a run; against a
     * broke Corp 0.87, then 0.93. Corp only (sideOff.runner). Shared by the old steal path and the threat.
     * Paired with the threat off: +0.0 ± 0.6 (run 42338474356), no alarm moved: it changes nothing on its own.
     */
    measuredPass: false,
    /**
     * Item 3 round 3 (Fable review, 2026-11-07): the planner leaf credits the Corp with the Runner's spend on its
     * budgeted turn (threatModel.ts threatLoss), as runnerReply's played-out leaf did. Corp only; read with threatModel.
     * Off with the threat leaf it belongs to (-9.7 ± 1.2 with it, run 42343555205).
     */
    threatSpend: false,
    /**
     * Item 3 round 3: the threat's 0/1 per server read as the measured hit rate when the budget runs it and when it
     * doesn't (threatModel.ts CALIBRATED_RUN), everywhere the threat is read. Corp only; read with threatModel.
     * Off: with the threat leaf, -9.9 ± 1.3 against -10.6 without it, stuck-in-HQ unchanged (run 42343557404). The
     * table stays as measurement.
     */
    calibratedRun: false,
    /**
     * Item 3 round 3, a decomposition: with threatModel on, the threat's two halves can be switched off one at a time.
     * threatLeaf: the planner leaf's charge (threatLoss; off, the two-sample runnerReply). threatValues: the readers in
     * the values (stealOdds, agendaWorth, centralExposure; off, STEAL.run and PACE).
     * threatLeaf OFF BY DEFAULT (round 3, paired -8.2 ± 1.3 on its own, run 42347844568; with threatSpend and
     * calibratedRun still about -10): a charge on the end-of-turn board drops four things the played-out reply sees:
     * the Corp's own rezzes in the Runner's runs (and their cost), the board at the Corp's next turn (clicks, draw,
     * turn-start payouts), steals made (the agenda gone, not priced as at risk), and the Runner's grip turn (installs
     * and events that turn a run it couldn't make into one it can). The leaf is item 4's (a cheaper, deterministic
     * playout), not a formula.
     */
    threatLeaf: false,
    threatValues: true,
    /**
     * Per deciding side (Jeff, 2026-10-28): its own clicks priced by the best plays in hand, at least a credit (handValues.ts clickWorth).
     * Batches (2,210 games each): Corp side 29.7% -> 21.6% (the Corp clicks for cards over credits and runs dry), Runner side 29.7% -> 29.7%.
     * Corp off, kept for re-testing; Runner on (neutral, Jeff's design).
     */
    clickByPlay: { corp: false, runner: true } as Record<SideCode, boolean>,
    /** Both sides: agenda points are worth more the closer they take a side to 7. */
    pointClock: true,
    /*
     * Value model step 6 (2026-10-27, self-play, 2,210 games each, base
     * 39.0%): off one at a time affordIce 38.5, deepReserve 38.6, iceReserve
     * 38.7, agendaMoney 37.9, icePacing 37.6, moneyTarget 37.0, rezMoney 35.5;
     * the first three off together 38.9 (noise). deepReserve and iceReserve
     * off (the credit slide now covers them; kept for re-testing). affordIce
     * stays on: without it the Corp installs ice it can't rez (Pharos with 9
     * credits left), which Jeff's rule forbids. With agendaMoney and
     * icePacing off too 33.6: those two stay on, as do moneyTarget and
     * rezMoney. hostedMoney off: the step 4 profile prices Regolith, the
     * only card it applied to.
     */
    /*
     * Step 3 (self-play, 2,210 games each, click rate off): off 37.7% Corp,
     * on 35.2%, Runner's only 34.8%: the Runner +2.5 to 3 points, the Corp's
     * within noise (kept). A flat 0.75 per Smartware credit first cost the
     * Runner 8 points (it stacked Smartware instead of running); each stacked
     * credit now waits a turn longer and is worth less.
     */
    /** Jeff, 2026-10-28: the Corp's planner plays the Runner's next turn out (the Runner AI on the board, hidden cards guessed) and scores what it leaves (runnerReply.ts). */
    runnerReply: true,
    /** Jeff, 2026-10-29: an agenda in an open remote is as good as stolen: steal odds 1, and the Runner reply counts it stolen even when the sampled Runner didn't run it. */
    openSteal: true,
    /** Same report: a play that lets this turn's clicks and credits finish an agenda (The Holo Man, Seamless Launch short of the last advance) ranks with that advance, free of the reserve penalty (corpAI.ts finishable). */
    finishSetup: true,
    /** Jeff, 2026-11-05: credits a successful run gives (Clean Getaway, Transfer of Wealth, Trick Shot, Red Team) are priced on the credit slide (runs.ts successCredits). Off (Jeff, 2026-11-05): no batch gain, and the Corp's guessed Runner reply then plays
     * Transfer of Wealth when broke, so the Corp holds Hedge Fund (tests/castWhileAble.test.ts). */
    runCreditsSlide: false,
    /** Jeff, 2026-11-05: turns left from the self-play measure by the higher score, not 8 less it (cardProfiles.ts turnsLeft). */
    measuredTurnsLeft: true,
    /** 2026-11-07 (thread "Find why self-play games end decked"): turns left are no more than R&D lasts at 1.3 draws a turn (cardProfiles.ts turnsLeft).
     * Off: paired 2,210 games Corp +0.0 ± 0.4, decked 186 vs 173, stuck in HQ +0.7 ± 0.3 (turnsLeft only discounts payouts and
     * agenda gain, so a shorter clock lowers scoring's worth instead of raising its urgency). Kept, the honest clock, for when
     * urgency is priced by the Runner's points rather than by a discount. */
    rdTurnsLeft: false,
    /** Jeff, 2026-10-31 (same report): the Runner reply counts as stolen only open-remote agendas the sampled Runner never ran; one it ran and was stopped from survived (runnerReply.ts). */
    openStealUnrun: true,
    /** Jeff, 2026-10-31 (Doomscroll again): the Corp's agenda safety checks (iceDepth, fundedDepth, entryCost) count ice the Runner can take as only the credits it needs (corpAI.ts protectionCost). */
    tankProtection: true,
    /** Jeff, 2026-10-31: the ice worth cap is this Runner's credits plus two turns of income, at least 8 (iceValues.ts iceStop); wins over iceStopHigh. Batch 663: 47.1% vs 49.2% base (noise, in band); kept on as Jeff's model. icePacing off (install ice it can't rez) was 45.4%, remote steals 487 -> 566: icePacing stays. */
    iceStopRunner: true,
    /** Jeff, 2026-11-05: iceStopRunner's cap reads the Runner's credits at the start of the decision, so gaining or spending credits doesn't move ice worth (iceValues.ts stopCredits, noted by handValues.ts decisionContext). */
    iceStopAnchor: true,
    /** Per deciding side (Jeff, 2026-10-28): Normal plays its best few actions through to the end of the turn and picks the best turn (turnPlanner.ts). */
    turnPlanner: { corp: true, runner: true } as Record<SideCode, boolean>,
    /**
     * Structural review item 4 (Fable spec, 2026-11-07; turnPlanner.ts): the planner's search widened, in pieces, each
     * read only with plannerSearch on and batched alone. On by default since review 1 (2026-11-07).
     * plannerSeed: the Corp's Runner reply deals the hidden cards from one seed per decision (game, turn, clicks left:
     * turnPlanner.ts currentDecisionSeed), so every candidate of a decision is played out on the same deals and differs
     * only by its line; the next decision gets fresh deals. (Round 1 seeded by turn: stuck in HQ +3.5, a scope error.)
     * plannerBuild: the Corp's candidates add the ice install a two-step build starts (ice, then the agenda or asset
     * behind it; ice on a central the threat runs), which the rule ranking puts outside its top few. Cap PLANNER.withBuild.
     * plannerDiscard: a playout that ends the turn over its maximum hand size plays the discard step through the engine
     * with the AI's own discard answer before the leaf (rules 5.6.3a Corp, 5.7.2a Runner). It matters for the Runner's
     * planner (and a threat leaf): the Corp's played-out reply already starts with the Corp ending its turn and discarding.
     * plannerPatchesOff: the ordering patches (pettyCashFirst, tagFirst, dominated) off for the planning side.
     *
     * Batches (2026-11-07, paired vs beta 706ec36, 36.7%, 2,210 games; docs/ai-batch-log.md): seed +1.9 ± 1.3, build
     * +1.6 ± 1.0 (stuck in HQ -3.5 ± 1.0), discard -0.3 ± 0.8, the three together +0.6 ± 1.3 (stuck in HQ -2.0). With
     * patches off as well (1ddd282) +0.3 ± 1.3, broke -4.2, stuck in HQ -2.1, but "tag not used" +2.3 ± 1.1: dropping
     * tagFirst costs the trash-the-tagged-resource play it was written for, so the patches stay on for now (item 6).
     */
    plannerSearch: true,
    plannerSeed: true,
    plannerBuild: true,
    plannerDiscard: true,
    plannerPatchesOff: false,
    /**
     * Tuning pass 1, part A (parked code audit items 7-9 and the decking/ice-grip experiments, rebased onto beta 5a17a31).
     * oneRezMoney: Corp rez money counted once in plays scored by the board (corpAI playScore: only the agenda-money rule
     * there, the reserve gap and money target left to plays scored without the board; valueModel boardNeed by rezCostOf).
     */
    oneRezMoney: false,
    /** Code audit cleanup item 9: the Runner's board score and run choice guess a facedown card the same way (runs.ts remoteAgendaOdds, evaluate corpBoardValue). */
    oneAgendaGuess: false,
    /** Code audit cleanup item 8: Nanomanagement and Touch-ups ranked by plan.finishSetup, not their own bonus (corpAI operationBonus). */
    oneSetupRule: false,
    /**
     * Thread "Find why self-play games end decked" (2026-11-06, branch ai-decking-fixes): tankNoEtr prices only ice with no
     * run enders by its tank cost (corpAI.ts protectionCost); hqHeld lets hqNoSafer apply while HQ holds 2+ agendas;
     * unseenOdds leaves installed ice and rezzed root cards out of the agenda odds (effectValues.ts countAgendaOdds).
     */
    tankNoEtr: false,
    hqHeld: false,
    unseenOdds: false,
    /** Jeff, 2026-11-06 (his Teia game, ai-ice-grip): ice on the board is priced against a grip no bigger than the hand size, not the cards the Runner holds only until its turn ends (iceValues iceWorthOf). */
    iceGripCap: false,
    /**
     * Tuning pass 1, part B (Fable spec 2026-11-07): one race clock (clock.ts) prices the Corp's time from the Runner's
     * expected scoring rate on this board. agendas: agendaWorth's wait discount is clock.open, not 1 - 1/turnsLeft.
     * horizon: turnsLeft is the turns until either side reaches 7 at the clock's pace, or R&D runs out. money: the Corp's
     * credit need shrinks as its game shortens (round 2).
     * tempo (piece 1b, added after the calibration: open() made waiting cheaper, not dearer): each Runner turn an agenda
     * waits costs the Runner's expected points that turn on its clock. tempoOnce (piece 1c, Fable's review): the same
     * charge once per position, carried by the agenda nearest scoring (HQ's seen agendas included); the others pay
     * only their turns beyond it (evaluate.ts nearestAgendaTurns, tempoOnceCharge).
     */
    raceClock: { agendas: false, tempo: false, tempoOnce: false, horizon: false, money: false },
    /**
     * Per deciding side (Jeff, 2026-10-28): its own hand valued card by card, by what each will do once played (handValues.ts).
     * Batches: each side loses with it (Corp side 32.2% -> 28.0%, Runner side 32.2% -> 35.9% Corp) and the Runner draws at a
     * full hand on 55% of turns. Off on both sides, kept for re-testing.
     */
    handByCard: { corp: false, runner: false } as Record<SideCode, boolean>,
  },
};

/**
 * Plan switches off for one side only (Jeff, 2026-10-29), on top of
 * tuning.plan, as PLAN_OFF writes them (name or name.key). Head-to-head
 * against the old Runner (2,210 games each): Runner-reply Corp 41.9%; with
 * 10 pieces off for it 47.8%. Putting groups back on: flatRates 47.7,
 * damage + tag clocks 48.7, subCosts + runModel + cardFixes 46.9 (noise:
 * back on, they replace hacks), modelHacks 44.7 and effect + counter values
 * 45.4 (lose: off for the Corp). The same 10 off for the Runner cost it
 * 6.9 points (old Corp 33.3% -> 40.2%): on for the Runner. Then, from
 * 48.3% with those 4 off: effectValues back on 46.4, model rez hacks
 * 46.4 (lose: off); counter values 47.8, purge 48.7, bonuses 47.7,
 * iceAdvance + finish + conduit 47.6 (noise: back on). The model rez
 * choices lost because they rezzed Manegarm, Anoetic Void and AMAZE on the
 * Corp's turn (44.4 vs 46.8); keeping run-timed cards for the run made
 * them even (46.3): back on.
 * 2026-11-03 (Jeff): effectValues back on for the Corp after rezPaid (a rezzed card was charged its rez cost
 * again): 49.5% vs 47.4% off (663 games); rezPaid alone 49.0%. About 23% slower per Corp move (206 vs 168 ms).
 * 2026-11-04 (Jeff, bug report #13: the Corp never trashed Sebastião's resources): tagTrashNow, ownTrashRisk and
 * hqTrashCost on for both sides lost the Corp 4 points (44.8% vs 48.1%, 663 games); Corp-only 48.0%, Runner-only
 * 47.2%. The fix is the Corp's (it is the side that trashes), so the Runner keeps the old tag values.
 */
export const sideOff: Record<SideCode, string[]> = {
  corp: [],
  runner: ['tagTrashNow', 'ownTrashRisk', 'hqTrashCost', 'oneCurrency', 'threatModel', 'measuredPass', 'threatSpend', 'calibratedRun', 'raceClock'],
};

/**
 * Switches folded into the code by review item 6 (2026-11-07): always on, their off paths deleted. A PLAN_OFF or
 * planWith naming one throws, so a batch written before the fold can't silently test nothing.
 */
export const FOLDED: readonly string[] = [
  'tagThreat', 'breakerFocus', 'saveUp', 'icePlacement', 'agendaStakes', 'lethalHq', 'readWriteFull',
  'archivesChosen', 'centralIce', 'iceDepth', 'oneRemote', 'identities', 'runnerIdentities', 'exposure',
  'assetRezTiming', 'turnStartRez', 'stealCosts', 'rezPaid', 'tagNoClear', 'knownHq', 'hqNoSafer', 'readAssetTrash',
  'castWhileAble', 'clickMoneyRez', 'drawBackLife', 'answerCorpChoice', 'payoutSlide', 'liquidity', 'spareLastClick',
  'transferOfWealth', 'clearinghouseLethal', 'keepKnownHand', 'spinDoctorWait', 'spentSpinDoctor', 'freeInstallPick',
  'measuredAssetRisk', 'promptChains', 'leoValue', 'bangunFaceUp', 'bangunNoBareBait', 'bangunEarlyBait',
  'fundedDepth', 'icePacing', 'iceTrash', 'centralsFirst', 'stopperPlacement', 'mulliganRez', 'purgeValue',
  'affordIce', 'runBudget', 'rezAllowance', 'drawValue', 'blindDraws', 'dig', 'idleUpgrades', 'pettyCash', 'rezToll',
  'saveForOps', 'trojans', 'bioroidClicks', 'clickRate', 'oneClickPrice', 'measuredNov6', 'drawWorthCredits',
  'creditSlide', 'handFilter', 'counterEffects', 'cardProfiles', 'payoutRisk', 'effectValues', 'cardFixes',
  'counterFormulas', 'damageClock', 'corpTurnDamage', 'runOpenness', 'muNeed', 'stealOdds', 'agendaCredits',
  'moneyReach', 'fermenterBank', 'heldMoney', 'brokeSlope', 'agendaBudget', 'agendaClicks', 'holoManMove',
  'plannerScores', 'plannerRunEvents', 'runRest', 'drawCap', 'breakerReach', 'emptyGripRuns', 'plannerRunCredits',
  'keepKnownRd', 'runnerKnown', 'measuredRunShares', 'rezWhenUsed', 'rezToUse', 'flatRates', 'tagClock', 'vicTags',
  'rdMemory', 'sourdough', 'cardPlans', 'madaniClick', 'tankIce', 'digPastLimit', 'freeRez', 'plannerHand',
  'subCosts', 'iceInCredits', 'breakerCredits',
];

/** Throws on a name that isn't a plan switch (a typo, or a switch folded into the code). */
function checkSwitch(name: string) {
  if (name in tuning.plan) return;
  throw new Error(FOLDED.includes(name) ? `plan.${name} was folded into the code (review item 6): it is always on` : `no plan switch named ${name}`);
}

/** The plan with `keys` switched off (a key written +name turns it on). */
export function planWith(plan: typeof tuning.plan, keys: string[]): typeof tuning.plan {
  const out = { ...plan } as Record<string, unknown>;
  for (const key of keys) {
    const on = key.startsWith('+');
    const [name, part] = key.replace(/^\+/, '').split('.');
    checkSwitch(name);
    if (part) out[name] = { ...(out[name] as object), [part]: on };
    else out[name] = on;
  }
  return out as typeof tuning.plan;
}

/**
 * Batch scripts' PLAN_OFF (comma-separated): name or name.key switches a
 * piece off for both sides, +name turns one on, and corp:name / runner:name
 * (corp:+name) changes only that side's sideOff list.
 */
export function applyPlanOff(list: string) {
  for (const key of list.split(',').filter(Boolean)) {
    const m = key.match(/^(corp|runner):(.*)$/);
    if (!m) {
      tuning.plan = planWith(tuning.plan, [key]);
      continue;
    }
    const side = m[1] as SideCode;
    const name = m[2];
    checkSwitch(name.replace(/^\+/, ''));
    sideOff[side] = name.startsWith('+') ? sideOff[side].filter(k => k !== name.slice(1)) : [...sideOff[side], name];
  }
}

// The deciding side and its plan live in the pricing context (pricing.ts, structural review item 6)
export { actingSide, asSide, planSide } from './pricing';

const IDENTITY = 3;
const LIVE = 1.5; // in hand or installed
const DECK = 0.5; // still in the deck
const SEEN = 1; // the opponent's discards and scored cards
const HAND_PAYOFF = 1; // a payoff in hand, about to come down
/** Basic actions (draw, advance, run) are taken over and over, so their nudge is much smaller. */
const BASIC = 0.4;

/** 0 for nothing, about 0.5 for a few cards' worth, approaching 1 for a deck built on it. */
const sat = (x: number) => (x <= 0 ? 0 : x / (x + 4));

// Move features beyond the card themes, used by the counters below.
type Feature = Theme | 'purge' | 'cleanTags' | 'trashEcon' | 'bigHand' | 'iceHq' | 'iceRd';
type Features = Partial<Record<Feature, number>>;

/** What to favour against an opponent leaning on a theme: their theme -> my move features. */
const COUNTERS: Record<SideCode, Partial<Record<Theme, Features>>> = {
  corp: {
    econ: { denial: 1, trashEcon: 1.5 }, // starve them: credit loss, trash their money resources
    virus: { purge: 1.5 },
    hq: { iceHq: 1 },
    rd: { iceRd: 1 },
  },
  runner: {
    econ: { trashEcon: 1.5, denial: 1 }, // trash their money assets, make them lose credits
    tags: { cleanTags: 1.5 },
    damage: { bigHand: 1.5 },
    operations: { hq: 0.5 },
  },
};

export interface Profile {
  /** How much of each theme the side's cards do (enablers), deck included. */
  supply: Record<Theme, number>;
  /** How much the side's cards reward each theme (payoffs), deck included. */
  demand: Record<Theme, number>;
  /**
   * Payoffs in play now (identity, installed, in hand): feeding a theme only
   * pays when something is there to collect.
   */
  live: Record<Theme, number>;
}

const empty = (): Record<Theme, number> => Object.fromEntries(THEMES.map(t => [t, 0])) as Record<Theme, number>;

function add(profile: Profile, card: CardInstance, weight: number, liveWeight = 0) {
  const { gives, wants } = cardSynergy(cardDef(card));
  for (const [t, w] of Object.entries(gives ?? {})) profile.supply[t as Theme] += w * weight;
  for (const [t, w] of Object.entries(wants ?? {})) {
    profile.demand[t as Theme] += w * weight;
    profile.live[t as Theme] += w * liveWeight;
  }
}

const blank = (): Profile => ({ supply: empty(), demand: empty(), live: empty() });

const corpInstalled = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.root, ...s.ice]);
const runnerInstalled = (state: GameState) => {
  const rig = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources];
  return [...rig, ...rig.flatMap(c => c.hostedCards ?? [])];
};

function buildOwn(state: GameState, side: SideCode): Profile {
  const p = blank();
  const [identity, hand, installed, deck] =
    side === 'corp'
      ? [state.corp.identity, state.corp.hq, corpInstalled(state), state.corp.rd]
      : [state.runner.identity, state.runner.grip, runnerInstalled(state), state.runner.stack];
  add(p, identity, IDENTITY, IDENTITY);
  for (const c of installed) add(p, c, LIVE, LIVE);
  for (const c of hand) add(p, c, LIVE, HAND_PAYOFF);
  for (const c of deck) add(p, c, DECK);
  return p;
}

/** What `side` can see of the other side's plan: identity, public cards, discards. */
function buildOpponent(state: GameState, side: SideCode): Profile {
  const p = blank();
  if (side === 'runner') {
    add(p, state.corp.identity, IDENTITY);
    for (const c of corpInstalled(state)) if (c.isRezzed || c.faceUp) add(p, c, LIVE);
    for (const c of [...state.corp.archives.faceUp, ...state.corp.scoreArea, ...state.runner.scoreArea]) add(p, c, SEEN);
  } else {
    add(p, state.runner.identity, IDENTITY);
    for (const c of runnerInstalled(state)) add(p, c, LIVE);
    for (const c of state.runner.heap) add(p, c, SEEN);
  }
  return p;
}

const ownCache = { corp: new WeakMap<GameState, Profile>(), runner: new WeakMap<GameState, Profile>() };
const oppCache = { corp: new WeakMap<GameState, Profile>(), runner: new WeakMap<GameState, Profile>() };

/** `side`'s own deck profile in this position. */
export function deckProfile(state: GameState, side: SideCode): Profile {
  let p = ownCache[side].get(state);
  if (!p) ownCache[side].set(state, (p = buildOwn(state, side)));
  return p;
}

/** `side`'s read of the opponent in this position, from public information only. */
export function opponentProfile(state: GameState, side: SideCode): Profile {
  let p = oppCache[side].get(state);
  if (!p) oppCache[side].set(state, (p = buildOpponent(state, side)));
  return p;
}

/** The card an action plays or installs (from hand), if any. */
function actionCard(state: GameState, action: GameAction): CardInstance | undefined {
  if (action.type !== 'INSTALL_CARD' && action.type !== 'PLAY_OPERATION_OR_EVENT') return undefined;
  const id = action.cardInstanceId;
  const hand = action.player === 'corp' ? state.corp.hq : [...state.runner.grip, ...runnerInstalled(state)];
  return hand.find(c => c.instanceId === id) ?? findCardAnywhere(state, id) ?? undefined;
}

const ECON_RESOURCE = (card: CardInstance) => (cardSynergy(cardDef(card)).gives?.econ ?? 0) >= 1;

/** The themes and counter features a move hits (before weighting). */
function moveFeatures(state: GameState, side: SideCode, action: GameAction): { features: Features; wants: ThemeWeights; card?: CardInstance } {
  const features: Features = {};
  const bump = (f: Feature, w = 1) => (features[f] = (features[f] ?? 0) + w);
  const card = actionCard(state, action);
  let wants: ThemeWeights = {};
  if (card) {
    const syn = cardSynergy(cardDef(card));
    for (const [t, w] of Object.entries(syn.gives ?? {})) bump(t as Theme, w);
    wants = syn.wants ?? {};
    const type = cardDef(card).type_code;
    if (type === 'operation') bump('operations');
    if (type === 'ice' && action.type === 'INSTALL_CARD') {
      if (action.targetServerId === 'hq') bump('iceHq');
      if (action.targetServerId === 'rd') bump('iceRd');
    }
  }
  switch (action.type) {
    case 'DRAW_CARD': {
      const [size, limit] = side === 'corp' ? [state.corp.hq.length, state.corp.handSizeLimit] : [state.runner.grip.length, state.runner.handSizeLimit];
      if (size < limit) bump('draw', BASIC);
      if (side === 'runner' && size <= 2) bump('bigHand');
      break;
    }
    case 'ADVANCE_CARD':
      bump('advance', BASIC);
      break;
    case 'PURGE_VIRUS':
      bump('purge');
      break;
    case 'REMOVE_TAG':
      bump('cleanTags');
      break;
    case 'TRASH_RESOURCE': {
      const target = state.runner.rig.resources.find(c => c.instanceId === action.cardInstanceId);
      if (target && ECON_RESOURCE(target)) bump('trashEcon');
      break;
    }
    case 'INITIATE_RUN': {
      const id = action.targetServerId;
      bump('runs', BASIC);
      if (id === 'hq' || id === 'rd' || id === 'archives') bump(id, BASIC);
      const root = state.corp.servers[id]?.root ?? [];
      if (root.some(c => c.isRezzed && cardDef(c).type_code === 'asset' && ECON_RESOURCE(c))) bump('trashEcon');
      if (root.some(c => cardDef(c).type_code !== 'agenda' && (c.isRezzed || c.advancementCounters === 0))) bump('trash', 0.5);
      break;
    }
  }
  return { features, wants, card };
}

export interface Nudge {
  bonus: number;
  /** Why, for the debug log: "econ→payoff 0.4" and the like. */
  reasons: string[];
}

/**
 * The deck-aware bonus for a move, capped at MAX_NUDGE. Never negative:
 * a move off-plan simply gets no help.
 */
export function nudge(state: GameState, side: SideCode, action: GameAction, explain = false): Nudge {
  const { features, wants, card } = moveFeatures(state, side, action);
  const own = deckProfile(state, side);
  const opp = opponentProfile(state, side);
  // Leave the card itself out of the profile it is judged against
  const self = card ? cardSynergy(cardDef(card)) : {};
  const reasons: string[] = [];
  let synergy = 0;
  for (const [f, w] of Object.entries(features)) {
    if (!(f in own.demand)) continue;
    const t = f as Theme;
    const v = w * sat(own.live[t] - (self.wants?.[t] ?? 0) * HAND_PAYOFF);
    if (v > 0.01) {
      synergy += v;
      if (explain) reasons.push(`feeds ${t} payoffs +${(v * tuning.synergy[side]).toFixed(2)}`);
    }
  }
  for (const [t, w] of Object.entries(wants)) {
    const v = (w ?? 0) * sat(own.supply[t as Theme] - (self.gives?.[t as Theme] ?? 0) * LIVE);
    if (v > 0.01) {
      synergy += v;
      if (explain) reasons.push(`pays off ${t} +${(v * tuning.synergy[side]).toFixed(2)}`);
    }
  }
  let counter = 0;
  for (const [theirs, answers] of Object.entries(COUNTERS[side])) {
    const lean = sat(opp.supply[theirs as Theme]);
    if (lean <= 0) continue;
    for (const [f, w] of Object.entries(answers ?? {})) {
      const v = lean * (w ?? 0) * (features[f as Feature] ?? 0);
      if (v > 0.01) {
        counter += v;
        if (explain) reasons.push(`counters their ${theirs} (${f}) +${(v * tuning.counter[side]).toFixed(2)}`);
      }
    }
  }
  const bonus = Math.min(MAX_NUDGE, tuning.synergy[side] * synergy + tuning.counter[side] * counter);
  return { bonus, reasons: reasons.filter(r => !r.endsWith('+0.00')) }; // weights at 0 add nothing
}

/** Extra reason to keep a card in hand: how well it fits the deck's plan (0 to about 1). */
export function keepBonus(state: GameState, card: CardInstance): number {
  const side = cardDef(card).side_code as SideCode;
  const own = deckProfile(state, side);
  const syn = cardSynergy(cardDef(card));
  let v = 0;
  for (const [t, w] of Object.entries(syn.gives ?? {})) v += (w ?? 0) * sat(own.demand[t as Theme] - (syn.wants?.[t as Theme] ?? 0) * LIVE);
  for (const [t, w] of Object.entries(syn.wants ?? {})) v += (w ?? 0) * sat(own.supply[t as Theme] - (syn.gives?.[t as Theme] ?? 0) * LIVE);
  return Math.min(1, tuning.keep[side] * v);
}

/** How hard the opponent leans on a theme, 0 to 1 (e.g. "is this Runner econ-reliant?"). */
export function opponentLean(state: GameState, side: SideCode, theme: Theme): number {
  return sat(opponentProfile(state, side).supply[theme]);
}

// ---- Debug log: which tag pushed each move ----

let debug = false;

/** Logs every top-level AI move with the synergy and opponent-read reasons behind it. */
export function setSynergyDebug(on: boolean) {
  debug = on;
}

export function logNudge(state: GameState, side: SideCode, action: GameAction) {
  if (!debug) return;
  const { bonus, reasons } = nudge(state, side, action, true);
  const card = 'cardInstanceId' in action && action.cardInstanceId ? findCardAnywhere(state, action.cardInstanceId) : null;
  const what = `${action.type}${card ? ` ${cardDef(card).title}` : ''}${action.type === 'INITIATE_RUN' ? ` ${action.targetServerId}` : ''}`;
  console.debug(`[AI ${side}] ${what}: nudge +${bonus.toFixed(2)}${reasons.length ? ` (${reasons.join('; ')})` : ''}`);
}
