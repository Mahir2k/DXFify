/**
 * Rounds a rough tick spacing to a "nice" 1 / 2 / 5 step at the appropriate
 * power of ten, the same logic real CAD/vector rulers use so labels land on
 * round numbers instead of awkward fractions.
 */
export function niceStep(rough: number): number {
  if (!isFinite(rough) || rough <= 0) return 1;
  const exponent = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exponent);
  const fraction = rough / base;
  let niceFraction: number;
  if (fraction < 1.5) niceFraction = 1;
  else if (fraction < 3.5) niceFraction = 2;
  else if (fraction < 7.5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * base;
}

interface RulerProps {
  orientation: 'horizontal' | 'vertical';
  /** Value at the start of the visible range (left edge for horizontal, top edge for vertical), before any flip. */
  min: number;
  /** Value at the end of the visible range. */
  max: number;
  /** When true, the larger value is placed at the start (top/left) instead of the end. Used for Y-up model space. */
  flip?: boolean;
}

export function Ruler({ orientation, min, max, flip = false }: RulerProps) {
  const range = max - min;
  if (!isFinite(range) || range <= 0) return <div className={`ruler ruler-${orientation === 'horizontal' ? 'h' : 'v'}`} />;

  const step = niceStep(range / 8);
  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let value = start; value <= max + step * 1e-6; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }

  return (
    <div className={`ruler ruler-${orientation === 'horizontal' ? 'h' : 'v'}`}>
      {ticks.map((value) => {
        const t = (value - min) / range;
        const pos = (flip ? 1 - t : t) * 100;
        const style = orientation === 'horizontal' ? { left: `${pos}%` } : { top: `${pos}%` };
        const label = Object.is(value, -0) ? 0 : value;
        return (
          <div key={value} className="ruler-tick" style={style}>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
