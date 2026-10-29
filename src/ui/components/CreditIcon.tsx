import React from 'react';

// Official Netrunner game symbols from the Null Signal Games Visual Assets pack v1.5
// (NSG_CREDIT.svg, NSG_RECURRING_CREDIT.svg, NSG_Mu.svg, NSG_CLICK.svg, NSG_TRASH_ABILITY.svg,
// NSG_LINK.svg, NSG_SUBROUTINE.svg). Licensed CC BY-ND 4.0: the paths are
// used unmodified, only the fill colour changes (it follows the CSS text colour).
// https://creativecommons.org/licenses/by-nd/4.0/

const CREDIT_VIEWBOX = '0 0 32595 32595';
const CREDIT_PATH =
  'M16296.3,0.006l8549.41,8549.41l0,15493.8l-8549.41,8549.41l-8549.41,-8549.41l-0,-15493.8l8549.41,-8549.41Zm-6059.93,23027.7l6059.93,6059.93l-0,-12709.5l6059.92,-6059.92l-0,-753.396l-6059.92,-6059.93l-6059.93,6059.93l0,13462.9Z';

const RECURRING_CREDIT_VIEWBOX = '0 0 5867 5867';
const RECURRING_CREDIT_PATH =
  'M3838.39,143.024c617.13,165.092 1200.85,530.653 1751.16,1096.68l-253.535,247.638c-503.138,-518.861 -1033.79,-851.01 -1591.96,-996.449c-444.177,-117.923 -896.215,-113.992 -1356.11,11.793c-373.423,98.269 -737.019,273.188 -1090.79,524.757l489.381,229.95l-1509.41,383.249l636.784,-1420.97l147.404,536.549c43.238,-31.446 84.511,-58.961 123.819,-82.546c357.699,-239.777 727.191,-412.73 1108.48,-518.861c522.792,-141.508 1037.72,-145.438 1544.79,-11.792Zm-2099.03,1774.74l1373.8,-1379.7l1379.7,1379.7l0,2523.55l-1379.7,1379.7l-1373.8,-1379.7l0,-2523.55Zm2399.73,253.534l0,-106.13l-1025.93,-1020.03l-1020.03,1020.03l0,2228.74l1020.03,1025.93l-0,-2128.51l1025.93,-1020.03Z';

const MU_VIEWBOX = '0 0 5867 5867';
const MU_PATH =
  'M731.122,1344.32l4404.42,-0l0,2694.54l-790.083,-0l-678.057,483.484l-2936.28,0l0,-3178.02Zm4103.72,477.588l-0,-176.885l-383.25,0l0,176.885l383.25,-0Zm-383.25,1261.78l0,182.781l383.25,-0l-0,-182.781l-383.25,0Zm0,-483.484l0,182.781l383.25,-0l-0,-182.781l-383.25,0Zm0,-477.588l0,182.781l383.25,-0l-0,-182.781l-383.25,0Zm-878.526,2099.03l577.823,-406.835l-0,-2169.78l-3119.06,0l-0,2576.62l2541.24,-0Zm878.526,-660.369l0,182.781l383.25,-0l-0,-182.781l-383.25,0Z';

