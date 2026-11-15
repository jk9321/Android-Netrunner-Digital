/**
 * TEMPORARY (Stage C7 leave-one-out, spec section 5; deleted with plan.corpCore before the hand-off): `off` names the
 * carried-over rules left out, `fired` records each rule that applied (a rule that never applied cannot change a
 * decision). `rule(name, applies)` is true when the rule applies and is not left out. Nothing outside the measurement
 * sets `off`.
 */
export const leaveOut = { off: new Set<string>(), fired: new Set<string>() };
export const rule = (name: string, applies: boolean): boolean => {
  if (!applies) return false;
  leaveOut.fired.add(name);
  return !leaveOut.off.has(name);
};
