# AI self-play batch log

Every self-play batch, newest last (Jeff, 2026-10-28). Made with `scripts/corp-losses.sh 10 normal > out.txt`, then `node scripts/batch-log.mjs "<change>" out.txt`. Noise: about ±2 points of Corp win rate at 2,210 games. Corp loss columns are the share of the Runner's points in Corp losses; full breakdowns (with per-deck win rates from 2026-10-28 on) are in `docs/batch-logs/`.

| Date | Change | Commit | Games | Corp win | Corp wins: points / flatline | Runner wins: points / Corp decked | Runner pts from remote / R&D / HQ / Archives | Corp credits at turn end (losses) | Full |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-27 | Baseline: value model all off (same as main 1724c6b) | 3648c23 | 2210 | **40.1%** | 31.9% / 8.2% | 56.9% / 3.0% | 39.0% / 31.0% / 23.8% / 6.2% | 6.3 | [txt](batch-logs/2026-10-27-baseline-value-model-all-off-same-as-main-1724c6b.txt) |
| 2026-10-27 | Step 2 all on (incl. flat click rate) | 3648c23 | 2210 | **38.6%** | 31.1% / 7.5% | 59.8% / 1.7% | 36.5% / 30.4% / 26.0% / 7.2% | 5.8 | [txt](batch-logs/2026-10-27-step-2-all-on-incl-flat-click-rate.txt) |
| 2026-10-27 | Step 2 ablation: click rate off | 3648c23 | 2210 | **37.7%** | 30.7% / 7.1% | 58.8% / 3.4% | 38.5% / 29.6% / 24.8% / 7.1% | 6.3 | [txt](batch-logs/2026-10-27-step-2-ablation-click-rate-off.txt) |
| 2026-10-27 | Step 2 ablation: credit slide off | 3648c23 | 2210 | **41.0%** | 32.9% / 8.1% | 56.6% / 2.4% | 35.4% / 32.1% / 26.3% / 6.1% | 5.7 | [txt](batch-logs/2026-10-27-step-2-ablation-credit-slide-off.txt) |
| 2026-10-27 | Step 2 ablation: point clock off | 3648c23 | 2210 | **38.5%** | 31.0% / 7.5% | 59.8% / 1.7% | 36.5% / 30.3% / 26.1% / 7.1% | 5.8 | [txt](batch-logs/2026-10-27-step-2-ablation-point-clock-off.txt) |
| 2026-10-27 | Step 2 ablation: hand filter off | 3648c23 | 2210 | **38.2%** | 30.6% / 7.6% | 60.1% / 1.7% | 36.2% / 30.3% / 26.3% / 7.2% | 5.9 | [txt](batch-logs/2026-10-27-step-2-ablation-hand-filter-off.txt) |
| 2026-10-27 | Step 2: credit slide Corp only | 3648c23 | 2210 | **41.7%** | 33.3% / 8.3% | 56.2% / 2.1% | 37.4% / 29.6% / 26.1% / 6.9% | 5.7 | [txt](batch-logs/2026-10-27-step-2-credit-slide-corp-only.txt) |
| 2026-10-27 | Step 2: credit slide Runner only | 3648c23 | 2210 | **38.4%** | 30.7% / 7.6% | 59.1% / 2.5% | 36.2% / 30.6% / 26.0% / 7.2% | 5.9 | [txt](batch-logs/2026-10-27-step-2-credit-slide-runner-only.txt) |
| 2026-10-27 | Step 2: click rate Corp only | 3648c23 | 2210 | **36.5%** | 29.3% / 7.2% | 60.5% / 3.1% | 38.0% / 30.7% / 24.3% / 7.0% | 5.9 | [txt](batch-logs/2026-10-27-step-2-click-rate-corp-only.txt) |
| 2026-10-27 | Step 2: click rate Runner only | 3648c23 | 2210 | **41.1%** | 33.8% / 7.3% | 56.4% / 2.5% | 35.9% / 30.9% / 25.9% / 7.3% | 6.0 | [txt](batch-logs/2026-10-27-step-2-click-rate-runner-only.txt) |
| 2026-10-27 | Step 3 counters by effect on | 83226ab | 2210 | **45.9%** | 38.6% / 7.3% | 50.7% / 3.4% | 40.2% / 30.1% / 22.5% / 7.1% | 6.6 | [txt](batch-logs/2026-10-27-step-3-counters-by-effect-on.txt) |
| 2026-10-27 | Step 3: Corp only | 83226ab | 2210 | **38.1%** | 31.0% / 7.1% | 58.5% / 3.5% | 38.8% / 29.7% / 24.6% / 7.0% | 6.3 | [txt](batch-logs/2026-10-27-step-3-corp-only.txt) |
| 2026-10-27 | Step 3: Runner only | 83226ab | 2210 | **45.7%** | 38.5% / 7.2% | 50.9% / 3.4% | 40.4% / 29.7% / 22.8% / 7.0% | 6.6 | [txt](batch-logs/2026-10-27-step-3-runner-only.txt) |
| 2026-10-27 | Step 3b Smartware decay on | eee332e | 2210 | **35.2%** | 28.1% / 7.1% | 61.9% / 2.9% | 38.5% / 30.6% / 24.5% / 6.5% | 6.4 | [txt](batch-logs/2026-10-27-step-3b-smartware-decay-on.txt) |
| 2026-10-27 | Step 3b: Runner only | eee332e | 2210 | **34.8%** | 27.8% / 6.9% | 62.3% / 3.0% | 38.5% / 30.2% / 24.6% / 6.6% | 6.4 | [txt](batch-logs/2026-10-27-step-3b-runner-only.txt) |
| 2026-10-27 | Step 4 card profiles on | aad053c | 2210 | **36.0%** | 29.1% / 6.9% | 61.0% / 3.1% | 38.8% / 30.4% / 24.9% / 5.9% | 6.2 | [txt](batch-logs/2026-10-27-step-4-card-profiles-on.txt) |
| 2026-10-27 | Step 5a ice in credits on | 12cb288 | 2210 | **38.5%** | 31.3% / 7.2% | 58.2% / 3.3% | 40.0% / 31.3% / 22.8% / 5.9% | 6.2 | [txt](batch-logs/2026-10-27-step-5a-ice-in-credits-on.txt) |
| 2026-10-27 | Step 5b breakers in credits on | d4646ce | 2210 | **39.0%** | 31.4% / 7.6% | 58.3% / 2.7% | 38.8% / 31.3% / 24.2% / 5.7% | 6.1 | [txt](batch-logs/2026-10-27-step-5b-breakers-in-credits-on.txt) |
| 2026-10-27 | Step 6 ablation: moneyTarget off | d4646ce | 2210 | **37.0%** | 29.4% / 7.6% | 60.0% / 3.0% | 38.8% / 31.4% / 24.0% / 5.8% | 5.9 | [txt](batch-logs/2026-10-27-step-6-ablation-moneytarget-off.txt) |
| 2026-10-27 | Step 6 ablation: agendaMoney off | d4646ce | 2210 | **37.9%** | 30.4% / 7.5% | 59.4% / 2.7% | 40.0% / 30.8% / 23.5% / 5.6% | 6.1 | [txt](batch-logs/2026-10-27-step-6-ablation-agendamoney-off.txt) |
| 2026-10-27 | Step 6 ablation: iceReserve off | d4646ce | 2210 | **38.7%** | 31.2% / 7.5% | 58.4% / 2.9% | 38.9% / 31.3% / 23.8% / 5.9% | 6.1 | [txt](batch-logs/2026-10-27-step-6-ablation-icereserve-off.txt) |
| 2026-10-27 | Step 6 ablation: icePacing off | d4646ce | 2210 | **37.6%** | 31.0% / 6.6% | 60.0% / 2.4% | 40.5% / 27.3% / 26.6% / 5.7% | 5.6 | [txt](batch-logs/2026-10-27-step-6-ablation-icepacing-off.txt) |
| 2026-10-27 | Step 6 ablation: deepReserve off | d4646ce | 2210 | **38.6%** | 31.0% / 7.6% | 58.4% / 3.0% | 38.9% / 31.2% / 24.2% / 5.7% | 6.1 | [txt](batch-logs/2026-10-27-step-6-ablation-deepreserve-off.txt) |
| 2026-10-27 | Step 6 ablation: affordIce off | d4646ce | 2210 | **38.5%** | 31.0% / 7.5% | 58.6% / 2.9% | 39.0% / 31.0% / 24.1% / 5.9% | 6.1 | [txt](batch-logs/2026-10-27-step-6-ablation-affordice-off.txt) |
| 2026-10-27 | Step 6 ablation: rezMoney off | d4646ce | 2210 | **35.5%** | 28.1% / 7.4% | 61.4% / 3.0% | 40.0% / 30.7% / 24.2% / 5.1% | 5.8 | [txt](batch-logs/2026-10-27-step-6-ablation-rezmoney-off.txt) |
| 2026-10-27 | Step 6: deepReserve, iceReserve, hostedMoney off (kept) | a6a9211 | 2210 | **38.9%** | 31.6% / 7.3% | 57.9% / 3.2% | 39.3% / 31.1% / 23.5% / 6.1% | 6.1 | [txt](batch-logs/2026-10-27-step-6-deepreserve-icereserve-hostedmoney-off-kept.txt) |
| 2026-10-28 | Step 6 test: five Corp money hacks off (rejected) | a6a9211 | 2210 | **33.6%** | 27.6% / 6.0% | 63.3% / 3.2% | 41.4% / 26.7% / 26.7% / 5.2% | 5.4 | [txt](batch-logs/2026-10-28-step-6-test-five-corp-money-hacks-off-rejected.txt) |
| 2026-10-28 | Full new value system (steps 1-6 + audit) | de77a34 | 2210 | **38.8%** | 31.0% / 7.7% | 57.9% / 3.3% | 40.0% / 31.1% / 23.1% / 5.9% | 6.2 | [txt](batch-logs/2026-10-28-full-new-value-system-steps-1-6-audit.txt) |