const SYMBOL_VIEWBOX = '0 0 5867 5867';
const CLICK_PATH =
  'M3797.94,557.186c-2551.07,3050.27 -2551.07,3050.27 0,-0Zm1768.85,1409.18c23.584,322.323 -27.516,658.403 -153.3,1008.24c-220.123,601.407 -605.338,1130.1 -1155.64,1586.06l-147.404,-176.884c522.792,-428.454 886.388,-923.73 1090.79,-1485.83c117.923,-322.322 165.093,-626.957 141.508,-913.902c-19.654,-275.154 -102.2,-514.931 -247.638,-719.33c-263.361,-377.354 -674.126,-573.892 -1232.3,-589.615l-82.546,259.43c255.5,27.516 479.553,104.166 672.161,229.95c243.707,165.092 412.73,389.146 507.068,672.161l-424.522,141.507c-62.892,-184.745 -171.971,-330.184 -327.236,-436.314c-155.266,-106.131 -346.89,-163.127 -574.875,-170.989l-412.73,1255.88c23.585,23.584 43.238,49.134 58.961,76.65c35.377,74.684 35.377,155.265 0,241.742c-31.446,90.407 -90.407,167.057 -176.884,229.949c-86.477,62.893 -174.919,94.339 -265.327,94.339c-23.584,-0 -47.169,-3.931 -70.753,-11.793l-1261.78,896.215c78.615,82.546 172.954,149.369 283.015,200.469c110.062,51.1 235.846,82.546 377.354,94.338l-35.377,442.211c-491.346,-39.307 -854.942,-241.742 -1090.79,-607.303c-125.784,-196.538 -195.555,-420.592 -209.313,-672.161c-13.757,-251.569 26.533,-510.999 120.871,-778.291c106.131,-290.877 269.258,-566.03 489.38,-825.461l341.977,288.911c-184.746,220.123 -320.357,450.073 -406.834,689.85c-137.577,373.422 -139.542,695.745 -5.896,966.968l1185.12,-949.28c0,-43.238 7.862,-86.477 23.585,-129.715c47.169,-133.646 139.542,-229.95 277.119,-288.911l477.588,-1202.81c-483.484,70.753 -929.626,298.738 -1338.43,683.953l-306.599,-324.288c267.292,-251.569 562.099,-450.073 884.422,-595.511c318.392,-141.508 634.818,-216.192 949.279,-224.054l94.339,-241.742c-424.523,31.446 -851.011,167.058 -1279.46,406.834l-112.027,-194.573c530.653,-298.738 1055.41,-448.107 1574.27,-448.107c322.323,0 611.234,59.944 866.734,179.833c255.5,119.888 461.865,291.859 619.096,515.913c165.092,235.845 259.43,510.999 283.015,825.46Zm-2494.07,908.007c11.793,-31.446 11.793,-56.996 0,-76.65c-3.93,-7.862 -11.792,-13.758 -23.584,-17.688c-7.862,-3.931 -17.689,-5.897 -29.481,-5.897c-15.723,0 -31.446,1.966 -47.169,5.897c-94.339,27.515 -157.231,82.546 -188.677,165.092c-11.792,35.377 -11.792,62.892 0,82.546c7.862,11.792 25.55,17.688 53.065,17.688c47.17,0 93.356,-17.688 138.56,-53.065c45.204,-35.377 77.632,-74.685 97.286,-117.923Zm-1002.35,2323.08c577.823,-0 1153.68,-192.608 1727.57,-577.823l123.82,188.677c-613.2,408.8 -1230.33,613.2 -1851.39,613.2c-322.323,-0 -611.234,-59.945 -866.733,-179.833c-255.5,-119.888 -461.865,-289.894 -619.096,-510.017c-165.092,-239.776 -259.43,-516.895 -283.015,-831.356c-27.515,-318.392 23.585,-652.507 153.3,-1002.35c125.784,-349.838 316.426,-681.987 571.926,-996.448c243.708,-302.669 528.688,-567.996 854.942,-795.98l129.715,182.78c-310.531,216.192 -581.753,467.761 -813.669,754.707c-235.845,294.807 -414.695,605.338 -536.549,931.591c-113.992,318.392 -159.196,621.061 -135.611,908.007c19.653,275.154 100.234,514.93 241.742,719.33c137.576,192.608 317.409,340.011 539.497,442.211c222.088,102.2 476.605,153.3 763.551,153.3Zm2836.05,-2211.05c-184.746,503.138 -512.965,935.522 -984.656,1297.15c-467.762,365.561 -959.107,567.996 -1474.04,607.303l-35.377,-442.211c428.453,-35.377 843.149,-208.33 1244.09,-518.861c400.938,-310.53 676.091,-676.091 825.461,-1096.68c86.476,-231.915 117.922,-450.073 94.338,-654.473l442.211,-47.169c31.446,271.223 -5.896,556.204 -112.027,854.942Z';
