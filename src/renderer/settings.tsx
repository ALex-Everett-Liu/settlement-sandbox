// 设置页签：地图、缩放、每页条数这几个数，加上主题。其余参数还等第四块那张参数表。
import type { Params, Theme, World } from '../engine/types.ts';
import { NumberCell } from './tables.tsx';

/**
 * 这几个数各自的上下限与中文名。越界的写法一律挡回来（见 App 的 paramsRefusal），
 * 由界面把理由写进说明行，等 User 自己改一个数——`world.db` 里那个数不变，也不替 User 改成上限或下限。
 * 小数位不设限：带小数的格子 `step` 一律 0.01（倍数下界取它自己的下限 0.0001），
 * 每页几条是行数，仍然只收整数。
 */
export const PARAM_RANGE: Record<
  'mapWidth' | 'mapHeight' | 'zoomMin' | 'zoomMax' | 'pageSize',
  { label: string; lo: number; hi: number; step: number }
> = {
  mapWidth: { label: '地图宽', lo: 100, hi: 1000000, step: 0.01 },
  mapHeight: { label: '地图高', lo: 100, hi: 1000000, step: 0.01 },
  zoomMin: { label: '倍数下界', lo: 0.0001, hi: 1, step: 0.0001 },
  zoomMax: { label: '倍数上界', lo: 0.01, hi: 100, step: 0.01 },
  pageSize: { label: '每页几条', lo: 1, hi: 1000, step: 1 },
};

interface SettingsProps {
  world: World;
  params: Params;
  /** 与界面一致的那个主题值（params.theme 缺了就按浅色算）。 */
  theme: Theme;
  onChange: (patch: Partial<Params>) => void;
  /** 哪一格写了写不回去的值：报给说明行，值留在格子里等 User 自己改。 */
  onNote: (message: string) => void;
}

/** 自适应倍数：与地图打开时用的是同一个式子（画布宽高按当前窗口估）。 */
function fitZoom(params: Params): number {
  const width = Math.max(320, window.innerWidth - 32); // main 左右各 16 像素内边距
  const height = Math.max(200, window.innerHeight - 252); // 画布高度 = 100vh - 250px，再算边框
  return Math.min((width - 40) / params.mapWidth, (height - 40) / params.mapHeight);
}

export function SettingsView({ world, params, theme, onChange, onNote }: SettingsProps) {
  const outside = world.sites.filter(
    (s) => s.x < 0 || s.x > params.mapWidth || s.y < 0 || s.y > params.mapHeight,
  ).length;
  const fit = fitZoom(params);

  return (
    <div>
      <p className="dim small">
        这里的每一项都存在 world.db 里，改完立刻写回去。滚轮与「放大」「缩小」不越过倍数上下界；「缩到全图」不受下界限制，所以地图很大时它会落在下界以下。
      </p>
      <table>
        <thead>
          <tr>
            <th>名字</th>
            <th>值</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="ro">主题</td>
            <td>
              <div className="row">
                <button
                  className={theme === 'light' ? 'tab active' : 'tab'}
                  onClick={() => onChange({ theme: 'light' })}
                >
                  浅色
                </button>
                <button
                  className={theme === 'dark' ? 'tab active' : 'tab'}
                  onClick={() => onChange({ theme: 'dark' })}
                >
                  深色
                </button>
              </div>
            </td>
            <td className="ro">两套配色也存在 world.db 里。</td>
          </tr>
          <tr>
            <td className="ro">地图宽</td>
            <td>
              <NumberCell
                value={params.mapWidth}
                min={PARAM_RANGE.mapWidth.lo}
                max={PARAM_RANGE.mapWidth.hi}
                step={PARAM_RANGE.mapWidth.step}
                label="地图宽"
                title="坐标 x 的范围是 0 到这个数。100 到 1000000 之间。"
                onCommit={(v) => onChange({ mapWidth: v })}
                onNote={onNote}
              />
            </td>
            <td className="ro">坐标 x 的范围是 0 到这个数。改了之后网格、边框与刻度数字跟着重画。</td>
          </tr>
          <tr>
            <td className="ro">地图高</td>
            <td>
              <NumberCell
                value={params.mapHeight}
                min={PARAM_RANGE.mapHeight.lo}
                max={PARAM_RANGE.mapHeight.hi}
                step={PARAM_RANGE.mapHeight.step}
                label="地图高"
                title="坐标 y 的范围是 0 到这个数。100 到 1000000 之间。"
                onCommit={(v) => onChange({ mapHeight: v })}
                onNote={onNote}
              />
            </td>
            <td className="ro">坐标 y 的范围是 0 到这个数。</td>
          </tr>
          <tr>
            <td className="ro">倍数下界</td>
            <td>
              <NumberCell
                value={params.zoomMin}
                min={PARAM_RANGE.zoomMin.lo}
                max={PARAM_RANGE.zoomMin.hi}
                step={PARAM_RANGE.zoomMin.step}
                decimals={4}
                label="倍数下界"
                title="最多缩到这么小。0.0001 到 1 之间，而且不能大于倍数上界。"
                onCommit={(v) => onChange({ zoomMin: v })}
                onNote={onNote}
              />
            </td>
            <td className="ro">最多缩到这么小。地图一大，自适应倍数会比它更小，所以「缩到全图」不受它限制。</td>
          </tr>
          <tr>
            <td className="ro">倍数上界</td>
            <td>
              <NumberCell
                value={params.zoomMax}
                min={PARAM_RANGE.zoomMax.lo}
                max={PARAM_RANGE.zoomMax.hi}
                step={PARAM_RANGE.zoomMax.step}
                label="倍数上界"
                title="最多放到这么大。0.01 到 100 之间，而且不能小于倍数下界。"
                onCommit={(v) => onChange({ zoomMax: v })}
                onNote={onNote}
              />
            </td>
            <td className="ro">最多放到这么大。放到 1 以上时，1 个地图单位比 1 个像素还宽。</td>
          </tr>
          <tr>
            <td className="ro">每页几条</td>
            <td>
              <NumberCell
                value={params.pageSize}
                min={PARAM_RANGE.pageSize.lo}
                max={PARAM_RANGE.pageSize.hi}
                step={PARAM_RANGE.pageSize.step}
                whole
                label="每页几条"
                title="六张表与日志每页显示多少条。1 到 1000 之间的整数。"
                onCommit={(v) => onChange({ pageSize: v })}
                onNote={onNote}
              />
            </td>
            <td className="ro">
              六张表与日志每页显示多少条。条目一多，整张表一次画完会把界面拖垮，所以按这个数分页。
              改小之后当前页码要是落空，界面会退到末页并写一句。
            </td>
          </tr>
        </tbody>
      </table>
      <p className="dim small">
        按当前窗口算，「缩到全图」会用大约 {fit.toFixed(4)} 倍。
      </p>
      <p className="dim small">
        {outside === 0
          ? '所有据点的坐标都落在地图范围内。'
          : '有 ' + String(outside) + ' 座据点的坐标落在地图范围外：数据不动，地图上它们画在边框外面。'}
      </p>
    </div>
  );
}
