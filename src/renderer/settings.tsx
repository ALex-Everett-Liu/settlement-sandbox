// 设置页签：地图与缩放这四个数，加上主题。其余参数还等第四块那张参数表。
import type { Params, Theme, World } from '../engine/types.ts';

interface SettingsProps {
  world: World;
  params: Params;
  /** 与界面一致的那个主题值（params.theme 缺了就按浅色算）。 */
  theme: Theme;
  onChange: (patch: Partial<Params>) => void;
}

function toNumber(text: string, fallback: number): number {
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

/** 自适应倍数：与地图打开时用的是同一个式子（画布宽高按当前窗口估）。 */
function fitZoom(params: Params): number {
  const width = Math.max(320, window.innerWidth - 32); // main 左右各 16 像素内边距
  const height = Math.max(200, window.innerHeight - 252); // 画布高度 = 100vh - 250px，再算边框
  return Math.min((width - 40) / params.mapWidth, (height - 40) / params.mapHeight);
}

export function SettingsView({ world, params, theme, onChange }: SettingsProps) {
  const outside = world.sites.filter(
    (s) => s.x < 0 || s.x > params.mapWidth || s.y < 0 || s.y > params.mapHeight,
  ).length;
  const fit = fitZoom(params);

  return (
    <div>
      <p className="dim small">
        这里的每一项都随世界存在库里，改完立刻写回去。滚轮与「放大」「缩小」不越过倍数上下界；「缩到全图」不受下界限制，所以地图很大时它会落在下界以下。
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
            <td className="ro">两套配色都存在世界库里，跟着这个世界走。</td>
          </tr>
          <tr>
            <td className="ro">地图宽</td>
            <td>
              <input
                type="number"
                value={params.mapWidth}
                onChange={(e) => onChange({ mapWidth: toNumber(e.target.value, params.mapWidth) })}
              />
            </td>
            <td className="ro">坐标 x 的范围是 0 到这个数。改了之后网格、边框与刻度数字跟着重画。</td>
          </tr>
          <tr>
            <td className="ro">地图高</td>
            <td>
              <input
                type="number"
                value={params.mapHeight}
                onChange={(e) => onChange({ mapHeight: toNumber(e.target.value, params.mapHeight) })}
              />
            </td>
            <td className="ro">坐标 y 的范围是 0 到这个数。</td>
          </tr>
          <tr>
            <td className="ro">倍数下界</td>
            <td>
              <input
                type="number"
                step="0.001"
                value={params.zoomMin}
                onChange={(e) => onChange({ zoomMin: toNumber(e.target.value, params.zoomMin) })}
              />
            </td>
            <td className="ro">最多缩到这么小。地图一大，自适应倍数会比它更小，所以「缩到全图」不受它限制。</td>
          </tr>
          <tr>
            <td className="ro">倍数上界</td>
            <td>
              <input
                type="number"
                step="0.5"
                value={params.zoomMax}
                onChange={(e) => onChange({ zoomMax: toNumber(e.target.value, params.zoomMax) })}
              />
            </td>
            <td className="ro">最多放到这么大。放到 1 以上时，1 个地图单位比 1 个像素还宽。</td>
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