const TRASH_PATH =
  'M4916.32,1855.6c3.931,3.931 5.896,9.827 5.896,17.688l0,2877.32c0,35.377 -11.792,66.823 -35.377,94.339c-23.584,27.515 -55.031,45.203 -94.338,53.065l-878.526,129.715l-448.107,70.754l94.338,-241.742c43.238,-110.062 55.031,-224.054 35.377,-341.977c-27.515,-184.746 -114.975,-332.149 -262.379,-442.211c-147.403,-110.061 -313.478,-151.334 -498.224,-123.819c-117.923,19.654 -222.088,64.858 -312.496,135.612l-170.988,135.611l-159.196,-524.757l-53.066,-165.092l-501.172,-0l-0,-147.404l454.003,-0l-58.961,-182.781l-1090.79,0l-0,-153.299l1043.62,-0l-141.508,-454.004l-683.953,0l0,-147.403l636.784,-0l-29.481,-100.235c-3.931,-3.931 -5.896,-9.827 -5.896,-17.688l-41.273,-271.223c-47.169,-35.377 -76.65,-82.546 -88.442,-141.508l-35.377,-235.846l147.404,-23.584l-147.404,23.584l-11.792,-88.442c-7.862,-58.961 6.878,-113.009 44.221,-162.144c37.342,-49.134 85.494,-79.598 144.455,-91.39l117.923,-17.689l94.339,-11.792l47.169,-94.338l41.273,-100.235c43.238,-90.407 115.957,-143.473 218.157,-159.196l88.443,-11.792l1544.79,-235.846l82.546,-11.792c102.2,-11.793 184.746,17.688 247.638,88.442l147.404,165.092l123.819,-23.584l88.442,-11.793c62.893,-7.861 118.906,5.896 168.041,41.273c49.134,35.377 77.632,82.546 85.494,141.508l11.792,70.754l-147.404,23.584l147.404,-23.584l41.273,253.534c7.862,62.892 -5.896,117.923 -41.273,165.092l35.377,271.223Zm-3024.72,-235.846l0,11.792l23.585,165.092l2700.43,-406.834l-29.48,-170.988l-11.793,-0l-23.584,-147.404l23.584,147.404l-288.911,47.169l-206.365,-229.95l112.027,-100.234l-112.027,100.234l-35.377,-41.273l-76.65,5.896l-17.688,-129.715l17.688,129.715l-1538.89,235.846l-82.546,11.793l-153.3,330.184l-300.704,41.273Zm2004.69,3113.17l725.227,-112.027l-0,-2735.81l-29.481,-188.677l-2564.82,383.249l23.584,188.677l58.962,176.885l471.692,-0l-0,147.403l-424.523,0l141.507,454.004l530.654,-0l-0,153.299l-483.484,0l58.961,182.781l347.873,-0l-0,147.404l-300.704,-0l64.858,212.261c86.477,-43.238 178.85,-72.719 277.119,-88.442c263.361,-39.308 502.155,20.636 716.382,179.832c214.226,159.196 340.994,370.475 380.301,633.836c15.723,86.477 17.689,174.919 5.896,265.327Zm-1067.2,-595.511c141.507,-19.654 270.24,12.775 386.197,97.286c115.958,84.512 184.746,198.504 206.366,341.977c21.619,143.473 -10.81,272.205 -97.287,386.198c-86.477,113.992 -200.469,182.78 -341.976,206.365l-88.443,5.896l-1079,-0l0,-147.404l725.227,0c-82.547,-82.546 -131.681,-182.78 -147.404,-300.703c-23.585,-141.508 7.861,-270.24 94.338,-386.198c86.477,-115.958 200.469,-183.763 341.977,-203.417Zm294.807,483.484c-7.861,-62.892 -35.377,-112.027 -82.546,-147.404c-43.238,-31.446 -88.442,-47.169 -135.611,-47.169c-11.793,0 -23.585,1.965 -35.377,5.896c-39.308,3.931 -74.685,18.671 -106.131,44.221c-31.446,25.55 -54.048,56.996 -67.806,94.339c-13.757,37.342 -16.705,75.667 -8.844,114.975c7.862,58.961 36.36,107.113 85.494,144.455c49.135,37.342 104.166,52.083 165.092,44.221c60.927,-7.861 110.062,-37.342 147.404,-88.442c37.342,-51.1 50.117,-106.131 38.325,-165.092Zm-1792.43,554.238l0,-147.404l277.119,0l0,147.404l-277.119,-0Z';
const LINK_PATH =
  'M4663.85,5474.57l-4410.32,-0l0,-3225.19l719.33,0l0,448.107l-271.222,0l-0,2334.88l3514.1,-0l0,-2334.88l-2346.67,0l-0,-448.107l2794.77,0l-0,3225.19Zm949.279,-1857.29l-725.226,0l0,-448.107l277.119,0l0,-2328.98l-3520,0l0,2328.98l2352.56,0l-0,448.107l-2800.67,0l-0,-3225.19l4416.21,-0l0,3225.19Z';
const SUBROUTINE_PATH =
  'M5743.67,3576.01l-1621.44,1533l-0,-1232.3l-3867.87,-0l-0,-2818.36l583.718,0l0,2216.95l3284.16,-0l-0,-1232.3l1621.44,1533Z';

