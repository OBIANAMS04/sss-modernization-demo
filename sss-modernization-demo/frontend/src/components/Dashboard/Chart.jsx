// STORY-014 and 015: simple charts drawn as inline SVG, with no chart library. The picture is for sighted readers: it is
// labelled for what it shows (role="img") and the table under it holds the same numbers, which is the version assistive
// technology and keyboard users read (WCAG 1.1.1). Colour is never the only signal: the values are written on the picture,
// a second line is also dashed with square markers, and the colours below read at 4.5:1 or better on white.

const SERIES_COLORS = ['#1d4ed8', '#b45309']; // blue-700 (6.7:1) and amber-700 (5.0:1)
const TEXT = '#374151'; // gray-700
const AXIS = '#6b7280'; // gray-500
const GRID = '#e5e7eb'; // gray-200: decoration only

/** A round step (1, 2, 5, 10, 20, 50...) that gives about four gridlines up to `max`, never finer than 1 since these count cases. */
function axisFor(max) {
  const rough = Math.max(max / 4, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough);
  const top = step * Math.max(1, Math.ceil(max / step));
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

const shown = (value, format) => (value === null || value === undefined ? '—' : format(value));

/**
 * Horizontal bars, one row per category with its label above the bar and its value at the end of it. The picture is narrow
 * (and capped in width) so its text stays about as large as the page's on a phone and on a desktop.
 */
function BarGraph({ ariaLabel, categories, values, format, color }) {
  const width = 280;
  const rowHeight = 46;
  const height = categories.length * rowHeight + 8;
  const longest = Math.max(0, ...values.map((v) => v ?? 0));
  const room = width - 56; // keeps the number at the end of the longest bar inside the picture
  return (
    <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} className="w-full max-w-xs h-auto">
      {categories.map((category, i) => {
        const value = values[i] ?? 0;
        const barWidth = longest > 0 ? (value / longest) * room : 0;
        const top = 4 + i * rowHeight;
        return (
          <g key={category}>
            <text x="2" y={top + 14} fontSize="13" fill={TEXT}>{category}</text>
            <rect x="1" y={top + 20} width={barWidth > 0 ? Math.max(barWidth, 2) : 0} height="16" fill={color} />
            <text x={barWidth + 8} y={top + 33} fontSize="13" fontWeight="600" fill={TEXT}>{shown(values[i], format)}</text>
          </g>
        );
      })}
      <line x1="0.5" x2="0.5" y1="4" y2={height - 4} stroke={AXIS} />
    </svg>
  );
}

/** Lines over time. The first series is solid with round markers, the second dashed with square ones. */
function LineGraph({ ariaLabel, categories, series, categoryTitle }) {
  const width = 480;
  const height = 250;
  const margin = { top: 14, right: 16, bottom: 50, left: 38 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const { top, ticks } = axisFor(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const x = (i) => margin.left + (categories.length > 1 ? (i / (categories.length - 1)) * plotWidth : plotWidth / 2);
  const y = (value) => margin.top + plotHeight - (value / top) * plotHeight;
  return (
    <div className="overflow-x-auto">
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700 mb-2">
        {series.map((s, index) => (
          <li key={s.name} className="flex items-center gap-2">
            <svg width="34" height="12" aria-hidden="true">
              <line x1="0" x2="34" y1="6" y2="6" stroke={SERIES_COLORS[index]} strokeWidth="2.5" strokeDasharray={index ? '6 4' : undefined} />
              {index ? <rect x="12" y="2" width="8" height="8" fill={SERIES_COLORS[index]} /> : <circle cx="17" cy="6" r="4" fill={SERIES_COLORS[index]} />}
            </svg>
            <span>{s.name} ({index ? 'dashed line, squares' : 'solid line, circles'})</span>
          </li>
        ))}
      </ul>
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[420px] max-w-xl h-auto">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={tick ? GRID : AXIS} />
            <text x={margin.left - 6} y={y(tick) + 4} textAnchor="end" fontSize="12" fill={TEXT}>{tick}</text>
          </g>
        ))}
        {categories.map((category, i) =>
          (categories.length - 1 - i) % 2 === 0 ? (
            <text key={category} x={x(i)} y={height - margin.bottom + 18} textAnchor="middle" fontSize="12" fill={TEXT}>{category}</text>
          ) : null
        )}
        <text x={margin.left + plotWidth / 2} y={height - 8} textAnchor="middle" fontSize="12" fill={TEXT}>{categoryTitle}</text>
        {series.map((s, index) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={SERIES_COLORS[index]}
              strokeWidth="2.5"
              strokeDasharray={index ? '6 4' : undefined}
              points={s.values.map((value, i) => `${x(i)},${y(value ?? 0)}`).join(' ')}
            />
            {s.values.map((value, i) =>
              index ? (
                <rect key={categories[i]} x={x(i) - 4} y={y(value ?? 0) - 4} width="8" height="8" fill={SERIES_COLORS[index]} />
              ) : (
                <circle key={categories[i]} cx={x(i)} cy={y(value ?? 0)} r="4" fill={SERIES_COLORS[index]} />
              )
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

/** The same numbers as the picture, as a table: categories down the side, one column per series. */
function ChartTable({ caption, categoryHeader, categories, columns, format }) {
  return (
    <div className="overflow-x-auto mt-4">
      <table className="min-w-full text-sm">
        <caption className="text-left text-sm font-medium text-gray-700 pb-2">{caption}</caption>
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th scope="col" className="px-2 sm:px-3 py-2 font-medium">{categoryHeader}</th>
            {columns.map((column) => (
              <th key={column.name} scope="col" className="px-2 sm:px-3 py-2 font-medium text-right">{column.name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {categories.map((category, i) => (
            <tr key={category}>
              <th scope="row" className="px-2 sm:px-3 py-2 font-normal text-left text-gray-900 break-words">{category}</th>
              {columns.map((column) => (
                <td key={column.name} className="px-2 sm:px-3 py-2 text-right tabular-nums text-gray-900">{shown(column.values[i], column.format ?? format)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A chart with its data table. `series` is what the picture draws ({ name, values } each; a bar chart draws the first);
 * `extraColumns` are numbers that only the table shows. `label` says what the chart is of, and names the table too.
 */
export default function Chart({ type = 'bar', label, categoryHeader, categoryTitle, categories, series, extraColumns = [], format = String }) {
  const ariaLabel = `${label}. The table below has the same numbers.`;
  return (
    <div>
      {type === 'line' ? (
        <LineGraph ariaLabel={ariaLabel} categories={categories} series={series} categoryTitle={categoryTitle} />
      ) : (
        <BarGraph ariaLabel={ariaLabel} categories={categories} values={series[0].values} format={series[0].format ?? format} color={SERIES_COLORS[0]} />
      )}
      <ChartTable caption={label} categoryHeader={categoryHeader} categories={categories} columns={[...series, ...extraColumns]} format={format} />
    </div>
  );
}
