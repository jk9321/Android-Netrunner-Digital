# R-14h fix: commit 3's draft drawMoney written into a tree (scratch tool for step 0.2's pick list and the form reads; the
# commit itself is written by hand). The 'later' money per side: none (credits + turn-start payments), 1 or 2 (every click
# but k earning), today (the credits, as commit 2).
#   python3 scripts/runner-rework/last-credits-fix-draft.py <runner form> <corp form> <tree dir holding src/>
import sys,os
os.chdir(sys.argv[3])
KR=sys.argv[1]; KC=sys.argv[2]   # 'none' | '1' | '2' | 'today'
def sub(f,old,new):
    t=open(f).read(); assert t.count(old)==1,(f,old[:60]); open(f,'w').write(t.replace(old,new))
H='src/ai/handValues.ts'
def form(side,k):
    if side=='runner':
        if k=='today': return None
        if k=='none': return "state.runner.credits + runnerEarnings(state, nextTurn(state))[0]"
        return f"state.runner.credits + runnerEarnings(state, nextTurn(state))[Math.max(0, state.runner.maxClicks - {k})]"
    else:
        if k=='today': return None
        if k=='none': return "state.corp.credits + knownIncome(state)"
        return f"nextTurnCredits(state, state.corp.credits, 0, {k})"
r=form('runner',KR); c=form('corp',KC)
desc={'none':"its credits and what its cards pay as its turn begins, no click earning",'1':"its credits and what its cards and every click but one make on that turn (one click kept to play the card)",'2':"its credits and what its cards and every click but two make on that turn (two clicks kept: one draws the card, one plays it)"}
lines=[]
lines.append("const laterMoneys = new WeakMap<GameState, Partial<Record<SideCode, number>>>();")
body=f"""/**
 * The money a deck card drawn `when` is tested against (heldFromPlayed: payable soon or not): the side's credits on the
 * board for a card in hand now or lost from it now ('now'); for a card that arrives on a later turn ('later'), the money
 * it is played with on that turn (R-14h, issue #65; the form chosen at step 0.3, runner-rework/r14h-fix/): the Runner,
 * {desc.get(KR,"its credits on the board")}; the Corp, {desc.get(KC,"its credits on the board")}. Read from
 * the next-turn money's owners (nextTurnMoney.ts), never a copy; worked out once per board and side (laterMoneys).
 */
function drawMoney(state: GameState, side: SideCode, when: DrawWhen): number {{
  const credits = side === 'corp' ? state.corp.credits : state.runner.credits;
  if (when === 'now'{" || side === 'runner'" if r is None else ""}{" || side === 'corp'" if c is None else ""}) return credits;
  let money = laterMoneys.get(state);
  if (!money) laterMoneys.set(state, (money = {{}}));
  return (money[side] ??= side === 'corp' ? {c if c else 'credits'} : {r if r else 'credits'});
}}"""
t=open(H).read()
i=t.index("/**\n * The money a deck card drawn `when` is tested against")
j=t.index("  return side === 'corp' ? state.corp.credits : state.runner.credits;\n}\n",i)+len("  return side === 'corp' ? state.corp.credits : state.runner.credits;\n}\n")
t=t[:i]+lines[0]+"\n"+body+"\n"+t[j:]
imps=[]
if r: imps+=['nextTurn','runnerEarnings']
if c: imps+=['knownIncome' if KC=='none' else 'nextTurnCredits']
anchor="import { corpDrawPool, corpKnowsRd } from './oracle';\n"
t=t.replace(anchor,anchor+"import { "+", ".join(sorted(imps,key=str.lower))+" } from './nextTurnMoney';\n",1)
open(H,'w').write(t)
print('ok',KR,KC)