// Sized to the surrounding text by default so it can sit inline like the "c" it replaces.
const DEFAULT_CLASS = 'inline-block w-[1em] h-[1em] align-[-0.125em] shrink-0';

export function CreditIcon({ className = DEFAULT_CLASS, title = 'credit' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={CREDIT_VIEWBOX} fill="currentColor" fillRule="nonzero" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path d={CREDIT_PATH} />
    </svg>
  );
}

export function RecurringCreditIcon({ className = DEFAULT_CLASS, title = 'recurring credit' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={RECURRING_CREDIT_VIEWBOX} fill="currentColor" fillRule="nonzero" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path d={RECURRING_CREDIT_PATH} />
    </svg>
  );
}

export function MuIcon({ className = DEFAULT_CLASS, title = 'memory unit' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={MU_VIEWBOX} fill="currentColor" fillRule="nonzero" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path d={MU_PATH} />
    </svg>
  );
}

export function ClickIcon({ className = DEFAULT_CLASS, title = 'click' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={SYMBOL_VIEWBOX} fill="currentColor" fillRule="nonzero" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path d={CLICK_PATH} />
    </svg>
  );
}

export function TrashSymbolIcon({ className = DEFAULT_CLASS, title = 'trash this card' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={SYMBOL_VIEWBOX} fill="currentColor" fillRule="nonzero" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path d={TRASH_PATH} />
    </svg>
  );
}

export function LinkIcon({ className = DEFAULT_CLASS, title = 'link' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={SYMBOL_VIEWBOX} fill="currentColor" fillRule="nonzero" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path d={LINK_PATH} />
    </svg>
  );
}

/** A number of credits, written the way cards print it: "3" followed by the credit symbol. */
export function SubroutineIcon({ className = DEFAULT_CLASS, title = 'subroutine' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={SYMBOL_VIEWBOX} fill="currentColor" fillRule="nonzero" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path d={SUBROUTINE_PATH} />
    </svg>
  );
}

export function Credits({ amount, className = '' }: { amount: number | string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.15em] whitespace-nowrap ${className}`}>
      {amount}
      <CreditIcon />
    </span>
  );
}

// HTML versions for card text rendered through dangerouslySetInnerHTML.
const svgHtml = (viewBox: string, path: string, label: string) =>
  `<svg viewBox="${viewBox}" fill="currentColor" fill-rule="nonzero" class="${DEFAULT_CLASS}" role="img" aria-label="${label}"><path d="${path}"/></svg>`;

export const CREDIT_ICON_HTML = svgHtml(CREDIT_VIEWBOX, CREDIT_PATH, 'credit');
export const MU_ICON_HTML = svgHtml(MU_VIEWBOX, MU_PATH, 'memory unit');
export const RECURRING_CREDIT_ICON_HTML = svgHtml(RECURRING_CREDIT_VIEWBOX, RECURRING_CREDIT_PATH, 'recurring credit');
export const CLICK_ICON_HTML = svgHtml(SYMBOL_VIEWBOX, CLICK_PATH, 'click');
export const TRASH_ICON_HTML = svgHtml(SYMBOL_VIEWBOX, TRASH_PATH, 'trash this card');
export const LINK_ICON_HTML = svgHtml(SYMBOL_VIEWBOX, LINK_PATH, 'link');
export const SUBROUTINE_ICON_HTML = svgHtml(SYMBOL_VIEWBOX, SUBROUTINE_PATH, 'subroutine');

const SYMBOL_ICONS: Record<string, (key: number) => React.ReactNode> = {
  '[click]': key => <ClickIcon key={key} />,
  '[credit]': key => <CreditIcon key={key} />,
  '[recurring-credit]': key => <RecurringCreditIcon key={key} />,
  '[mu]': key => <MuIcon key={key} />,
  '[trash]': key => <TrashSymbolIcon key={key} />,
  '[link]': key => <LinkIcon key={key} />,
  '[subroutine]': key => <SubroutineIcon key={key} />,
};
const SYMBOL_RE = /(\[(?:click|credit|recurring-credit|mu|trash|link|subroutine)\])/;

/** Plain text (log lines, prompts, ability labels) with each rules symbol like [click] drawn as its icon. */
export function renderSymbols(text: string): React.ReactNode[] {
  return text.split(SYMBOL_RE).map((part, i) => (i % 2 === 1 ? SYMBOL_ICONS[part](i) : part)).filter(part => part !== '');
}
